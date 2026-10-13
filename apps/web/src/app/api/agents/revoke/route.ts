import { withHiveBearerAuth } from "@/server/bearer-auth";
import { revokeAgentCredential } from "@/server/identity/agent-credentials";
import { httpError } from "@/lib/http";
export async function POST(request: Request) {
  try { return await withHiveBearerAuth(request, async (_request, ctx) => { await revokeAgentCredential(ctx); return Response.json({ revoked: true }); }); }
  catch (error) { return httpError(error); }
}
