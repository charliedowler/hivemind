import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";
import { HiveError } from "../errors";
import { listSlackChannels, postSlackMessage } from "../slack/api";
import { validateChannel, installation } from "../slack/install";
import { permalink, slackCall } from "../slack/client";
import { DigestDeliveryError, type DigestTransport } from "./runner";
import type { DigestChannel } from "./store";
export async function digestChannels(
  ctx: HiveContext,
): Promise<DigestChannel[]> {
  const installed =
    await getSql()`SELECT team_id FROM slack_installations WHERE team_id=${ctx.teamId} AND active`;
  if (!installed.length) return [];
  return (await listSlackChannels(ctx.teamId)).map((c) => ({
    id: c.id,
    name: c.name,
  }));
}
export async function digestChannel(
  ctx: HiveContext,
  id: string,
): Promise<DigestChannel> {
  const { channel } = await validateChannel(ctx.teamId, id);
  return { id: channel.id, name: channel.name };
}
export async function slackMemberTimezone(teamId: string, memberId: string) {
  const rows =
    await getSql()`SELECT a.slack_user_id FROM slack_actor_links a JOIN members m ON m.id=a.member_id AND m.team_id=a.team_id WHERE a.team_id=${teamId} AND a.member_id=${memberId} AND m.removed_at IS NULL LIMIT 1`;
  if (!rows[0]) return "UTC";
  const inst = await installation(teamId);
  const data = await slackCall(inst.token, "users.info", {
    user: String(rows[0].slack_user_id),
  });
  const user = data.user as { tz?: string } | undefined;
  try {
    if (user?.tz) {
      new Intl.DateTimeFormat("en", { timeZone: user.tz });
      return user.tz;
    }
  } catch {}
  return "UTC";
}
export const digestTransport: DigestTransport = {
  async publicOnly(schedule) {
    return !(await validateChannel(schedule.teamId, schedule.channelId)).channel
      .is_private;
  },
  async authors(teamId) {
    const rows =
      await getSql()`SELECT a.member_id,a.slack_user_id FROM slack_actor_links a JOIN members m ON m.id=a.member_id AND m.team_id=a.team_id WHERE a.team_id=${teamId} AND m.removed_at IS NULL AND m.email_verified=true`;
    return new Map(
      rows.map((r) => [String(r.member_id), String(r.slack_user_id)]),
    );
  },
  async send(schedule, digest) {
    let sent;
    try {
      sent = await postSlackMessage(schedule.teamId, schedule.channelId, {
        text: digest.text,
        blocks: digest.blocks,
      });
    } catch (error) {
      const rejected =
        error instanceof HiveError &&
        (error.status < 500 ||
          /^Slack could not complete chat.postMessage: [a-z_]+\.$/.test(
            error.message,
          ));
      throw new DigestDeliveryError(!rejected, "Slack delivery failed.");
    }
    let link: string | null = null;
    try {
      link = await permalink(
        (await installation(schedule.teamId)).token,
        sent.channelId,
        sent.ts,
      );
    } catch {}
    return { ts: sent.ts, permalink: link };
  },
};
