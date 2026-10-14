import { joinRequestTools } from "./join-requests";
import { sharingTools } from "./sharing";
import { joinTools } from "./join";
import { decisionTools } from "./decisions";
export { reactToSlack } from "./react";
export type { SlackReactResult } from "./react";
export { slackToolReply } from "./reply";
import { undoThreadAction } from "./undo";
import { decideDecisiveness } from "@/server/slack/decisiveness";
export { decideDecisiveness };
export { runReversibleAction } from "@/server/slack/actions";
import { digestTools } from "./digests";
import { captureRuleTools } from "./capture-rules";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { HiveError } from "@/server/errors";
import { askHive, recentLearnings } from "@/server/hive";
import { channelInfo } from "@/server/slack/client";
import { installation } from "@/server/slack/install";
import {
  slackAnswer,
  slackEscape,
  slackCaptureReply,
} from "@/server/slack/format";

import { toolActor } from "./context";
import type { SlackToolContext } from "./context";
export { toolActor, slackToolContext } from "./context";
export type { SlackToolContext } from "./context";
export type SlackToolResult = {
  text?: string;
  react?: string;
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
  ...joinTools,
  ...sharingTools,
  ...joinRequestTools,
  ...decisionTools,
  ...digestTools,
  ...captureRuleTools,
  {
    name: "undo_last_action",
    description:
      "Undo threadContext.lastReversibleAction, the latest capture rule, weekly update or admin action, when its author asks in plain language, such as undo, undo that, revert or cancel that. The only way to undo; no other tool undoes. Members can undo their own capture rules; team rules, schedules and join decisions need a current admin. Never select for questions about undo.",
    input_schema: z.toJSONSchema(empty) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      empty.parse(args);
      const judgment = await decideDecisiveness(ctx.instructionText ?? "", {
        ...ctx,
        actionType: "undo",
      });
      if (!judgment.act)
        return {
          text: judgment.reason,
          ...(judgment.react ? { react: judgment.react } : {}),
        };
      return undoThreadAction(ctx);
    },
  },
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
      return { text: slackAnswer(result, ctx.timeZone) };
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
            .join("\n") || "No cells saved in the last day.",
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
        text: slackCaptureReply(result),
        ...(!result || (!result.dropped && !result.learning.captureFlagged)
          ? { react: "white_check_mark" }
          : {}),
      };
    },
  },
  {
    name: "react",
    description:
      "Acknowledge with a real reaction instead of text when the entire reply would be done, agreed, noted or no change. Use +1 for done or agreed, eyes for noted or looking, white_check_mark for saved. Do not use instead of executing an admin instruction or asking for a missing detail.",
    input_schema: z.toJSONSchema(
      z.strictObject({ emoji: z.enum(["+1", "eyes", "white_check_mark"]) }),
    ) as Anthropic.Tool.InputSchema,
    async handler(_ctx, args) {
      const input = z
        .strictObject({ emoji: z.enum(["+1", "eyes", "white_check_mark"]) })
        .parse(args);
      return { react: input.emoji };
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
