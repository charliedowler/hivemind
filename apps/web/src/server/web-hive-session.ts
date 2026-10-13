import { headers } from "next/headers";
import type { HiveContext } from "@hivemind/core";
import { getAuth } from "./better-auth";
import { getSql } from "./db/client";
import { HiveError } from "./errors";
import { memberContext } from "./identity/enrollment";

export async function selectHive(ctx: HiveContext, teamId: string) {
  const selected = await memberContext(ctx.memberId, teamId);
  if (!selected) throw new HiveError("This hive is no longer available.", 403);
  const session = await (
    await getAuth()
  ).api.getSession({ headers: await headers() });
  if (!session || session.user.id !== ctx.memberId)
    throw new HiveError("Sign in first.", 401);
  await getSql()`UPDATE web_sessions SET team_id = ${teamId} WHERE id = ${session.session.id} AND member_id = ${ctx.memberId} AND expires_at > now()`;
  return selected;
}
