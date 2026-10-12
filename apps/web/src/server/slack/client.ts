import { z } from "zod";
import { HiveError } from "../errors";

export class SlackRateLimit extends HiveError {
  constructor(public readonly retrySeconds: number) {
    super("Slack asked the hive to retry later.", 429);
  }
}
export const slackMessage = z.object({
  ts: z.string(),
  text: z.string().default(""),
  user: z.string().optional(),
  thread_ts: z.string().optional(),
  bot_id: z.string().optional(),
  subtype: z.string().optional(),
  reply_count: z.number().optional(),
});
export type SlackMessage = z.infer<typeof slackMessage>;
export const slackChannel = z.object({
  id: z.string(),
  name: z.string().default("channel"),
  is_member: z.boolean().default(false),
  is_private: z.boolean().default(false),
  is_im: z.boolean().default(false),
  is_mpim: z.boolean().default(false),
  is_archived: z.boolean().default(false),
});
export type SlackChannel = z.infer<typeof slackChannel>;

export async function slackCall(
  token: string,
  method: string,
  args: Record<string, string | number | boolean> = {},
) {
  const read = new Set([
    "conversations.info",
    "conversations.list",
    "conversations.history",
    "conversations.replies",
    "users.info",
    "chat.getPermalink",
    "reactions.get",
  ]).has(method);
  const params = new URLSearchParams(
    Object.entries(args).map(([key, value]) => [key, String(value)]),
  );
  const response = await fetch(
    `https://slack.com/api/${method}${read ? `?${params}` : ""}`,
    {
      method: read ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      ...(read ? {} : { body: params }),
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (response.status === 429)
    throw new SlackRateLimit(
      Math.max(1, Number(response.headers.get("retry-after")) || 60),
    );
  if (!response.ok)
    throw new HiveError("Slack is unavailable. Try again later.", 502);
  const data = (await response.json()) as Record<string, unknown>;
  if (data.ok !== true)
    throw new HiveError(
      `Slack could not complete ${method}: ${typeof data.error === "string" ? data.error.replace(/[^a-z_]/g, "") : "unavailable"}.`,
      502,
    );
  return data;
}
export async function channelInfo(token: string, channel: string) {
  const result = await slackCall(token, "conversations.info", { channel });
  return slackChannel.parse(result.channel);
}
export function indexable(channel: SlackChannel) {
  return (
    channel.is_member &&
    !channel.is_im &&
    !channel.is_mpim &&
    !channel.is_archived
  );
}
export async function messagePage(
  token: string,
  channel: string,
  thread?: string,
  cursor?: string,
) {
  const data = await slackCall(
    token,
    thread ? "conversations.replies" : "conversations.history",
    {
      channel,
      limit: 15,
      ...(thread ? { ts: thread } : {}),
      ...(cursor ? { cursor } : {}),
    },
  );
  return {
    messages: z.array(slackMessage).parse(data.messages),
    cursor:
      z
        .object({ next_cursor: z.string().optional() })
        .parse(data.response_metadata ?? {}).next_cursor || null,
    more: data.has_more === true,
  };
}
export async function permalink(token: string, channel: string, ts: string) {
  const data = await slackCall(token, "chat.getPermalink", {
    channel,
    message_ts: ts,
  });
  const url = z.url().parse(data.permalink);
  if (
    new URL(url).protocol !== "https:" ||
    !new URL(url).hostname.endsWith(".slack.com")
  )
    throw new HiveError("Slack returned an invalid message link.", 502);
  return url;
}
export async function postMessage(
  token: string,
  channel: string,
  text: string,
  threadTs?: string,
  blocks?: Array<Record<string, unknown>>,
) {
  const data = await slackCall(token, "chat.postMessage", {
    channel,
    text: text.slice(0, 12000),
    ...(threadTs ? { thread_ts: threadTs } : {}),
    ...(blocks ? { blocks: JSON.stringify(blocks) } : {}),
    unfurl_links: false,
    unfurl_media: false,
    parse: "none",
  });
  return z.string().parse(data.ts);
}
