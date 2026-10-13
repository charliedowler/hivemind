import type { SlackToolContext } from "./context";
import { installation } from "@/server/slack/install";
import { slackCall } from "@/server/slack/client";
import { HiveError } from "@/server/errors";
import {
  recordEvent,
  currentOrigin,
  originFor,
  withOrigin,
} from "@/server/analytics/events";

export type SlackReactResult = { react: string; text?: string };
export async function reactToSlack(
  ctx: Pick<SlackToolContext, "teamId" | "channelId" | "messageTs">,
  emoji: string,
): Promise<void> {
  if (
    !ctx.messageTs ||
    !/^\d+\.\d+$/.test(ctx.messageTs) ||
    !/^[a-z0-9_+-]{1,64}$/.test(emoji)
  )
    throw new HiveError(
      "This reaction needs a valid message and emoji name.",
      400,
    );
  const started = performance.now();
  const inst = await installation(ctx.teamId);
  try {
    await slackCall(inst.token, "reactions.add", {
      channel: ctx.channelId,
      timestamp: ctx.messageTs,
      name: emoji,
    });
  } catch (error) {
    if (
      !(error instanceof HiveError) ||
      error.message !==
        "Slack could not complete reactions.add: already_reacted."
    )
      throw error;
  }
  const origin = currentOrigin() ?? originFor(undefined, "slack", "system");
  await withOrigin({ ...origin, teamId: ctx.teamId }, () =>
    recordEvent({
      name: "slack.reaction_added",
      key: `slack:reaction:${ctx.teamId}:${ctx.channelId}:${ctx.messageTs}:${emoji}`,
      outcome: "completed",
      latencyMs: performance.now() - started,
      properties: { channelId: ctx.channelId, gateDecision: "react_only" },
    }),
  );
}
