import { slackToolReply } from "@/slack/tools/reply";
import type postgres from "postgres";
import { z } from "zod";
import type { SlackToolContext } from "@/slack/tools";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import { HiveError } from "../errors";
import { reverseDecision } from "../conflict-decisions";
import { lockLearningWrites } from "../lifecycle";

const inverseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("decision_reversed"), id: z.string() }),
  z.object({
    kind: z.literal("digest"),
    id: z.string(),
    expectedUpdatedAt: z.string(),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.literal("capture_created"),
    id: z.string(),
    revision: z.number().int().positive(),
  }),
]);
export type SlackActionInverse = z.infer<typeof inverseSchema>;
export type ReversibleChange = {
  inverse: SlackActionInverse;
  text: string;
  undo?: string;
};
async function authorize(tx: postgres.TransactionSql, ctx: SlackToolContext) {
  const rows =
    await tx`SELECT role FROM members WHERE team_id=${ctx.teamId} AND id=${ctx.memberId} AND removed_at IS NULL FOR SHARE`;
  if (rows[0]?.role !== "admin")
    throw new HiveError(
      "A team admin is needed to change Hive from Slack.",
      403,
    );
}
async function lockThread(tx: postgres.TransactionSql, ctx: SlackToolContext) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`slack-action:${ctx.teamId}:${ctx.channelId}:${ctx.threadTs}`},0))`;
}
export async function runReversibleAction(
  ctx: SlackToolContext,
  toolName: string,
  change: (tx: postgres.TransactionSql) => Promise<ReversibleChange>,
) {
  if (!ctx.messageTs)
    throw new HiveError("This instruction needs a Slack message receipt.", 400);
  const messageTs = ctx.messageTs;
  return getSql().begin(async (tx) => {
    await lockThread(tx, ctx);
    await authorize(tx, ctx);
    const prior =
      await tx`SELECT reply,member_id FROM slack_tool_actions WHERE team_id=${ctx.teamId} AND channel_id=${ctx.channelId} AND message_ts=${messageTs}`;
    if (prior[0]) {
      if (prior[0].member_id !== ctx.memberId)
        throw new HiveError("This action belongs to another member.", 403);
      return { text: slackToolReply(String(prior[0].reply), ctx) };
    }
    const result = await change(tx);
    const inverse = inverseSchema.parse(result.inverse);
    const text = slackToolReply(result.text, ctx).replace(/\s+/g, " ").trim();
    await tx`INSERT INTO slack_tool_actions(id,team_id,member_id,channel_id,thread_ts,message_ts,tool_name,inverse,reply) VALUES(${newId("sact")},${ctx.teamId},${ctx.memberId},${ctx.channelId},${ctx.threadTs},${messageTs},${toolName},${tx.json(inverse)},${text})`;
    return { text };
  });
}
export async function hasThreadAction(
  teamId: string,
  channelId: string,
  threadTs: string,
) {
  return (
    (
      await getSql()`SELECT id FROM slack_tool_actions WHERE team_id=${teamId} AND channel_id=${channelId} AND thread_ts=${threadTs} LIMIT 1`
    ).length > 0
  );
}
export function undoLastAction(ctx: SlackToolContext) {
  return getSql().begin(async (tx) => {
    await lockThread(tx, ctx);
    await authorize(tx, ctx);
    const rows =
      await tx`SELECT * FROM slack_tool_actions WHERE team_id=${ctx.teamId} AND channel_id=${ctx.channelId} AND thread_ts=${ctx.threadTs} ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`;
    const action = rows[0];
    if (!action)
      return { text: "There is no reversible action in this thread." };
    if (action.member_id !== ctx.memberId)
      throw new HiveError(
        "Only the admin who made this change can undo it here.",
        403,
      );
    if (action.undone_at)
      return { text: "This thread’s last action is already undone." };
    if (new Date(action.expires_at).getTime() <= Date.now())
      return {
        text: "The one-hour undo window has ended. Change it in Hive settings.",
      };
    const inverse = inverseSchema.parse(action.inverse);
    if (inverse.kind === "digest") {
      const schedules =
        await tx`SELECT *,updated_at::text AS expected_updated_at FROM slack_digest_schedules WHERE team_id=${ctx.teamId} AND id=${inverse.id} FOR UPDATE`;
      if (
        !schedules[0] ||
        schedules[0].expected_updated_at !== inverse.expectedUpdatedAt
      )
        throw new HiveError(
          "The schedule changed after this action. Review it in Hive settings.",
          409,
        );
      if (
        (
          await tx`SELECT id FROM slack_digest_posts WHERE team_id=${ctx.teamId} AND schedule_id=${inverse.id} AND status='running'`
        ).length
      )
        throw new HiveError(
          "An update is being posted. Try undo again after it finishes.",
          409,
        );
      await tx`UPDATE slack_digest_schedules SET enabled=${inverse.enabled},updated_at=now() WHERE team_id=${ctx.teamId} AND id=${inverse.id}`;
    } else if (inverse.kind === "decision_reversed") {
      await reverseDecision({ teamId: ctx.teamId, memberId: ctx.memberId, memberName: "Slack admin", teamName: "" }, inverse.id, "Decision reapplied from Slack", tx);
    } else {
      await lockLearningWrites(tx, {
        teamId: ctx.teamId,
        memberId: ctx.memberId,
        teamName: "",
        memberName: "",
      });
      const rules =
        await tx`SELECT revision,created_by FROM capture_rules WHERE team_id=${ctx.teamId} AND id=${inverse.id} FOR UPDATE`;
      if (
        !rules[0] ||
        rules[0].revision !== inverse.revision ||
        rules[0].created_by !== ctx.memberId
      )
        throw new HiveError(
          "The capture rule changed after this action. Review it in Hive settings.",
          409,
        );
      await tx`DELETE FROM capture_rules WHERE team_id=${ctx.teamId} AND id=${inverse.id}`;
    }
    await tx`UPDATE slack_tool_actions SET undone_at=now() WHERE team_id=${ctx.teamId} AND id=${action.id}`;
    return {
      text:
        inverse.kind === "decision_reversed" ? "Decision reapplied." : inverse.kind === "digest"
          ? inverse.enabled
            ? "Undone. The schedule is enabled again."
            : "Undone. The schedule is paused; any updates already sent remain in Slack."
          : "Undone. The capture rule is removed; captures already processed keep their current state.",
    };
  });
}
