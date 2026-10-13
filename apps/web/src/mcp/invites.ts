import type { HiveContext } from "@hivemind/core";
import { getSql } from "@/server/db/client";
import { memberContext } from "@/server/identity/enrollment";
import { HiveError } from "@/server/errors";

export type HiveInviteLink =
  | {
      teamName: string;
      joinUrl: string | null;
      invitePrompt: string | null;
      joinPaused: boolean;
    }
  | { joinUrl: null; hint: string };

export async function hiveInviteLink(
  ctx: HiveContext,
): Promise<HiveInviteLink> {
  if (!(await memberContext(ctx.memberId, ctx.teamId))) {
    throw new HiveError(
      "This token has no active membership in its hive.",
      403,
    );
  }
  const [hive] =
    await getSql()`SELECT t.name, t.personal_owner_member_id, t.join_paused, p.phrase FROM teams t JOIN hive_memberships h ON h.team_id = t.id AND h.member_id = ${ctx.memberId} AND h.removed_at IS NULL JOIN members m ON m.id = h.member_id AND m.disabled_at IS NULL AND NOT m.provisional LEFT JOIN hive_join_phrases p ON p.team_id = t.id AND p.retired_at IS NULL AND p.generation = t.join_generation WHERE t.id = ${ctx.teamId}`;
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
  const teamName = String(hive.name);
  const joinUrl = hive.phrase ? `https://gohive.dev/j/${hive.phrase}` : null;
  return {
    teamName,
    joinUrl,
    invitePrompt: joinUrl
      ? `Set me up on Hive and join the ${teamName} hive: read https://gohive.dev/agent and follow it, then join with ${joinUrl}`
      : null,
    joinPaused: Boolean(hive.join_paused),
  };
}
