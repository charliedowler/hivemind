import { getSql } from "../db/client";
import { memberContext, personalMemberContext } from "./enrollment";

export async function sessionMemberContext(memberId: string, sessionId: string) {
  const rows = await getSql()`SELECT team_id FROM web_sessions WHERE id = ${sessionId} AND member_id = ${memberId} AND expires_at > now()`;
  if (!rows[0]) return null;
  return await memberContext(memberId, rows[0].team_id ?? undefined) ?? personalMemberContext(memberId);
}
