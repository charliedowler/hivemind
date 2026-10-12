import { send } from "@vercel/queue";
import { z } from "zod";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import { channelPermission, storeMessage } from "./store";
import { validateChannel } from "./install";
import { messagePage } from "./client";

export const jobReference = z.object({ teamId: z.string(), jobId: z.string() });
export async function enqueueSlack(
  teamId: string,
  kind: string,
  key: string,
  payload: Record<string, unknown>,
  channelId?: string,
  generation?: number,
  delaySeconds = 0,
) {
  const sql = getSql();
  const rows =
    await sql`INSERT INTO slack_jobs(id,team_id,dedupe_key,kind,payload,channel_id,generation) VALUES(${newId("sjb")},${teamId},${key},${kind},${sql.json(payload as never)},${channelId ?? null},${generation ?? null}) ON CONFLICT(team_id,dedupe_key) DO UPDATE SET dedupe_key=excluded.dedupe_key RETURNING id,status`;
  if (!["pending", "running"].includes(rows[0].status))
    return { fresh: false, id: String(rows[0].id) };
  await send(
    "hive-slack",
    { teamId, jobId: String(rows[0].id) },
    {
      idempotencyKey: `${teamId}:${key}`,
      delaySeconds,
      retentionSeconds: 604800,
    },
  );
  return { fresh: true, id: String(rows[0].id) };
}
type ThreadProgress = { ts: string; cursor?: string };
export async function runBackfill(
  teamId: string,
  channelId: string,
  generation: number,
) {
  const permission = await channelPermission(teamId, channelId, true);
  if (
    !permission ||
    permission.generation !== generation ||
    permission.backfill_done
  )
    return;
  const { inst } = await validateChannel(teamId, channelId);
  const pending = z
    .array(z.object({ ts: z.string(), cursor: z.string().optional() }))
    .parse(permission.backfill_threads) as ThreadProgress[];
  const thread = pending[0];
  const page = await messagePage(
    inst.token,
    channelId,
    thread?.ts,
    thread ? thread.cursor : (permission.backfill_cursor ?? undefined),
  );
  for (let offset = 0; offset < page.messages.length; offset += 3)
    await Promise.all(
      page.messages
        .slice(offset, offset + 3)
        .map((message) => storeMessage(teamId, channelId, message, generation)),
    );
  let cursor = permission.backfill_cursor as string | null;
  let historyDone = Boolean(permission.backfill_history_done);
  if (thread) {
    if (page.cursor) pending[0] = { ts: thread.ts, cursor: page.cursor };
    else pending.shift();
  } else {
    for (const message of page.messages)
      if ((message.reply_count ?? 0) > 0) pending.push({ ts: message.ts });
    cursor = page.cursor;
    historyDone = !page.cursor;
  }
  const sql = getSql();
  const result =
    await sql`UPDATE slack_channels SET backfill_cursor=${cursor},backfill_threads=${sql.json(pending)},backfill_done=${historyDone && pending.length === 0},backfill_history_done=${historyDone},last_error=NULL WHERE team_id=${teamId} AND channel_id=${channelId} AND generation=${generation} AND state='enabled' RETURNING backfill_done`;
  if (result[0] && !result[0].backfill_done)
    await enqueueSlack(
      teamId,
      "backfill",
      `backfill:${channelId}:${generation}:${newId("page")}`,
      {},
      channelId,
      generation,
      60,
    );
}

export async function retryPendingSlack(
  ctx: import("@hivemind/core").HiveContext,
) {
  const { requireAdmin } = await import("../identity/access");
  await requireAdmin(ctx);
  const rows =
    await getSql()`SELECT id,dedupe_key FROM slack_jobs WHERE team_id=${ctx.teamId} AND status='pending' AND kind IN ('event','command','action','backfill') ORDER BY created_at LIMIT 100`;
  for (let offset = 0; offset < rows.length; offset += 5) {
    const attempts = await Promise.allSettled(
      rows
        .slice(offset, offset + 5)
        .map((row) =>
          send(
            "hive-slack",
            { teamId: ctx.teamId, jobId: String(row.id) },
            {
              idempotencyKey: `${ctx.teamId}:${row.dedupe_key}`,
              retentionSeconds: 604800,
            },
          ),
        ),
    );
    const failed = attempts.find((attempt) => attempt.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  return rows.length;
}
