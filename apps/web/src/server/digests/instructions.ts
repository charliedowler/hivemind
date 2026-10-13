import { z } from "zod";
import {
  type HiveContext,
  digestTime,
  digestZone,
  digestScheduleInput,
} from "@hivemind/core";
import type { SlackToolContext, SlackToolResult } from "@/slack/tools";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import { HiveError } from "../errors";
import { recordEvent } from "../analytics/events";
import { digestChannel } from "./connection";
import {
  digestMemberContext,
  digestInstructionSchema,
  parseScheduleInstruction,
} from "./parse-instruction";
import { restateSchedule } from "./schedule-text";
import { decide, judgeDigest } from "./action-gate";
import {
  saveSchedule,
  scheduleView,
  scheduleEvent,
  listSchedules,
} from "./store";
import { slackEscape } from "../slack/format";
const questions = {
  time: "What time should the update run?",
  cadence: "How often should the update run?",
  channel: "Which channel should receive the update?",
  target: "Which schedule should I stop?",
  intent: "Should I set that digest schedule?",
};
export async function digestInstruction(
  ctx: SlackToolContext,
  text: string,
  timezone: string,
): Promise<SlackToolResult> {
  const member = await digestMemberContext(ctx.teamId, ctx.memberId);
  if (!ctx.messageTs)
    throw new HiveError("Ask Hive in a new message to change a schedule.", 400);
  const prior = (
    await getSql()`SELECT reply,reaction FROM slack_digest_instructions WHERE team_id=${ctx.teamId} AND channel_id=${ctx.channelId} AND message_ts=${ctx.messageTs!}`
  )[0];
  if (prior)
    return prior.reaction
      ? { text: "", react: String(prior.reaction) }
      : { text: String(prior.reply) };
  const role = (
    await getSql()`SELECT role FROM members WHERE team_id=${ctx.teamId} AND id=${ctx.memberId} AND removed_at IS NULL`
  )[0];
  ctx = { ...ctx, isAdmin: ctx.isAdmin && role?.role === "admin" };
  const raw = (ctx.requestText ?? ctx.instructionText ?? text).slice(0, 2000);
  const proposal = await parseScheduleInstruction(
    ctx.teamId,
    ctx.memberId,
    raw,
    { channelId: ctx.channelId, timezone },
    ctx.history,
  );
  if (proposal.action === "list") {
    const schedules = await listSchedules(ctx.teamId);
    return {
      text:
        schedules
          .map(
            (s) =>
              `${s.id}: ${restateSchedule(s)} in #${slackEscape(s.channelName)} (${digestZone(s.timezone)}), ${s.enabled ? `next ${digestTime(s.nextDueAt, s.timezone, { relative: true })}` : "stopped"}`,
          )
          .join("\n") || "No digest schedules yet.",
    };
  }
  const judged = await judgeDigest(raw, ctx.isAdmin, {
    proposal,
    history: ctx.history ?? [],
  });
  const decision = decide(
    {
      isAdmin: ctx.isAdmin,
      enough: proposal.enoughDetail,
      clear: proposal.clearInstruction,
      suggestion: proposal.actionableSuggestion,
    },
    judged.signals,
  );
  const action = proposal.action;
  await getSql()`INSERT INTO slack_decisions(id,team_id,channel_id,thread_ts,message_ts,prompted,decision,reason,signals,model,latency_ms,evidence_ids,delivery,policy_version) VALUES(${newId("sdc")},${ctx.teamId},${ctx.channelId},${ctx.threadTs},${ctx.messageTs!},true,${`digest_${decision}`},${decision === "act" ? "Clear digest instruction with required details." : decision === "refuse" ? "Digest changes require an admin." : "Digest instruction needs one detail."},${getSql().json(
    {
      memberId: ctx.memberId,
      source: judged.signals ? "jev" : "model",
      signals: judged.signals,
      modelClear: proposal.clearInstruction,
      modelEnough: proposal.enoughDetail,
    },
  )},${judged.model},${judged.latencyMs},${[]},'none','hive-digest-actions-1') ON CONFLICT DO NOTHING`;
  await recordEvent({
    name: "digest_action_decided",
    properties: {
      digestAction: action,
      digestDecision: decision,
      digestDecisionSource: judged.signals ? "jev" : "model",
      digestSignals: judged.signals,
      targetMemberId: ctx.memberId,
    },
    key: `digest:decision:${ctx.teamId}:${ctx.channelId}:${ctx.messageTs!}`,
  });
  if (decision === "refuse")
    return { text: "Only hive admins can change digest schedules." };
  if (decision === "clarify")
    return proposal.missing === "intent"
      ? { react: "eyes" }
      : { text: questions[proposal.missing ?? "intent"] };
  return applyDigestInstruction(ctx, proposal);
}
export async function applyDigestInstruction(
  ctx: SlackToolContext,
  proposal: z.infer<typeof digestInstructionSchema>,
  expectedInstructionId?: string,
) {
  const member = await digestMemberContext(ctx.teamId, ctx.memberId);
  const action = proposal.action;
  const channel =
    action === "set" && proposal.schedule
      ? await digestChannel(member, proposal.schedule.channelId)
      : null;
  const result = await getSql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.teamId},7295))`;
    const admin = (
      await tx`SELECT role FROM members WHERE team_id=${ctx.teamId} AND id=${ctx.memberId} AND removed_at IS NULL FOR SHARE`
    )[0];
    if (admin?.role !== "admin")
      throw new HiveError("Only hive admins can change digest schedules.", 403);
    const duplicate = (
      await tx`SELECT reply,reaction FROM slack_digest_instructions WHERE team_id=${ctx.teamId} AND channel_id=${ctx.channelId} AND message_ts=${ctx.messageTs!}`
    )[0];
    if (duplicate)
      return {
        reply: String(duplicate.reply),
        reaction: duplicate.reaction ? String(duplicate.reaction) : null,
        schedule: null,
      };
    let target = proposal.targetScheduleId;
    let reversed: Record<string, unknown> | undefined;
    if (action === "undo") {
      reversed = (
        await tx`SELECT * FROM slack_digest_instructions WHERE team_id=${ctx.teamId} AND member_id=${ctx.memberId} AND channel_id=${ctx.channelId} AND thread_ts=${ctx.threadTs} AND action IN ('set','disable') AND reversed_at IS NULL AND created_at>now()-interval '1 hour' ${expectedInstructionId ? tx`AND id=${expectedInstructionId}` : tx``} ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`
      )[0];
      if (!reversed)
        throw new HiveError(
          "There is no digest change from you in this thread to undo within the last hour.",
          410,
        );
      target = String(reversed.schedule_id);
    }
    const old = target
      ? (
          await tx`SELECT * FROM slack_digest_schedules WHERE team_id=${ctx.teamId} AND id=${target} FOR UPDATE`
        )[0]
      : undefined;
    if ((action === "disable" || action === "undo") && !old)
      throw new HiveError("Schedule not found in your hive.", 404);
    if (
      reversed &&
      Number(old!.instruction_revision) !== Number(reversed.after_revision)
    )
      throw new HiveError(
        "This schedule changed after your instruction. Ask Hive for a new change.",
        409,
      );
    let input = proposal.schedule;
    if (action === "disable")
      input = digestScheduleInput.parse({
        ...scheduleView(old!),
        enabled: false,
      });
    if (action === "undo")
      input = digestScheduleInput.parse(
        reversed!.before_schedule ?? { ...scheduleView(old!), enabled: false },
      );
    if (!input)
      throw new HiveError(
        "What frequency and time should the update use?",
        422,
      );
    const saved = await saveSchedule(
      member,
      input,
      channel ?? { id: input.channelId, name: String(old!.channel_name) },
      target ?? undefined,
      tx,
    );
    const revision = (
      await tx`SELECT instruction_revision FROM slack_digest_schedules WHERE team_id=${ctx.teamId} AND id=${saved.id}`
    )[0].instruction_revision;
    const next = digestTime(saved.nextDueAt, saved.timezone, { mode: "date" });
    const removed = action === "undo" && !reversed!.before_schedule;
    if (removed)
      await tx`UPDATE slack_digest_schedules SET removed_at=now() WHERE team_id=${ctx.teamId} AND id=${saved.id}`;
    const reply =
      action === "undo"
        ? removed
          ? "Removed. The digest schedule is removed."
          : `Undone. The digest schedule in #${slackEscape(saved.channelName)} is ${saved.enabled ? "restored" : "stopped"}.`
        : action === "disable"
          ? `Stopped. ${restateSchedule(saved)} in #${slackEscape(saved.channelName)} (${digestZone(saved.timezone)}).`
          : `Set. ${restateSchedule(saved)} in #${slackEscape(saved.channelName)} (${digestZone(saved.timezone)}). ${saved.enabled ? `${old ? "Next update" : "First update"} ${next}.` : "The schedule is paused."}`;
    const reaction =
      action === "undo"
        ? "white_check_mark"
        : action === "set" &&
            !proposal.defaultedDetails &&
            saved.enabled &&
            new Date(saved.nextDueAt).getTime() - Date.now() <= 48 * 3600000
          ? "+1"
          : null;
    const instructionId = newId("dgi");
    await tx`INSERT INTO slack_digest_instructions(id,team_id,member_id,channel_id,thread_ts,message_ts,action,schedule_id,before_schedule,after_revision,reply,reaction) VALUES(${instructionId},${ctx.teamId},${ctx.memberId},${ctx.channelId},${ctx.threadTs},${ctx.messageTs!},${action},${saved.id},${old ? tx.json(digestScheduleInput.parse(scheduleView(old))) : null},${revision},${reply},${reaction})`;
    if (action === "set" || action === "disable")
      await tx`INSERT INTO slack_tool_actions(id,team_id,member_id,channel_id,thread_ts,message_ts,tool_name,inverse,reply) VALUES(${newId("sact")},${ctx.teamId},${ctx.memberId},${ctx.channelId},${ctx.threadTs},${ctx.messageTs!},${action === "set" ? "hive_schedule_digest" : "hive_list_digest_schedules"},${tx.json({ kind: "digest_instruction", reversible: true, payload: { instructionId } })},${reply}) ON CONFLICT DO NOTHING`;
    if (reversed)
      await tx`UPDATE slack_tool_actions SET undone_at=now() WHERE team_id=${ctx.teamId} AND inverse->>'kind'='digest_instruction' AND inverse->'payload'->>'instructionId'=${String(reversed.id)}`;
    if (reversed)
      await tx`UPDATE slack_digest_instructions SET reversed_at=now() WHERE id=${String(reversed.id)} AND team_id=${ctx.teamId}`;
    return { reply, reaction, schedule: saved };
  });
  if (result.schedule) await scheduleEvent(result.schedule, ctx.memberId);
  return result.reaction
    ? { text: "", react: result.reaction }
    : { text: result.reply };
}

export async function isDigestFollowup(
  teamId: string,
  memberId: string,
  channelId: string,
  threadTs: string,
) {
  const rows =
    await getSql()`SELECT 1 FROM slack_digest_instructions WHERE team_id=${teamId} AND member_id=${memberId} AND channel_id=${channelId} AND thread_ts=${threadTs} AND created_at>now()-interval '1 hour' UNION ALL SELECT 1 FROM slack_decisions WHERE team_id=${teamId} AND channel_id=${channelId} AND thread_ts=${threadTs} AND policy_version='hive-digest-actions-1' AND signals->>'memberId'=${memberId} AND decision='digest_clarify' AND created_at>now()-interval '1 hour' LIMIT 1`;
  return rows.length > 0;
}

export async function undoDigestFromWeb(ctx: HiveContext, id: string) {
  const row = (
    await getSql()`SELECT * FROM slack_digest_instructions WHERE team_id=${ctx.teamId} AND member_id=${ctx.memberId} AND id=${id}`
  )[0];
  if (!row) throw new HiveError("Digest change not found.", 404);
  return applyDigestInstruction(
    {
      teamId: ctx.teamId,
      memberId: ctx.memberId,
      isAdmin: true,
      channelId: String(row.channel_id),
      threadTs: String(row.thread_ts),
      messageTs: `web:${newId("dgi")}`,
    },
    {
      action: "undo",
      schedule: null,
      targetScheduleId: null,
      clearInstruction: true,
      actionableSuggestion: false,
      defaultedDetails: false,
      enoughDetail: true,
      timeSpecified: false,
      missing: null,
    },
    id,
  );
}
