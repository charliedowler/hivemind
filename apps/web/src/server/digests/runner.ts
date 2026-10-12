import {
  composeDigest,
  nextRunAt,
  type ComposedDigest,
  type HiveContext,
} from "@hivemind/core";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import { requireAdmin } from "../identity/access";
import { HiveError } from "../errors";
import { originFor, recordEvent, withOrigin } from "../analytics/events";
import { gatherDigest } from "./data";
import { scheduleView, type DigestSchedule } from "./store";
export type DigestTransport = {
  publicOnly?(schedule: DigestSchedule): Promise<boolean>;
  authors(teamId: string): Promise<Map<string, string>>;
  send(
    schedule: DigestSchedule,
    digest: ComposedDigest,
  ): Promise<{ ts: string; permalink: string | null }>;
};
export class DigestDeliveryError extends Error {
  constructor(
    public readonly uncertain: boolean,
    message: string,
  ) {
    super(message);
  }
}
export async function claimDigest(teamId: string, id: string, manual = false) {
  return getSql().begin(async (tx) => {
    await tx`SET LOCAL lock_timeout='3s'`;
    const rows =
      await tx`SELECT *,clock_timestamp() AS tick_now FROM slack_digest_schedules WHERE team_id=${teamId} AND id=${id} FOR UPDATE`;
    if (!rows[0]) throw new HiveError("Schedule not found in your hive.", 404);
    const schedule = scheduleView(rows[0]),
      now = rows[0].tick_now as Date;
    if (!manual && (!schedule.enabled || new Date(schedule.nextDueAt) > now))
      return null;
    await tx`UPDATE slack_digest_posts SET status='uncertain',error='The worker stopped before delivery was confirmed. Check the channel before posting again.' WHERE team_id=${teamId} AND schedule_id=${id} AND status='running' AND started_at < clock_timestamp()-interval '10 minutes'`;
    if (
      (
        await tx`SELECT id FROM slack_digest_posts WHERE team_id=${teamId} AND schedule_id=${id} AND status='running'`
      ).length
    )
      return null;
    const slot = manual ? now : new Date(schedule.nextDueAt),
      postId = newId("dgp");
    const inserted =
      await tx`INSERT INTO slack_digest_posts(id,team_id,schedule_id,slot_at,trigger,status,since_cursor) VALUES(${postId},${teamId},${id},${slot},${manual ? "manual" : "scheduled"},'running',${new Date(schedule.lastCursor)}) ON CONFLICT(schedule_id,slot_at) DO NOTHING RETURNING id`;
    if (!inserted.length) return null;
    await tx`UPDATE slack_digest_schedules SET next_due_at=${nextRunAt(schedule, now)},last_slot_at=${slot} WHERE team_id=${teamId} AND id=${id}`;
    return {
      schedule,
      postId,
      trigger: manual ? ("manual" as const) : ("scheduled" as const),
    };
  });
}
export async function postDigest(
  teamId: string,
  id: string,
  transport: DigestTransport,
  manual = false,
) {
  const claim = await claimDigest(teamId, id, manual);
  if (!claim) return { status: "not_due" };
  const { schedule, postId, trigger } = claim;
  const ctx: HiveContext = {
    teamId,
    teamName: "Hive",
    memberId: schedule.createdBy,
    memberName: "Hive",
  };
  const origin = originFor(
    ctx,
    manual ? "web" : "scheduled",
    manual ? "web_session" : "system",
  );
  return withOrigin(origin, async () => {
    let sending = false;
    try {
      const [authors, publicOnly] = await Promise.all([
        transport.authors(teamId),
        transport.publicOnly?.(schedule) ?? Promise.resolve(false),
      ]);
      const data = await getSql().begin((tx) =>
        gatherDigest(
          teamId,
          new Date(schedule.coverageStart),
          tx,
          authors,
          schedule.id,
          new Date(schedule.lastCursor),
          publicOnly,
        ),
      );
      const digest = composeDigest(data, schedule, schedule.timezone);
      if (digest.empty && schedule.skipEmpty) {
        await getSql()`UPDATE slack_digest_posts SET status='skipped_empty',until_cursor=${new Date(data.until)},counts=${getSql().json(digest.counts)} WHERE id=${postId} AND team_id=${teamId} AND status='running'`;
        await digestEvent(
          "digest_skipped_empty",
          schedule,
          postId,
          trigger,
          digest,
        );
        return { status: "skipped_empty", postId };
      }
      sending = true;
      const sent = await transport.send(schedule, digest);
      await getSql().begin(async (tx) => {
        const rows =
          await tx`UPDATE slack_digest_posts SET status='posted',posted_at=clock_timestamp(),slack_ts=${sent.ts},permalink=${sent.permalink},until_cursor=${new Date(data.until)},counts=${tx.json(digest.counts)},error=NULL WHERE id=${postId} AND team_id=${teamId} AND status='running' RETURNING posted_at`;
        if (!rows[0]) throw new Error("Digest claim was lost.");
        const sourceKeys = [
          ...(schedule.learnings ? data.learnings : []),
          ...(schedule.insights ? data.insights : []),
          ...(schedule.friction ? data.friction : []),
          ...(schedule.decisions ? data.decisions : []),
        ]
          .map((item) => item.sourceKey)
          .filter((key): key is string => Boolean(key));
        if (sourceKeys.length)
          await tx`INSERT INTO slack_digest_receipts(schedule_id,team_id,source_key,post_id) SELECT ${id},${teamId},key,${postId} FROM unnest(${sourceKeys}::text[]) AS key ON CONFLICT DO NOTHING`;
        await tx`UPDATE slack_digest_schedules SET last_posted_at=${rows[0].posted_at},last_cursor=${new Date(data.until)} WHERE id=${id} AND team_id=${teamId}`;
      });
      await digestEvent("digest_posted", schedule, postId, trigger, digest);
      return { status: "posted", postId, permalink: sent.permalink };
    } catch (error) {
      const uncertain =
        error instanceof DigestDeliveryError ? error.uncertain : sending;
      const status = uncertain ? "uncertain" : "failed";
      const message = uncertain
        ? "Delivery could not be confirmed. Check the channel before posting again."
        : "The update was not posted. Check the Slack connection and channel, then use Post now.";
      await getSql()`UPDATE slack_digest_posts SET status=${status},error=${message} WHERE id=${postId} AND team_id=${teamId} AND status='running'`;
      await recordEvent({
        name: "digest_failed",
        key: `${teamId}:${postId}`,
        outcome: "failed",
        reasonCode: "request_failed",
        properties: {
          digestScheduleId: id,
          digestPostId: postId,
          digestTrigger: trigger,
        },
      });
      return { status, postId, error: message };
    }
  });
}
async function digestEvent(
  name: "digest_posted" | "digest_skipped_empty",
  schedule: DigestSchedule,
  postId: string,
  trigger: "manual" | "scheduled",
  digest: ComposedDigest,
) {
  await recordEvent({
    name,
    key: `${schedule.teamId}:${postId}`,
    outcome: name === "digest_posted" ? "completed" : "skipped",
    properties: {
      digestScheduleId: schedule.id,
      digestPostId: postId,
      digestTrigger: trigger,
      learningCount: digest.counts.learnings,
      insightCount: digest.counts.insights,
      frictionCount: digest.counts.friction,
      decisionCount: digest.counts.decisions,
      frictionMinutes: digest.counts.minutes,
    },
  });
}
export async function postNow(
  ctx: HiveContext,
  id: string,
  transport: DigestTransport,
) {
  await requireAdmin(ctx);
  const result = await postDigest(ctx.teamId, id, transport, true);
  if (result.status === "not_due")
    throw new HiveError(
      "An update is already being posted. Wait for it to finish.",
      409,
    );
  return result;
}
export async function tickDigests(transport: DigestTransport, teamId?: string) {
  const start = Date.now();
  const due =
    await getSql()`SELECT id,team_id FROM slack_digest_schedules WHERE enabled AND next_due_at <= clock_timestamp() AND (${teamId ?? null}::text IS NULL OR team_id=${teamId ?? null}) ORDER BY next_due_at,id LIMIT 20`;
  const results = [];
  for (const row of due) {
    if (Date.now() - start > 230_000) break;
    try {
      results.push(
        await postDigest(String(row.team_id), String(row.id), transport),
      );
    } catch {
      results.push({ status: "failed_claim" });
    }
  }
  return results;
}
