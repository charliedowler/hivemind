import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";
import { decideDecisiveness } from "@/server/slack/decisiveness";
import { captureUndoHandlers } from "./capture-rules";
import { digestUndoHandlers } from "./digests";
import type { SlackToolContext, SlackToolResult } from "./index";

export function isExplicitUndoIntent(text: string) {
  const request = text
    .replace(/^(?:<@[A-Z0-9]+>\s*)+/, "")
    .replace(/\s+\*Sent using\* Slack MCP client\s*$/, "")
    .trim();
  return /^(?:(?:please|can you|could you)\s+)?(?:(?:undo|revert)(?:\s+(?:that|this|it|(?:the\s+)?(?:last|latest)\s+(?:rule|change|action)))?|cancel\s+that)[.!?]*$/i.test(
    request,
  );
}
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

export async function undoThreadAction(
  ctx: SlackToolContext,
): Promise<SlackToolResult> {
  if (!isExplicitUndoIntent(ctx.instructionText ?? "")) {
    const judgment = await decideDecisiveness(ctx.instructionText ?? "", {
      ...ctx,
      actionType: "undo",
    });
    if (!judgment.act)
      return {
        text: judgment.reason,
        ...(judgment.react ? { react: judgment.react } : {}),
      };
  }
  try {
    const action = await latestThreadAction(ctx);
    if (!action)
      return { text: "There is no reversible action in this thread." };
    if (action.member_id !== ctx.memberId)
      return { text: "Only the person who made this change can undo it here." };
    if (action.undone_at)
      return { text: "This thread’s last action is already undone." };
    if (new Date(action.expires_at).getTime() <= Date.now())
      return { text: "The one-hour undo window has ended." };
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
