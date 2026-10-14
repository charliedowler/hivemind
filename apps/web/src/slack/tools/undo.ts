import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";
import { captureUndoHandlers } from "./capture-rules";
import { digestUndoHandlers } from "./digests";
import type { SlackToolContext, SlackToolResult } from "./index";
import type { SlackReversibleAction } from "./context";

export async function latestThreadAction(
  ctx: Pick<SlackToolContext, "teamId" | "channelId" | "threadTs">,
) {
  const [action] = await getSql()`SELECT * FROM (
      SELECT 'shared' AS source,id,member_id,tool_name,inverse,created_at,expires_at,undone_at FROM slack_tool_actions WHERE team_id=${ctx.teamId} AND channel_id=${ctx.channelId} AND thread_ts=${ctx.threadTs}
      UNION ALL
      SELECT 'digest' AS source,id,member_id,'hive_schedule_digest' AS tool_name,NULL::jsonb AS inverse,created_at,created_at+interval '1 hour' AS expires_at,CASE WHEN action='undo' THEN created_at ELSE reversed_at END AS undone_at FROM slack_digest_instructions WHERE team_id=${ctx.teamId} AND channel_id=${ctx.channelId} AND thread_ts=${ctx.threadTs}
    ) AS actions ORDER BY created_at DESC,id DESC LIMIT 1`;
  return action ?? null;
}

// A top-level DM message has no thread of its own; it refers to the speaker's latest change in that DM,
// which was recorded under the notice thread it answered.
export async function latestReversibleAction(
  ctx: Pick<
    SlackToolContext,
    "teamId" | "memberId" | "channelId" | "threadTs" | "messageTs"
  >,
) {
  const inThread = await latestThreadAction(ctx);
  if (inThread) return Object.assign(inThread, { thread_ts: ctx.threadTs });
  if (!ctx.channelId.startsWith("D") || ctx.threadTs !== ctx.messageTs)
    return null;
  const [latest] =
    await getSql()`SELECT thread_ts FROM slack_tool_actions WHERE team_id=${ctx.teamId} AND member_id=${ctx.memberId} AND channel_id=${ctx.channelId} ORDER BY created_at DESC,id DESC LIMIT 1`;
  if (!latest) return null;
  const threadTs = String(latest.thread_ts);
  const action = await latestThreadAction({ ...ctx, threadTs });
  return action ? Object.assign(action, { thread_ts: threadTs }) : null;
}
export function reversibleActionSummary(
  action: Awaited<ReturnType<typeof latestReversibleAction>>,
  memberId: string,
): SlackReversibleAction | null {
  return action
    ? {
        tool: String(action.tool_name),
        authorIsSpeaker: action.member_id === memberId,
        alreadyUndone: Boolean(action.undone_at),
        withinUndoWindow: new Date(action.expires_at).getTime() > Date.now(),
      }
    : null;
}

// Undo service: thread-scoped, author only, inside the undo window. The tool handler gates intent first.
export async function undoThreadAction(
  ctx: SlackToolContext,
): Promise<SlackToolResult> {
  try {
    const action = await latestReversibleAction(ctx);
    if (!action)
      return { text: "There is no reversible action in this thread." };
    if (action.member_id !== ctx.memberId)
      return { text: "Only the person who made this change can undo it here." };
    if (action.undone_at)
      return { text: "This thread’s last action is already undone." };
    if (new Date(action.expires_at).getTime() <= Date.now())
      return { text: "The one-hour undo window has ended." };
    ctx = { ...ctx, threadTs: String(action.thread_ts) };
    if (
      Object.hasOwn(digestUndoHandlers, String(action.tool_name)) &&
      action.inverse?.kind === "digest_instruction"
    ) {
      return digestUndoHandlers[String(action.tool_name)]!(ctx, {
        member_id: String(action.member_id),
        inverse: action.inverse,
      });
    }
    if (action.source === "digest") {
      const { applyDigestInstruction } =
        await import("@/server/digests/instructions");
      const result = await applyDigestInstruction(
        ctx,
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
        String(action.id),
      );
      return { ...result, react: "white_check_mark" };
    }
    if (
      action.tool_name === "hive_set_capture_rule" &&
      action.inverse?.kind === "capture_instruction"
    ) {
      const result = await captureUndoHandlers.hive_set_capture_rule(ctx, {
        member_id: String(action.member_id),
        inverse: action.inverse,
      });
      return { ...result, react: "white_check_mark", blocks: undefined };
    }
    const { undoLastAction } = await import("@/server/slack/actions");
    return await undoLastAction(ctx, String(action.id));
  } catch (error) {
    if (error instanceof HiveError) return { text: error.message };
    throw error;
  }
}
