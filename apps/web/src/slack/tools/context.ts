import type { HiveContext } from "@hivemind/core";
import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";

export type SlackToolContext = {
  teamId: string;
  memberId: string;
  isAdmin: boolean;
  channelId: string;
  threadTs: string;
  messageTs?: string;
  instructionText?: string;
  timeZone?: string;
  actionType?: "digest" | "digest_pause" | "capture" | "undo";
};
export async function slackToolContext(
  actor: HiveContext,
  channelId: string,
  threadTs: string,
): Promise<SlackToolContext> {
  const rows =
    await getSql()`SELECT role FROM members WHERE team_id=${actor.teamId} AND id=${actor.memberId} AND removed_at IS NULL`;
  if (!rows[0])
    throw new HiveError("Join the hive before using its Slack tools.", 403);
  return {
    teamId: actor.teamId,
    memberId: actor.memberId,
    isAdmin: rows[0].role === "admin",
    channelId,
    threadTs,
  };
}
export async function toolActor(ctx: SlackToolContext): Promise<HiveContext> {
  const rows =
    await getSql()`SELECT m.name,t.name AS team_name FROM members m JOIN teams t ON t.id=m.team_id WHERE m.team_id=${ctx.teamId} AND m.id=${ctx.memberId} AND m.removed_at IS NULL`;
  if (!rows[0])
    throw new HiveError("Your hive membership is no longer active.", 403);
  return {
    teamId: ctx.teamId,
    memberId: ctx.memberId,
    memberName: String(rows[0].name),
    teamName: String(rows[0].team_name),
  };
}
