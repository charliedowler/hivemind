import { humanizeTimeText } from "@hivemind/core";
import type { SlackToolContext } from "./context";
export function slackToolReply(
  text: string,
  ctx: Pick<SlackToolContext, "timeZone">,
) {
  const fact = text.replace(/\s*Reply undo to [^.!?\n]*(?:[.!?]|$)/gi, "");
  return humanizeTimeText(fact, { timeZone: ctx.timeZone });
}
