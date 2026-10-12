import { cookies } from "next/headers";
import { z } from "zod";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";
import { hashToken, newToken } from "../db/ids";
import { requireAdmin } from "../identity/access";
import { HiveError } from "../errors";
import { encryptBotToken, decryptBotToken } from "./security";
import { slackCall, channelInfo, indexable, slackChannel } from "./client";

export const botScopes = [
  "app_mentions:read",
  "channels:history",
  "groups:history",
  "im:history",
  "channels:read",
  "groups:read",
  "chat:write",
  "reactions:read",
  "reactions:write",
  "users:read",
  "users:read.email",
  "commands",
  "pins:read",
];
export function slackCallback() {
  return `${process.env.PUBLIC_URL ?? "https://gohive.dev"}/api/slack/oauth/callback`;
}
export async function beginInstall(ctx: HiveContext) {
  await requireAdmin(ctx);
  if (
    !process.env.SLACK_CLIENT_ID ||
    !process.env.SLACK_CLIENT_SECRET ||
    !process.env.SLACK_TOKEN_ENCRYPTION_KEY
  )
    throw new HiveError("Slack connection is not configured yet.", 503);
  const state = newToken(),
    browser = newToken();
  await getSql()`DELETE FROM slack_oauth_states WHERE expires_at < now()`;
  await getSql()`INSERT INTO slack_oauth_states(token_hash,team_id,member_id,browser_hash,expires_at) VALUES(${hashToken(state)},${ctx.teamId},${ctx.memberId},${hashToken(browser)},${new Date(Date.now() + 600000)})`;
  (await cookies()).set("hive_slack_install", browser, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/slack/oauth",
  });
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID);
  url.searchParams.set("scope", botScopes.join(","));
  url.searchParams.set("redirect_uri", slackCallback());
  url.searchParams.set("state", state);
  return url.toString();
}
export async function finishInstall(
  ctx: HiveContext,
  state: string,
  code: string,
) {
  await requireAdmin(ctx);
  const jar = await cookies();
  const browser = jar.get("hive_slack_install")?.value;
  if (!browser)
    throw new HiveError(
      "The Slack connection expired. Start again from settings.",
      400,
    );
  const consumed =
    await getSql()`DELETE FROM slack_oauth_states WHERE token_hash=${hashToken(state)} AND team_id=${ctx.teamId} AND member_id=${ctx.memberId} AND browser_hash=${hashToken(browser)} AND expires_at>now() RETURNING team_id`;
  jar.delete("hive_slack_install");
  if (!consumed.length)
    throw new HiveError(
      "The Slack connection expired or was already used.",
      400,
    );
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: slackCallback(),
    }),
    signal: AbortSignal.timeout(12000),
  });
  const data = z
    .object({
      ok: z.literal(true),
      access_token: z.string(),
      bot_user_id: z.string(),
      scope: z.string(),
      team: z.object({ id: z.string(), name: z.string() }),
    })
    .safeParse(await response.json());
  if (!response.ok || !data.success)
    throw new HiveError(
      "Slack did not grant a bot connection. Try connecting again.",
      502,
    );
  const scopes = data.data.scope.split(",");
  if (botScopes.some((scope) => !scopes.includes(scope)))
    throw new HiveError(
      "Slack did not grant all requested bot permissions. Update the app and reconnect.",
      400,
    );
  const ciphertext = encryptBotToken(
    data.data.access_token,
    ctx.teamId,
    data.data.team.id,
  );
  await getSql().begin(async (tx) => {
    const existing =
      await tx`SELECT team_id FROM slack_installations WHERE workspace_id=${data.data.team.id} FOR UPDATE`;
    if (existing.length && existing[0].team_id !== ctx.teamId)
      throw new HiveError(
        "This Slack workspace is connected to another hive.",
        409,
      );
    const own =
      await tx`SELECT workspace_id FROM slack_installations WHERE team_id=${ctx.teamId} FOR UPDATE`;
    if (own.length && own[0].workspace_id !== data.data.team.id)
      throw new HiveError(
        "Disconnect the current workspace before connecting another.",
        409,
      );
    await tx`INSERT INTO slack_installations(team_id,workspace_id,workspace_name,bot_user_id,token_ciphertext,installed_by,scopes) VALUES(${ctx.teamId},${data.data.team.id},${data.data.team.name},${data.data.bot_user_id},${ciphertext},${ctx.memberId},${scopes}) ON CONFLICT(team_id) DO UPDATE SET workspace_name=excluded.workspace_name,bot_user_id=excluded.bot_user_id,token_ciphertext=excluded.token_ciphertext,installed_by=excluded.installed_by,scopes=excluded.scopes,active=true`;
  });
}
export async function installation(teamId: string) {
  const rows =
    await getSql()`SELECT * FROM slack_installations WHERE team_id=${teamId} AND active=true`;
  if (!rows[0])
    throw new HiveError("Connect Slack from hive settings first.", 404);
  const row = rows[0];
  return {
    workspaceId: String(row.workspace_id),
    workspaceName: String(row.workspace_name),
    bot_user_id: String(row.bot_user_id),
    token: decryptBotToken(
      String(row.token_ciphertext),
      teamId,
      String(row.workspace_id),
    ),
  };
}
export async function resolveActor(
  teamId: string,
  slackUserId: string,
  token: string,
): Promise<HiveContext | null> {
  const data = await slackCall(token, "users.info", { user: slackUserId });
  const user = z
    .object({
      deleted: z.boolean().optional(),
      is_bot: z.boolean().optional(),
      profile: z.object({ email: z.string().optional() }),
    })
    .parse(data.user);
  if (user.deleted || user.is_bot || !user.profile.email) return null;
  const rows =
    await getSql()`SELECT m.id,m.name,t.name AS team_name FROM members m JOIN teams t ON t.id=m.team_id WHERE m.team_id=${teamId} AND lower(m.email)=${user.profile.email.toLowerCase()} AND m.email_verified=true AND m.removed_at IS NULL`;
  if (!rows[0]) return null;
  await getSql()`INSERT INTO slack_actor_links(team_id,slack_user_id,member_id) VALUES(${teamId},${slackUserId},${rows[0].id}) ON CONFLICT(team_id,slack_user_id) DO UPDATE SET member_id=excluded.member_id`;
  return {
    teamId,
    teamName: String(rows[0].team_name),
    memberId: String(rows[0].id),
    memberName: String(rows[0].name),
  };
}
export async function syncChannels(ctx: HiveContext) {
  await requireAdmin(ctx);
  const inst = await installation(ctx.teamId);
  let cursor = "";
  const found = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const data = await slackCall(inst.token, "conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    const channels = z
      .array(slackChannel)
      .parse(data.channels)
      .filter(indexable);
    for (const channel of channels) {
      found.add(channel.id);
      await getSql()`INSERT INTO slack_channels(team_id,channel_id,name,private) VALUES(${ctx.teamId},${channel.id},${channel.name},${channel.is_private}) ON CONFLICT(team_id,channel_id) DO UPDATE SET name=excluded.name,private=excluded.private,bot_member=true`;
    }
    cursor =
      z
        .object({ next_cursor: z.string().optional() })
        .parse(data.response_metadata ?? {}).next_cursor ?? "";
    if (!cursor) {
      await getSql()`UPDATE slack_channels SET bot_member=false WHERE team_id=${ctx.teamId} AND NOT(channel_id=ANY(${[...found]}::text[]))`;
      return;
    }
  }
  throw new HiveError(
    "Slack has more channels than this refresh can read. Existing selections are retained.",
    503,
  );
}
export async function validateChannel(teamId: string, channelId: string) {
  const inst = await installation(teamId);
  const channel = await channelInfo(inst.token, channelId);
  if (!indexable(channel)) {
    await getSql()`UPDATE slack_channels SET bot_member=false WHERE team_id=${teamId} AND channel_id=${channelId}`;
    throw new HiveError(
      "Hive must be invited to this channel. Direct messages cannot be indexed.",
      403,
    );
  }
  return { inst, channel };
}
