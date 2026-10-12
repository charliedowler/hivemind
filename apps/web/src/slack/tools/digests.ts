import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SlackTool, SlackToolContext } from "./index";
import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";
import { requireAdmin } from "@/server/identity/access";
import {
  proposeScheduleFromText,
  confirmDigestProposal,
} from "@/server/digests/proposal";
import { listSchedules, disableSchedule } from "@/server/digests/store";
import { slackMemberTimezone } from "@/server/digests/connection";
import { slackEscape } from "@/server/slack/format";
async function actor(ctx: SlackToolContext) {
  const rows =
    await getSql()`SELECT m.name,t.name AS team_name FROM members m JOIN teams t ON t.id=m.team_id WHERE m.team_id=${ctx.teamId} AND m.id=${ctx.memberId} AND m.removed_at IS NULL`;
  if (!rows[0])
    throw new HiveError("Join this hive before using schedules.", 403);
  return {
    teamId: ctx.teamId,
    memberId: ctx.memberId,
    teamName: String(rows[0].team_name),
    memberName: String(rows[0].name),
  };
}
const textInput = z.strictObject({ text: z.string().min(1).max(2000) });
const listInput = z.strictObject({
  disableId: z
    .string()
    .regex(/^dgs_[a-z2-7]{12}$/)
    .optional(),
});
export const digestTools: SlackTool[] = [
  {
    name: "hive_schedule_digest",
    description:
      "Propose a digest schedule from the admin's full request. Use for instructions to post scheduled learnings, insights or friction updates. Uses this channel and the admin's Slack timezone by default. Requires admin confirmation before saving.",
    input_schema: z.toJSONSchema(textInput) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      await requireAdmin(await actor(ctx));
      const input = textInput.parse(args);
      const proposal = await proposeScheduleFromText(
        ctx.teamId,
        ctx.memberId,
        input.text,
        {
          channelId: ctx.channelId,
          timezone: await slackMemberTimezone(ctx.teamId, ctx.memberId),
        },
      );
      return {
        text:
          proposal.restatement +
          " Confirm to save this schedule. The proposal expires in 15 minutes.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              verbatim: true,
              text: slackEscape(proposal.restatement),
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "plain_text",
                emoji: false,
                text: "Confirm to save. This proposal expires in 15 minutes.",
              },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Confirm", emoji: false },
                action_id: "tool:hive_schedule_digest:confirm",
                value: proposal.id,
              },
            ],
          },
        ],
      };
    },
    async handleAction(ctx, action, value) {
      if (action !== "confirm")
        throw new HiveError("This schedule action is unavailable.", 400);
      const schedule = await confirmDigestProposal(
        ctx.teamId,
        ctx.memberId,
        ctx.channelId,
        value,
      );
      return {
        text: `Schedule saved for #${slackEscape(schedule.channelName)}. The next update is ${new Intl.DateTimeFormat("en-GB", { timeZone: schedule.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(schedule.nextDueAt))} (${schedule.timezone}). <https://gohive.dev/app/settings/slack/digests|Manage schedules>`,
      };
    },
  },
  {
    name: "hive_list_digest_schedules",
    description:
      "List the hive's digest schedules and next run. If an admin asks to disable a schedule, pass its exact schedule ID in disableId. Never guess an ID; list first when unclear.",
    input_schema: z.toJSONSchema(listInput) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      const member = await actor(ctx),
        input = listInput.parse(args);
      if (input.disableId) await disableSchedule(member, input.disableId);
      const schedules = await listSchedules(ctx.teamId);
      const text =
        schedules
          .map(
            (s) =>
              `${s.id}: #${slackEscape(s.channelName)}, ${s.cadence} at ${s.time} (${s.timezone}); ${s.enabled ? `next ${s.nextDueAt}` : "paused"}`,
          )
          .join("\n") ||
        "No digest schedules yet. An admin can ask Hive to set one up in this channel.";
      return {
        text: `${input.disableId ? "Schedule disabled.\n" : ""}${text}\n<https://gohive.dev/app/settings/slack/digests|Manage schedules>${ctx.isAdmin && schedules.length ? "\nReply with the schedule ID to disable one." : ""}`,
      };
    },
  },
];
