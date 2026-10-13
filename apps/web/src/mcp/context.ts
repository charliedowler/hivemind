import type { HiveContext } from "@hivemind/core";
import { memberContext } from "@/server/identity/enrollment";
import { HiveError } from "@/server/errors";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  bindApiKey,
  bindRole,
  originFor,
  withOrigin,
} from "@/server/analytics/events";

export const contextSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  memberId: z.string(),
  memberName: z.string(),
  apiKeyId: z.string().nullish(),
  role: z.enum(["admin", "member"]).nullish(),
  sessionKind: z.enum(["api_key", "oauth"]).optional(),
  trustedProxyIp: z.string().nullable().optional(),
});
export type ToolContext = {
  http?: { authInfo?: AuthInfo; req?: { headers: Headers } };
};

export function getContext(ctx: ToolContext): HiveContext {
  const parsed = contextSchema.safeParse(ctx.http?.authInfo?.extra);
  if (!parsed.success)
    throw new HiveError("Connect your agent to the hive and sign in.", 401);
  const actor = parsed.data;
  if (actor.apiKeyId) bindApiKey(actor, actor.apiKeyId);
  if (actor.role) bindRole(actor, actor.role);
  return actor;
}

export async function withMcpContext<T>(
  ctx: ToolContext,
  action: (actor: HiveContext) => Promise<T>,
): Promise<T> {
  const actor = getContext(ctx);
  if (!(await memberContext(actor.memberId, actor.teamId))) {
    throw new HiveError(
      "This token has no active membership in its hive.",
      403,
    );
  }
  const sessionKind = ctx.http?.authInfo?.extra?.sessionKind;
  return withOrigin(
    originFor(actor, "mcp", sessionKind === "oauth" ? "oauth" : "api_key"),
    () => action(actor),
  );
}
