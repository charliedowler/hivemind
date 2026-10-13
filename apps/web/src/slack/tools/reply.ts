import { humanizeTimeText } from "@hivemind/core";
import type { SlackToolContext } from "./context";
export function slackToolReply(
  text: string,
  ctx: Pick<SlackToolContext, "timeZone">,
) {
  const fact = text
    .replace(/(?:^|\n)\s*As of \d{4}-\d{2}-\d{2}\.\s*(?=\n|$)/g, "")
    .replace(/\s*Reply undo to [^.!?\n]*(?:[.!?]|$)/gi, "");
  return humanizeTimeText(fact, { timeZone: ctx.timeZone });
}
