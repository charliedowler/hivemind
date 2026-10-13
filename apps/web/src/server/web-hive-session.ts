import { cookies, headers } from "next/headers";
import type { HiveContext } from "@hivemind/core";
import { getAuth } from "./better-auth";
import { getSql } from "./db/client";
import { hashToken } from "./db/ids";
import { HiveError } from "./errors";
import { memberContext } from "./identity/enrollment";

export async function selectHive(ctx: HiveContext, teamId: string) {
  const selected = await memberContext(ctx.memberId, teamId);
  if (!selected) throw new HiveError("This hive is no longer available.", 403);
  const session = await (
    await getAuth()
  ).api.getSession({ headers: await headers() });
  const sql = getSql();
  if (session) {
    if (session.user.id !== ctx.memberId)
      throw new HiveError("Sign in first.", 401);
    const rows =
      await sql`UPDATE web_sessions SET team_id = ${teamId} WHERE id = ${session.session.id} AND member_id = ${ctx.memberId} AND expires_at > now() RETURNING id`;
    if (!rows.length) throw new HiveError("Sign in first.", 401);
  } else {
    const token = (await cookies()).get("hm_session")?.value;
    if (!token) throw new HiveError("Sign in first.", 401);
    const rows =
      await sql`UPDATE web_sessions SET team_id = ${teamId} WHERE token_hash = ${hashToken(token)} AND member_id = ${ctx.memberId} AND expires_at > now() RETURNING id`;
    if (!rows.length) throw new HiveError("Sign in first.", 401);
  }
  return selected;
}
