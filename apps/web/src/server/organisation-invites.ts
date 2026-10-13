import type { HiveContext } from "@hivemind/core";
import { teamInvitePrompt } from "@/lib/agent-onboarding";
import { getSql } from "./db/client";
import { hashToken } from "./db/ids";
import { deliverEmail, emailConfigured } from "./identity/email";
import { renderOrganisationCreated } from "./identity/welcome-template";

export type OrganisationInvite = {
  teamId: string;
  teamName: string;
  joinUrl: string;
  invitePrompt: string;
  joinPaused: boolean;
};

export async function readOrganisationInvite(
  ctx: HiveContext,
  baseUrl: string,
): Promise<OrganisationInvite | null> {
  const rows =
    await getSql()`SELECT t.id, t.name, t.join_paused, p.phrase FROM teams t JOIN hive_memberships h ON h.team_id = t.id AND h.member_id = ${ctx.memberId} AND h.removed_at IS NULL JOIN members m ON m.id = h.member_id AND m.disabled_at IS NULL AND NOT m.provisional JOIN hive_join_phrases p ON p.team_id = t.id AND p.retired_at IS NULL AND p.generation = t.join_generation WHERE t.id = ${ctx.teamId} AND t.personal_owner_member_id IS NULL`;
  if (!rows[0]) return null;
  const teamName = String(rows[0].name);
  const joinUrl = `${baseUrl.replace(/\/+$/, "")}/j/${rows[0].phrase}`;
  return {
    teamId: String(rows[0].id),
    teamName,
    joinUrl,
    invitePrompt: teamInvitePrompt(teamName, joinUrl),
    joinPaused: Boolean(rows[0].join_paused),
  };
}

export async function deliverOrganisationCreated(
  ctx: HiveContext,
  invite: OrganisationInvite,
): Promise<boolean> {
  if (!emailConfigured()) return false;
  return getSql().begin(async (tx) => {
    const members =
      await tx`SELECT m.name, m.email FROM members m JOIN hive_memberships h ON h.member_id = m.id AND h.team_id = ${invite.teamId} AND h.role = 'admin' AND h.removed_at IS NULL WHERE m.id = ${ctx.memberId} AND m.actor_type = 'human' AND m.email_verified AND m.disabled_at IS NULL AND NOT m.provisional FOR UPDATE OF m`;
    if (!members[0]) return false;
    const receipt = `organisation-email:${hashToken(`${ctx.memberId}:${invite.teamId}`)}`;
    const prior =
      await tx`SELECT value FROM auth_verification WHERE id = ${receipt} FOR UPDATE`;
    if (prior[0]?.value === "delivered") return true;
    const message = renderOrganisationCreated({
      name: String(members[0].name ?? ""),
      ...invite,
    });
    const delivered = await deliverEmail(
      String(members[0].email),
      message.subject,
      message.text,
      receipt,
      message.html,
    );
    if (delivered)
      await tx`INSERT INTO auth_verification (id, identifier, value, expires_at) VALUES (${receipt}, ${receipt}, 'delivered', now() + interval '100 years') ON CONFLICT (id) DO UPDATE SET value = 'delivered'`;
    return delivered;
  });
}
