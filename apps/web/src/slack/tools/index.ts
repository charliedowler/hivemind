import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";
import { askHive, recentLearnings } from "@/server/hive";
import { channelInfo } from "@/server/slack/client";
import { installation } from "@/server/slack/install";
import { slackAnswer, slackEscape } from "@/server/slack/format";

export type SlackToolContext = {
  teamId: string;
  memberId: string;
  isAdmin: boolean;
  channelId: string;
  threadTs: string;
};
export type SlackToolResult = {
  text: string;
  blocks?: Array<Record<string, unknown>>;
  silent?: boolean;
};
export type SlackTool = {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  handler: (ctx: SlackToolContext, args: unknown) => Promise<SlackToolResult>;
  handleAction?: (
    ctx: SlackToolContext,
    action: string,
    value: string,
  ) => Promise<SlackToolResult>;
};
export async function slackToolContext(
  actor: HiveContext,
  channelId: string,
  threadTs: string,
): Promise<SlackToolContext> {
  const rows =
    await getSql()`SELECT role FROM members WHERE team_id=${actor.teamId} AND id=${actor.memberId} AND removed_at IS NULL`;
  if (!rows[0])
    throw new HiveError("Join the hive before using its Slack tools.", 403);
  return {
    teamId: actor.teamId,
    memberId: actor.memberId,
    isAdmin: rows[0].role === "admin",
    channelId,
    threadTs,
  };
}
export async function toolActor(ctx: SlackToolContext): Promise<HiveContext> {
  const rows =
    await getSql()`SELECT m.name,t.name AS team_name FROM members m JOIN teams t ON t.id=m.team_id WHERE m.team_id=${ctx.teamId} AND m.id=${ctx.memberId} AND m.removed_at IS NULL`;
  if (!rows[0])
    throw new HiveError("Your hive membership is no longer active.", 403);
  return {
    teamId: ctx.teamId,
    memberId: ctx.memberId,
    memberName: String(rows[0].name),
    teamName: String(rows[0].team_name),
  };
}
async function publicChannel(ctx: SlackToolContext) {
  if (ctx.channelId.startsWith("D")) return false;
  const inst = await installation(ctx.teamId);
  const info = await channelInfo(inst.token, ctx.channelId);
  return !info.is_private && !info.is_im;
}
const question = z.strictObject({ question: z.string().min(1).max(2000) });
const empty = z.strictObject({});
const save = z.strictObject({
  messageTs: z.string().regex(/^\d+\.\d+$/),
  wholeThread: z.boolean(),
});
export const slackTools: SlackTool[] = [
  {
    name: "hive_ask",
    description:
      "Answer a question from the hive with citations, confidence and gaps. Use the full conversational question.",
    input_schema: z.toJSONSchema(question) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      const input = question.parse(args);
      const result = await askHive(await toolActor(ctx), input, {
        publicOnly: await publicChannel(ctx),
      });
      return { text: slackAnswer(result) };
    },
  },
  {
    name: "hive_recent",
    description: "Show learning cells from the last 24 hours.",
    input_schema: z.toJSONSchema(empty) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      empty.parse(args);
      const cells = await recentLearnings(await toolActor(ctx), {
        since: "24h",
        limit: 10,
      });
      const visible = (await publicChannel(ctx))
        ? cells.filter((cell) => cell.source !== "slack")
        : cells;
      return {
        text:
          visible
            .map(
              (cell) =>
                `<${process.env.PUBLIC_URL ?? "https://gohive.dev"}/app/cells/${cell.id}|${slackEscape(cell.title)}>`,
            )
            .join("\n") || "No fresh nectar in the last day.",
      };
    },
  },
  {
    name: "hive_save",
    description:
      "Save a message or its thread in this channel as a classified learning. messageTs must come from the current message or supplied thread context. Direct messages cannot be saved.",
    input_schema: z.toJSONSchema(save) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      const input = save.parse(args);
      if (ctx.channelId.startsWith("D"))
        return {
          text: "Hive never saves direct messages. Use Save to hive or a bee reaction in an invited channel.",
        };
      const [inst, actor, { saveSlackMessage }] = await Promise.all([
        installation(ctx.teamId),
        toolActor(ctx),
        import("@/server/slack/events"),
      ]);
      const result = await saveSlackMessage(
        actor,
        inst.token,
        ctx.channelId,
        input.messageTs,
        input.wholeThread,
      );
      return {
        text: result
          ? `Saved <${process.env.PUBLIC_URL ?? "https://gohive.dev"}/app/cells/${result.id}|${slackEscape(result.learning.title)}>. The hive knows.`
          : "That message is already saved.",
      };
    },
  },
  {
    name: "stay_silent",
    description:
      "Stay silent when a message requires no response, such as an acknowledgement or people talking to each other. Never use this for a direct question or instruction to Hive.",
    input_schema: z.toJSONSchema(empty) as Anthropic.Tool.InputSchema,
    async handler(_ctx, args) {
      empty.parse(args);
      return { text: "", silent: true };
    },
  },
];
export async function dispatchSlackAction(
  ctx: SlackToolContext,
  actionId: string,
  value: string,
) {
  const match = /^tool:([a-z_]+):([a-z_]+)$/.exec(actionId);
  const tool = match && slackTools.find((tool) => tool.name === match[1]);
  if (!tool?.handleAction)
    throw new HiveError("This hive action is unavailable or expired.", 400);
  return tool.handleAction(ctx, match![2], value);
}
