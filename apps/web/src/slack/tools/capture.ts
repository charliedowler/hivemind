import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { captureRuleInputSchema } from "@hivemind/core";
import type { SlackTool, SlackToolContext } from "./index";
import { toolActor } from "./context";
import { HiveError } from "@/server/errors";
import { createCaptureRule, listCaptureRules } from "@/server/capture-rules";
import { decideDecisiveness } from "@/server/slack/decisiveness";
import { runReversibleAction } from "@/server/slack/actions";
import { slackEscape } from "@/server/slack/format";
const tools: SlackTool[] = [
  {
    name: "hive_set_capture_rule",
    description:
      "Create a future capture rule on a clear admin instruction to ignore, redact or flag certain memories. Translate the instruction into the typed rule. 'Ignore' means drop future captures. Use member scope for 'my', team scope for 'the hive', 'our' or 'team'. Do not alter existing cells. No confirmation is needed.",
    input_schema: z.toJSONSchema(
      z.strictObject({ rule: captureRuleInputSchema }),
      { io: "input" },
    ) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      const judgment = await decideDecisiveness(ctx.instructionText ?? "", {
        ...ctx,
        actionType: "capture",
      });
      if (!judgment.act) return { text: judgment.reason };
      const input = z
        .strictObject({ rule: captureRuleInputSchema })
        .parse(args).rule;
      const actor = await toolActor(ctx);
      return runReversibleAction(ctx, "hive_set_capture_rule", async (tx) => {
        const rule = await createCaptureRule(
          actor,
          { ...input, source: "slack", naturalText: ctx.instructionText },
          tx,
        );
        const rows =
          await tx`SELECT revision FROM capture_rules WHERE team_id=${ctx.teamId} AND id=${rule.id}`;
        return {
          inverse: {
            kind: "capture_created",
            id: rule.id,
            revision: rows[0].revision,
          },
          text: `Rule saved: ${slackEscape(rule.name)} (${rule.scope}, ${rule.action}) for future captures.`,
          undo: "remove this rule",
        };
      });
    },
  },
  {
    name: "hive_list_capture_rules",
    description:
      "List the speaker's personal and team capture rules, with IDs and whether each is enabled.",
    input_schema: z.toJSONSchema(
      z.strictObject({}),
    ) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      z.strictObject({}).parse(args);
      const rules = await listCaptureRules(await toolActor(ctx));
      return {
        text:
          rules
            .map(
              (rule) =>
                `${rule.id}: ${slackEscape(rule.name)} (${rule.scope}, ${rule.action}, ${rule.enabled ? "enabled" : "paused"})`,
            )
            .join("\n") || "No capture rules apply to you yet.",
      };
    },
  },
];
export const captureTools = tools.map((tool) => ({
  ...tool,
  async handler(ctx: SlackToolContext, args: unknown) {
    try {
      return await tool.handler(ctx, args);
    } catch (error) {
      if (error instanceof HiveError) return { text: error.message };
      if (error instanceof z.ZodError)
        return {
          text: "Tell Hive which content to match and whether to ignore, redact or flag it.",
        };
      throw error;
    }
  },
}));
