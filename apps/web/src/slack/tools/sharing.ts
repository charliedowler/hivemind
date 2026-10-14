import { z } from "zod";
import type { SlackTool } from "./index";
import { toolActor } from "./context";
import { shareWith } from "@/server/share-on-join";
import { decideDecisiveness } from "@/server/slack/decisiveness";
const input = z.strictObject({ mode: z.enum(["all_selected", "projects", "not_now"]), projects: z.array(z.string().min(1).max(256)).max(100).default([]) });
export const sharingTools: SlackTool[] = [{
  name: "hive_share_with",
  description: "Record the speaker's own explicit choice to share their learnings with this organisation. all_selected means everything Hive captures for them, now and in future; projects means only the projects they name; not_now keeps them personal. Select only when the speaker states the choice for their own learnings; never for a question about sharing or an instruction about another person.",
  input_schema: z.toJSONSchema(input) as SlackTool["input_schema"],
  async handler(ctx, args) {
    const data = input.parse(args);
    const text = ctx.instructionText?.replace(/<@[A-Z0-9]+>/g, "").trim() ?? "";
    const judgment = await decideDecisiveness(text, { ...ctx, actionType: "share" }, { mode: data.mode, projects: data.projects });
    if (!judgment.act) return { text: judgment.reason, ...(judgment.react ? { react: judgment.react } : {}) };
    await shareWith(await toolActor(ctx), { ...data, teamId: ctx.teamId, humanInstruction: text });
    return { react: "white_check_mark" };
  },
}];
