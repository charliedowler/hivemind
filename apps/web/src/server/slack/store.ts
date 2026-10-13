import { slackDecisionSignals } from "./format";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import { requireAdmin } from "../identity/access";
import { HiveError } from "../errors";
import { redactSecrets, type HiveContext } from "@hivemind/core";
import { embedText } from "../llm/embeddings";
import { permalink, type SlackMessage } from "./client";
import { validateChannel, installation, resolveActor } from "./install";

export async function channelPermission(
  teamId: string,
  channelId: string,
  write = false,
) {
  const rows =
    await getSql()`SELECT c.* FROM slack_channels c JOIN slack_installations i ON i.team_id=c.team_id WHERE c.team_id=${teamId} AND c.channel_id=${channelId} AND c.bot_member=true AND i.active=true AND c.state IN ('enabled','paused') AND (${!write} OR c.state='enabled')`;
  return rows[0] ?? null;
}
export async function changeChannel(
  ctx: HiveContext,
  id: string,
  action: "enable" | "stop" | "purge",
) {
  await requireAdmin(ctx);
  if (action === "enable") await validateChannel(ctx.teamId, id);
  return getSql().begin(async (tx) => {
    const rows =
      await tx`SELECT * FROM slack_channels WHERE team_id=${ctx.teamId} AND channel_id=${id} FOR UPDATE`;
    if (!rows[0]) throw new HiveError("Channel not found in your hive.", 404);
    const generation = Number(rows[0].generation) + 1;
    await tx`UPDATE slack_channels SET state=${action === "enable" ? "enabled" : action === "stop" ? "paused" : "purged"},generation=${generation},backfill_done=${action !== "enable"},backfill_cursor=NULL,backfill_history_done=false,backfill_threads='[]'::jsonb,last_error=NULL WHERE team_id=${ctx.teamId} AND channel_id=${id}`;
    await tx`UPDATE slack_jobs SET status='cancelled',payload=NULL WHERE team_id=${ctx.teamId} AND channel_id=${id} AND kind IN ('backfill','index') AND status IN ('pending','running')`;
    if (action === "purge") {
      await tx`DELETE FROM ask_log WHERE team_id=${ctx.teamId} AND cited_ids && ARRAY(SELECT id FROM slack_messages WHERE team_id=${ctx.teamId} AND channel_id=${id})`;
      await tx`DELETE FROM slack_messages WHERE team_id=${ctx.teamId} AND channel_id=${id}`;
      await tx`DELETE FROM slack_ask_history WHERE team_id=${ctx.teamId} AND channel_id=${id}`;
      await tx`UPDATE slack_jobs SET payload=NULL,status='cancelled' WHERE team_id=${ctx.teamId} AND channel_id=${id} AND status IN ('pending','running')`;
    }
    return generation;
  });
}
let embeddingAvailable: Promise<boolean> | undefined;
export function slackEmbeddingAvailable() {
  embeddingAvailable ??=
    getSql()`SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='slack_messages' AND column_name='embedding') AS present`.then(
      (r) => Boolean(r[0].present),
    );
  return embeddingAvailable;
}
export async function storeMessage(
  teamId: string,
  channelId: string,
  message: SlackMessage,
  expectedGeneration?: number,
) {
  if (
    !message.user ||
    message.bot_id ||
    (message.subtype && message.subtype !== "file_share") ||
    !message.text.trim()
  )
    return false;
  const permission = await channelPermission(teamId, channelId, true);
  if (
    !permission ||
    (expectedGeneration !== undefined &&
      permission.generation !== expectedGeneration)
  )
    return false;
  const inst = await installation(teamId);
  if (message.user === inst.bot_user_id) return false;
  const text = redactSecrets(message.text).text.slice(0, 20000);
  const [link, actor, embedding] = await Promise.all([
    permalink(inst.token, channelId, message.ts),
    resolveActor(teamId, message.user, inst.token),
    slackEmbeddingAvailable().then((yes) => (yes ? embedText(text) : null)),
  ]);
  return getSql().begin(async (tx) => {
    const current =
      await tx`SELECT generation FROM slack_channels WHERE team_id=${teamId} AND channel_id=${channelId} AND state='enabled' AND bot_member=true FOR SHARE`;
    if (!current[0] || current[0].generation !== permission.generation)
      return false;
    await tx`INSERT INTO slack_messages(id,team_id,channel_id,ts,thread_ts,author_id,author_name,text,permalink,posted_at) VALUES(${newId("slk")},${teamId},${channelId},${message.ts},${message.thread_ts ?? message.ts},${message.user!},${actor?.memberName ?? "Slack teammate"},${text},${link},${new Date(Number(message.ts) * 1000)}) ON CONFLICT(team_id,channel_id,ts) DO UPDATE SET text=excluded.text,author_name=excluded.author_name,permalink=excluded.permalink,updated_at=now()`;
    if (embedding)
      await tx`UPDATE slack_messages SET embedding=${JSON.stringify(embedding)}::vector WHERE team_id=${teamId} AND channel_id=${channelId} AND ts=${message.ts}`;
    return true;
  });
}
export async function slackSettings(ctx: HiveContext) {
  await requireAdmin(ctx);
  const sql = getSql();
  const [inst, channels, decisions] = await Promise.all([
    sql`SELECT workspace_name,workspace_id,active FROM slack_installations WHERE team_id=${ctx.teamId}`,
    sql`SELECT c.*,count(m.id)::int AS count FROM slack_channels c LEFT JOIN slack_messages m ON m.team_id=c.team_id AND m.channel_id=c.channel_id WHERE c.team_id=${ctx.teamId} GROUP BY c.team_id,c.channel_id ORDER BY c.name`,
    sql`SELECT d.*,c.name AS channel_name FROM slack_decisions d LEFT JOIN slack_channels c ON c.team_id=d.team_id AND c.channel_id=d.channel_id WHERE d.team_id=${ctx.teamId} ORDER BY d.created_at DESC LIMIT 100`,
  ]);
  return {
    installation: inst[0]
      ? {
          workspaceName: String(inst[0].workspace_name),
          workspaceId: String(inst[0].workspace_id),
          active: Boolean(inst[0].active),
        }
      : null,
    channels: channels.map((c) => ({
      id: String(c.channel_id),
      name: String(c.name),
      private: Boolean(c.private),
      state: String(c.state),
      count: Number(c.count),
      botMember: Boolean(c.bot_member),
      backfillDone: Boolean(c.backfill_done),
      error: c.last_error as string | null,
    })),
    decisions: decisions.map((d) => ({
      id: String(d.id),
      channelId: String(d.channel_id),
      channelName: String(d.channel_name ?? d.channel_id),
      threadTs: String(d.thread_ts),
      decision: String(d.decision),
      reason: String(d.reason),
      signals: slackDecisionSignals(d.signals),
      latencyMs: Number(d.latency_ms),
      model: d.model as string | null,
      delivery: String(d.delivery),
      createdAt: new Date(d.created_at).toISOString(),
      evidenceIds: d.evidence_ids as string[],
    })),
  };
}
export type SlackSettingsData = Awaited<ReturnType<typeof slackSettings>>;
export async function disconnectSlack(ctx: HiveContext) {
  await requireAdmin(ctx);
  await getSql().begin(async (tx) => {
    await tx`UPDATE slack_installations SET active=false,token_ciphertext='' WHERE team_id=${ctx.teamId}`;
    await tx`UPDATE slack_channels SET state='paused',generation=generation+1 WHERE team_id=${ctx.teamId}`;
    await tx`UPDATE slack_jobs SET status='cancelled',payload=NULL WHERE team_id=${ctx.teamId} AND status IN ('pending','running')`;
  });
}
