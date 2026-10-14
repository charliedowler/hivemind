import { z } from "zod";
import type { SlackTool } from "./index";
import { toolActor } from "./context";
import { shareWith } from "@/server/share-on-join";
const input = z.strictObject({ mode: z.enum(["all_selected", "projects", "not_now"]), projects: z.array(z.string().min(1).max(256)).max(100).default([]) });
export const sharingTools: SlackTool[] = [{
  name: "hive_share_with",
  description: "Record this member's explicit choice to share their own learnings with this organisation. all_selected means everything Hive captures for them, now and in future; projects means only the named projects; not_now keeps them personal. Never infer sharing consent from a question or another person's instruction.",
  input_schema: z.toJSONSchema(input) as SlackTool["input_schema"],
  async handler(ctx, args) {
    const data = input.parse(args);
    const text = ctx.instructionText?.replace(/<@[A-Z0-9]+>/g, "").trim() ?? "";
    const keepPersonal = /^(?:please\s+)?(?:do not share|don't share|stop sharing|not now|keep (?:my |the )?(?:learnings|cells|projects) (?:personal|private))\b/i.test(text);
    const explicitShare = /^(?:please\s+)?(?:share|yes[,!.]?\s+share|can you share|could you share)\b/i.test(text);
    const supported = data.mode === "not_now" ? keepPersonal : explicitShare && !keepPersonal && (data.mode === "all_selected" ? /\b(?:all|everything)\b/i.test(text) : data.projects.length > 0 && data.projects.every(project => text.includes(project)));
    if (!supported) return { text: "Choose what to share on the Team page, or say which projects to share." };
    await shareWith(await toolActor(ctx), { ...data, teamId: ctx.teamId, humanInstruction: text });
    return { react: "white_check_mark" };
  },
}];
