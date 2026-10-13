import { getSql } from "../db/client";
import { memberContext } from "./enrollment";
import { joinOrRequest } from "./join-requests";
import { HiveError } from "../errors";

export async function completePendingAgentJoins(ownerId: string) {
  const sql = getSql();
  const owner = await sql`SELECT id FROM members WHERE id = ${ownerId} AND actor_type = 'human' AND email_verified AND NOT provisional AND disabled_at IS NULL`;
  if (!owner.length) return null;
  const requests = await sql`SELECT agent_member_id, join_phrase FROM agent_credentials WHERE owner_member_id = ${ownerId} AND revoked_at IS NULL AND join_phrase IS NOT NULL ORDER BY created_at`;
  let selected = null;
  for (const request of requests) {
    const ctx = await memberContext(ownerId);
    if (!ctx) continue;
    try {
      const joined = await joinOrRequest(ctx, request.join_phrase, null);
      if (joined.status === "joined") selected = await memberContext(ownerId, joined.teamId);
      await sql`UPDATE agent_credentials SET join_phrase = NULL, join_error = NULL WHERE agent_member_id = ${request.agent_member_id}`;
    } catch (error) {
      if (!(error instanceof HiveError)) throw error;
      await sql`UPDATE agent_credentials SET join_error = ${error.message} WHERE agent_member_id = ${request.agent_member_id}`;
    }
  }
  return selected;
}
