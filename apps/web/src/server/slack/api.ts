import { z } from "zod";
import { slackCall } from "./client";
import { validateChannel } from "./install";

export { listSlackChannels } from "./install";

export type SlackPost = {
  text: string;
  blocks?: Array<Record<string, unknown>>;
  threadTs?: string;
};

export async function postSlackMessage(
  teamId: string,
  channelId: string,
  message: SlackPost,
): Promise<{ channelId: string; ts: string }> {
  const { inst } = await validateChannel(teamId, channelId);
  const data = await slackCall(inst.token, "chat.postMessage", {
    channel: channelId,
    text: message.text.slice(0, 12000),
    ...(message.blocks ? { blocks: JSON.stringify(message.blocks) } : {}),
    ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
    unfurl_links: false,
    unfurl_media: false,
    parse: "none",
  });
  return { channelId, ts: z.string().parse(data.ts) };
}
