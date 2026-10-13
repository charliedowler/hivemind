import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SlackTool } from "./index";
import { toolActor } from "./context";
import { decideDecisiveness } from "@/server/slack/decisiveness";
import { runReversibleAction } from "@/server/slack/actions";
import { reverseDecision } from "@/server/conflict-decisions";
import { scheduleKnowledge } from "@/server/knowledge-tree";
import { HiveError } from "@/server/errors";

const input = z.strictObject({ decision_id: z.string().min(1).max(100) });
export const decisionTools: SlackTool[] = [
  {
    name: "hive_reverse_decision",
    description:
      "Reverse a conflict decision now on a clear admin instruction. Supply its exact decision ID from the request or thread. Do not select for musings or questions about reversal. No confirmation is needed.",
    input_schema: z.toJSONSchema(input) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      try {
        const data = input.parse(args);
        const judgment = await decideDecisiveness(ctx.instructionText ?? "", {
          ...ctx,
          actionType: "decision_reverse",
        });
        if (!judgment.act) return { text: judgment.reason, ...(judgment.react ? { react: judgment.react } : {}) };
        const actor = await toolActor(ctx);
        const result = await runReversibleAction(
          ctx,
          "hive_reverse_decision",
          async (tx) => {
            const changed = await reverseDecision(
              actor,
              data.decision_id,
              undefined,
              tx,
              "from Slack",
            );
            return {
              inverse: { kind: "decision_reversed", id: changed.id },
              text: `${changed.id}: ${changed.decision === "reversed" ? "Decision reversed." : "Decision reapplied."}`,
              undo: "restore the decision",
            };
          },
        );
        scheduleKnowledge(actor);
        return result;
      } catch (error) {
        if (error instanceof HiveError) return { text: error.message };
        if (error instanceof z.ZodError)
          return {
            text: "Which decision should Hive reverse? Include its decision ID.",
          };
        throw error;
      }
    },
  },
];
