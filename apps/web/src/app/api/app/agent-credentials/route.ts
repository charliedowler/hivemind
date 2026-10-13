import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { humanActor } from "@/server/identity/onboarding-web";
import { revokeAgentCredential } from "@/server/identity/agent-credentials";
export async function POST(request: Request) {
  return authenticated(async ctx => { requireSameOrigin(request); await humanActor(ctx); const { agentId } = z.strictObject({ agentId: z.string().min(1) }).parse(await readJson(request)); await revokeAgentCredential(ctx, agentId); return Response.json({ revoked: true }); });
}
