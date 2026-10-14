import type { HiveContext } from "@hivemind/core";
import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";

// A Hive-authored notice this message may be answering, so the model and Jev can resolve "approved" or "nope".
export type SlackActionableNotice = {
  kind: "join_request";
  requestId: string;
  person: { name: string | null; email: string };
  team: string;
  status: "pending" | "approved" | "declined" | "expired";
  noticeIsThisThread: boolean;
};
export type SlackReversibleAction = {
  tool: string;
  authorIsSpeaker: boolean;
  alreadyUndone: boolean;
  withinUndoWindow: boolean;
};
export type SlackThreadContext = {
  notices: SlackActionableNotice[];
  lastReversibleAction: SlackReversibleAction | null;
};
export type SlackToolContext = {
  teamId: string;
  memberId: string;
  isAdmin: boolean;
  channelId: string;
  threadTs: string;
  messageTs?: string;
  instructionText?: string;
  requestText?: string;
  history?: Array<{ question: string; answer: string }>;
  timeZone?: string;
  threadContext?: SlackThreadContext;
  actionType?:
    "digest" | "digest_pause" | "capture" | "undo" | "decision_reverse" | "join_request" | "share";
};
export async function slackToolContext(
  actor: HiveContext,
  channelId: string,
  threadTs: string,
): Promise<SlackToolContext> {
  const rows =
    await getSql()`SELECT h.role FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.team_id=${actor.teamId} AND h.member_id=${actor.memberId} AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional`;
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
    await getSql()`SELECT m.name,t.name AS team_name FROM members m JOIN hive_memberships h ON h.member_id = m.id JOIN teams t ON t.id=h.team_id WHERE h.team_id=${ctx.teamId} AND m.id=${ctx.memberId} AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional`;
  if (!rows[0])
    throw new HiveError("Your hive membership is no longer active.", 403);
  return {
    teamId: ctx.teamId,
    memberId: ctx.memberId,
    memberName: String(rows[0].name),
    teamName: String(rows[0].team_name),
  };
}
