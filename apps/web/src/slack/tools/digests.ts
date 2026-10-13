import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { digestScheduleInput } from "@hivemind/core";
import type { SlackTool, SlackToolContext } from "./index";
import { toolActor } from "./context";
import { HiveError } from "@/server/errors";
import { decideDecisiveness } from "@/server/slack/decisiveness";
import { runReversibleAction } from "@/server/slack/actions";
import { digestChannel } from "@/server/digests/connection";
import {
  listSchedules,
  saveSchedule,
  scheduleEvent,
} from "@/server/digests/store";
import { slackEscape } from "@/server/slack/format";

const listInput = z.strictObject({
  disableId: z
    .string()
    .regex(/^dgs_[a-z2-7]{12}$/)
    .optional(),
});
async function instruction(ctx: SlackToolContext) {
  const judgment = await decideDecisiveness(ctx.instructionText ?? "", ctx);
  if (!judgment.act) throw new HiveError(judgment.reason, 422);
}
const tools: SlackTool[] = [
  {
    name: "hive_schedule_digest",
    description:
      "Create a digest schedule now when an admin clearly instructs Hive to do so. Supply the typed schedule from the request. Use the current channel and supplied speaker timezone unless the request names a timezone. Do not use for musings or questions about schedules. No confirmation is needed.",
    input_schema: z.toJSONSchema(
      digestScheduleInput,
    ) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      await instruction(ctx);
      const input = digestScheduleInput.parse(args);
      if (input.channelId !== ctx.channelId)
        throw new HiveError(
          "Ask in the channel where you want the update.",
          400,
        );
      const actor = await toolActor(ctx);
      const channel = await digestChannel(actor, input.channelId);
      let saved: Awaited<ReturnType<typeof saveSchedule>> | undefined;
      const result = await runReversibleAction(
        ctx,
        "hive_schedule_digest",
        async (tx) => {
          saved = await saveSchedule(actor, input, channel, undefined, tx);
          const rows =
            await tx`SELECT updated_at::text AS expected_updated_at FROM slack_digest_schedules WHERE team_id=${ctx.teamId} AND id=${saved.id}`;
          return {
            inverse: {
              kind: "digest",
              id: saved.id,
              expectedUpdatedAt: String(rows[0].expected_updated_at),
              enabled: false,
            },
            text: `Schedule saved for #${slackEscape(saved.channelName)}: ${saved.cadence} at ${saved.time} (${saved.timezone}); next update ${saved.nextDueAt}.`,
            undo: "pause this schedule",
          };
        },
      );
      if (saved) await scheduleEvent(saved, ctx.memberId);
      return result;
    },
  },
  {
    name: "hive_list_digest_schedules",
    description:
      "List digest schedules and their IDs. To pause a schedule on a clear admin instruction, pass its exact ID in disableId. Never guess an ID.",
    input_schema: z.toJSONSchema(listInput) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      await toolActor(ctx);
      const input = listInput.parse(args);
      if (input.disableId) {
        await instruction(ctx);
        return runReversibleAction(
          ctx,
          "hive_list_digest_schedules",
          async (tx) => {
            const rows =
              await tx`SELECT * FROM slack_digest_schedules WHERE team_id=${ctx.teamId} AND id=${input.disableId!} FOR UPDATE`;
            if (!rows[0])
              throw new HiveError("Schedule not found in your hive.", 404);
            if (
              (
                await tx`SELECT id FROM slack_digest_posts WHERE team_id=${ctx.teamId} AND schedule_id=${input.disableId!} AND status='running'`
              ).length
            )
              throw new HiveError(
                "An update is being posted. Try again after it finishes.",
                409,
              );
            const changed =
              await tx`UPDATE slack_digest_schedules SET enabled=false,updated_at=now() WHERE team_id=${ctx.teamId} AND id=${input.disableId!} RETURNING updated_at::text AS expected_updated_at`;
            return {
              inverse: {
                kind: "digest",
                id: input.disableId!,
                expectedUpdatedAt: String(changed[0].expected_updated_at),
                enabled: rows[0].enabled,
              },
              text: "Schedule paused.",
              undo: "restore its previous state",
            };
          },
        );
      }
      const schedules = await listSchedules(ctx.teamId);
      return {
        text:
          schedules
            .map(
              (s) =>
                `${s.id}: #${slackEscape(s.channelName)}, ${s.cadence} at ${s.time} (${s.timezone}); ${s.enabled ? `next ${s.nextDueAt}` : "paused"}`,
            )
            .join("\n") ||
          "No digest schedules yet. An admin can ask Hive to set one up in this channel.",
      };
    },
  },
];
export const digestTools = tools.map((tool) => ({
  ...tool,
  async handler(ctx: SlackToolContext, args: unknown) {
    try {
      return await tool.handler(ctx, args);
    } catch (error) {
      if (error instanceof HiveError) return { text: error.message };
      if (error instanceof z.ZodError)
        return { text: "Include a frequency and time, or use Hive settings." };
      throw error;
    }
  },
}));
