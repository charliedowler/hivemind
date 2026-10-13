import {
  digestScheduleInput,
  nextRunAt,
  type DigestScheduleInput,
  type HiveContext,
} from "@hivemind/core";
import type postgres from "postgres";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import { requireAdmin } from "../identity/access";
import { HiveError } from "../errors";
import { recordEvent } from "../analytics/events";
export type DigestChannel = { id: string; name: string };
export type DigestSchedule = DigestScheduleInput & {
  id: string;
  undoId?: string;
  teamId: string;
  channelName: string;
  createdBy: string;
  anchor: string;
  lastCursor: string;
  coverageStart: string;
  nextDueAt: string;
  lastPostedAt: string | null;
};
export function scheduleView(r: Record<string, unknown>): DigestSchedule {
  return {
    id: String(r.id),
    ...(r.undo_id ? { undoId: String(r.undo_id) } : {}),
    teamId: String(r.team_id),
    channelId: String(r.channel_id),
    channelName: String(r.channel_name),
    cadence: r.cadence as DigestScheduleInput["cadence"],
    weekday: Number(r.weekday),
    monthDay: Number(r.month_day),
    time: String(r.local_time),
    timezone: String(r.timezone),
    enabled: Boolean(r.enabled),
    learnings: Boolean(r.include_learnings),
    insights: Boolean(r.include_insights),
    friction: Boolean(r.include_friction),
    decisions: Boolean(r.include_decisions),
    skipEmpty: Boolean(r.skip_empty),
    createdBy: String(r.created_by),
    anchor: (r.created_at as Date).toISOString(),
    lastCursor: (r.last_cursor as Date).toISOString(),
    coverageStart: (r.coverage_start_at as Date).toISOString(),
    nextDueAt: (r.next_due_at as Date).toISOString(),
    lastPostedAt: r.last_posted_at
      ? (r.last_posted_at as Date).toISOString()
      : null,
  };
}
export async function listSchedules(teamId: string, memberId?: string) {
  return (
    await getSql()`SELECT s.*,(SELECT i.id FROM slack_digest_instructions i WHERE i.team_id=s.team_id AND i.schedule_id=s.id AND i.member_id=${memberId ?? ""} AND i.action IN ('set','disable') AND i.reversed_at IS NULL AND i.created_at>now()-interval '1 hour' AND i.after_revision=s.instruction_revision ORDER BY i.created_at DESC LIMIT 1) AS undo_id FROM slack_digest_schedules s WHERE s.team_id=${teamId} AND s.removed_at IS NULL ORDER BY s.created_at,s.id`
  ).map(scheduleView);
}
export async function getSchedule(teamId: string, id: string) {
  const rows =
    await getSql()`SELECT * FROM slack_digest_schedules WHERE team_id=${teamId} AND id=${id}`;
  if (!rows[0]) throw new HiveError("Schedule not found in your hive.", 404);
  return scheduleView(rows[0]);
}
export async function saveSchedule(
  ctx: HiveContext,
  input: unknown,
  channel: DigestChannel,
  id?: string,
  transaction?: postgres.TransactionSql,
) {
  if (transaction) {
    const members =
      await transaction`SELECT role FROM members WHERE id=${ctx.memberId} AND team_id=${ctx.teamId} AND removed_at IS NULL FOR SHARE`;
    if (members[0]?.role !== "admin")
      throw new HiveError("Only a team admin can do this.", 403);
  } else await requireAdmin(ctx);
  const data = digestScheduleInput.parse(input);
  if (channel.id !== data.channelId)
    throw new HiveError("Choose a channel in your Slack connection.", 400);
  const operation = async (tx: postgres.TransactionSql) => {
    const existing = id
      ? (
          await tx`SELECT * FROM slack_digest_schedules WHERE id=${id} AND team_id=${ctx.teamId} FOR UPDATE`
        )[0]
      : null;
    if (id && !existing)
      throw new HiveError("Schedule not found in your hive.", 404);
    if (
      id &&
      (
        await tx`SELECT id FROM slack_digest_posts WHERE team_id=${ctx.teamId} AND schedule_id=${id} AND status='running'`
      ).length
    )
      throw new HiveError(
        "An update is being posted. Wait before editing this schedule.",
        409,
      );
    const anchor = existing
      ? (existing.created_at as Date).toISOString()
      : new Date().toISOString();
    const next = nextRunAt({ ...data, anchor }, new Date());
    const scheduleId = id ?? newId("dgs");
    const values = {
      id: scheduleId,
      team_id: ctx.teamId,
      channel_id: channel.id,
      channel_name: channel.name,
      cadence: data.cadence,
      weekday: data.weekday,
      month_day: data.monthDay,
      local_time: data.time,
      timezone: data.timezone,
      enabled: data.enabled,
      include_learnings: data.learnings,
      include_insights: data.insights,
      include_friction: data.friction,
      include_decisions: data.decisions,
      skip_empty: data.skipEmpty,
      next_due_at: next,
      updated_at: new Date(),
      instruction_revision: existing
        ? Number(existing.instruction_revision) + 1
        : 1,
    };
    const rows = existing
      ? await tx`UPDATE slack_digest_schedules SET ${tx(values)} WHERE id=${scheduleId} AND team_id=${ctx.teamId} RETURNING *`
      : await tx`INSERT INTO slack_digest_schedules ${tx({ ...values, created_by: ctx.memberId })} RETURNING *`;
    return scheduleView(rows[0]!);
  };
  const saved = transaction
    ? await operation(transaction)
    : await getSql().begin(operation);
  if (!transaction) await scheduleEvent(saved, ctx.memberId);
  return saved;
}
export async function scheduleEvent(
  schedule: DigestSchedule,
  memberId: string,
) {
  await recordEvent({
    name: "digest_scheduled",
    properties: {
      digestScheduleId: schedule.id,
      targetMemberId: memberId,
      cadence: schedule.cadence,
    },
    key: `${schedule.teamId}:${schedule.id}:${schedule.nextDueAt}:${schedule.enabled}`,
  });
}
export async function disableSchedule(ctx: HiveContext, id: string) {
  await requireAdmin(ctx);
  const result = await getSql().begin(async (tx) => {
    const rows =
      await tx`SELECT id FROM slack_digest_schedules WHERE team_id=${ctx.teamId} AND id=${id} FOR UPDATE`;
    if (!rows.length)
      throw new HiveError("Schedule not found in your hive.", 404);
    if (
      (
        await tx`SELECT id FROM slack_digest_posts WHERE team_id=${ctx.teamId} AND schedule_id=${id} AND status='running'`
      ).length
    )
      throw new HiveError(
        "An update is being posted. Wait before disabling this schedule.",
        409,
      );
    await tx`UPDATE slack_digest_schedules SET enabled=false,updated_at=now(),instruction_revision=instruction_revision+1 WHERE team_id=${ctx.teamId} AND id=${id}`;
  });
  return result;
}
export async function digestHistory(teamId: string) {
  const rows =
    await getSql()`SELECT p.id,p.schedule_id,p.status,p.started_at,p.posted_at,p.permalink,p.counts,p.error,s.channel_name,s.timezone FROM slack_digest_posts p JOIN slack_digest_schedules s ON s.id=p.schedule_id AND s.team_id=p.team_id WHERE p.team_id=${teamId} ORDER BY p.started_at DESC LIMIT 10`;
  return rows.map((r) => ({
    id: String(r.id),
    scheduleId: String(r.schedule_id),
    channelName: String(r.channel_name),
    timezone: String(r.timezone),
    status: String(r.status),
    at: (r.posted_at ?? r.started_at).toISOString() as string,
    permalink: r.permalink as string | null,
    error: r.error as string | null,
  }));
}
