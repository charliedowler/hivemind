import { getSql } from "@/server/db/client";
import type Anthropic from "@anthropic-ai/sdk";
import { digestTime, digestZone } from "@hivemind/core";
import { z } from "zod";
import type { SlackTool, SlackToolContext, SlackToolResult } from "./index";
import { HiveError } from "@/server/errors";
import { digestInstruction } from "@/server/digests/instructions";
import { listSchedules } from "@/server/digests/store";
import { slackMemberTimezone } from "@/server/digests/connection";
import { restateSchedule } from "@/server/digests/proposal";
import { slackEscape } from "@/server/slack/format";
const input = z.strictObject({ text: z.string().min(1).max(2000) });
const listing = z.strictObject({ text: z.string().max(2000).optional() });
const tools: SlackTool[] = [
  {
    name: "hive_schedule_digest",
    description:
      "Set a digest schedule from the full original request. Clear admin instructions and fully specified suggestions save immediately, including Maybe we should schedule a digest here every Wednesday at 9am London time. Use also for undo or cancel that in a digest thread within one hour. Missing time or ambiguity asks one question; no confirmation buttons.",
    input_schema: z.toJSONSchema(input) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      const { text } = input.parse(args);
      return digestInstruction(
        ctx,
        text,
        await slackMemberTimezone(ctx.teamId, ctx.memberId),
      );
    },
    async handleAction() {
      return { text: "Ask Hive to set the schedule in a new message." };
    },
  },
  {
    name: "hive_list_digest_schedules",
    description:
      "List schedules and next run. To stop or disable a schedule, pass the full original instruction in text, such as stop the Monday update. Clear admin instructions act immediately, ambiguous targets ask one question. Undo and cancel that can also reverse a digest instruction in this thread within an hour.",
    input_schema: z.toJSONSchema(listing) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      const { text } = listing.parse(args);
      if (text)
        return digestInstruction(
          ctx,
          text,
          await slackMemberTimezone(ctx.teamId, ctx.memberId),
        );
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
    },
  },
];
export const digestTools: SlackTool[] = tools.map((tool) => ({
  ...tool,
  async handler(ctx, args) {
    try {
      return await tool.handler(ctx, args);
    } catch (error) {
      if (error instanceof HiveError) return { text: error.message };
      if (error instanceof z.ZodError)
        return { text: "What frequency and time should the update use?" };
      throw error;
    }
  },
}));

type DigestPointer = { member_id: string; inverse: unknown };
async function undoPointer(
  ctx: SlackToolContext,
  pointer: DigestPointer,
): Promise<SlackToolResult> {
  if (pointer.member_id !== ctx.memberId)
    return { text: "Only the admin who made this change can undo it here." };
  const inverse = z
    .object({
      kind: z.literal("digest_instruction"),
      reversible: z.literal(true),
      payload: z.object({ instructionId: z.string() }),
    })
    .parse(pointer.inverse);
  return digestInstruction(
    ctx,
    ctx.instructionText ?? "undo",
    await slackMemberTimezone(ctx.teamId, ctx.memberId),
    inverse.payload.instructionId,
  );
}
export const digestUndoHandlers: Record<string, typeof undoPointer> = {
  hive_schedule_digest: undoPointer,
  hive_list_digest_schedules: undoPointer,
};
export async function dispatchDigestUndo(ctx: SlackToolContext) {
  const row = (
    await getSql()`SELECT tool_name,member_id,inverse FROM slack_tool_actions WHERE team_id=${ctx.teamId} AND channel_id=${ctx.channelId} AND thread_ts=${ctx.threadTs} ORDER BY created_at DESC,id DESC LIMIT 1`
  )[0];
  if (
    !row ||
    !Object.hasOwn(digestUndoHandlers, String(row.tool_name)) ||
    (row.inverse as { kind?: string })?.kind !== "digest_instruction"
  )
    return null;
  return digestUndoHandlers[String(row.tool_name)]!(ctx, {
    member_id: String(row.member_id),
    inverse: row.inverse,
  });
}
