import type { HiveContext } from "@hivemind/core";
import { getSql } from "@/server/db/client";
import { listHiveContexts, memberContext } from "@/server/identity/enrollment";
import { hasPersonScope } from "@/server/identity/credential-scope";
import { memberJoinPhrase } from "@/server/identity/join-phrases";
import { HiveError } from "@/server/errors";

export type CurrentHiveInvite =
  | {
      teamName: string;
      joinUrl: string | null;
      invitePrompt: string | null;
      joinPaused: boolean;
    }
  | { joinUrl: null; hint: string };

async function currentHiveInvite(ctx: HiveContext): Promise<CurrentHiveInvite> {
  if (!(await memberContext(ctx.memberId, ctx.teamId))) {
    throw new HiveError(
      "This token has no active membership in its hive.",
      403,
    );
  }
  const [hive] =
    await getSql()`SELECT t.name, t.personal_owner_member_id, t.join_paused FROM teams t JOIN hive_memberships h ON h.team_id = t.id AND h.member_id = ${ctx.memberId} AND h.removed_at IS NULL JOIN members m ON m.id = h.member_id AND m.disabled_at IS NULL AND NOT m.provisional WHERE t.id = ${ctx.teamId}`;
  if (!hive)
    throw new HiveError(
      "This token has no active membership in its hive.",
      403,
    );
  if (hive.personal_owner_member_id !== null) {
    return {
      joinUrl: null,
      hint: "Create a hive for your team at https://gohive.dev/app/account",
    };
  }
  const phrase = await memberJoinPhrase(ctx);
  const teamName = String(hive.name);
  const joinUrl = phrase ? `https://gohive.dev/j/${phrase.phrase}` : null;
  return {
    teamName,
    joinUrl,
    invitePrompt: joinUrl
      ? `Set me up on Hive and join the ${teamName} hive: read https://gohive.dev/agent and follow it, then join with ${joinUrl}`
      : null,
    joinPaused: phrase?.paused ?? Boolean(hive.join_paused),
  };
}

export type HiveOrganisationInvitation = Extract<
  CurrentHiveInvite,
  { teamName: string }
> & { teamId: string };
export type HiveInviteLink =
  | CurrentHiveInvite
  | { invitations: HiveOrganisationInvitation[] };

export async function hiveInviteLink(
  ctx: HiveContext,
): Promise<HiveInviteLink> {
  if (!hasPersonScope(ctx)) return currentHiveInvite(ctx);
  if (!(await memberContext(ctx.memberId, ctx.teamId))) {
    throw new HiveError(
      "This token has no active membership in its hive.",
      403,
    );
  }
  const organisations = (await listHiveContexts(ctx.memberId)).filter(
    (hive) => !hive.personal,
  );
  const invitations = await Promise.all(
    organisations.map(async (organisation) => {
      const invite = await currentHiveInvite(organisation);
      if (!("teamName" in invite)) {
        throw new HiveError(
          "This organisation membership is no longer active.",
          403,
        );
      }
      return { teamId: organisation.teamId, ...invite };
    }),
  );
  if (!invitations.length)
    return {
      invitations,
      joinUrl: null,
      hint: "Create a hive for your team at https://gohive.dev/app/account",
    };
  return invitations.length === 1
    ? { ...invitations[0], invitations }
    : { invitations };
}
