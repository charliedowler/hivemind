import { z } from "zod";
import type { SlackTool } from "./index";
import { toolActor } from "./context";
import { requireAdmin } from "@/server/identity/access";
import { adminJoinPhrase } from "@/server/identity/join-phrases";
import { teamInvitePrompt } from "@/lib/agent-onboarding";
import { slackEscape } from "@/server/slack/format";
const empty = z.strictObject({});
export const joinTools: SlackTool[] = [
  {
    name: "hive_invite_team",
    description:
      "Answer how people join this hive with its current join link and setup prompt. Only an admin can request it, in a channel.",
    input_schema: z.toJSONSchema(empty) as SlackTool["input_schema"],
    async handler(ctx, args) {
      empty.parse(args);
      const actor = await toolActor(ctx);
      await requireAdmin(actor);
      if (ctx.channelId.startsWith("D"))
        return { text: "Ask in a team channel to share the join prompt." };
      const phrase = await adminJoinPhrase(actor);
      if (!phrase || phrase.paused)
        return {
          text: "Joining is paused. Set up an allowed work domain and resume joining on the Team page.",
        };
      const link = `https://gohive.dev/j/${phrase.phrase}`;
      return {
        text: `Invite your team:\n\n${slackEscape(teamInvitePrompt(actor.teamName, link))}\n\nOr send them this link: ${link}`,
      };
    },
  },
];
