import { withHiveBearerAuth } from "@/server/bearer-auth";
import { agentStatus } from "@/server/identity/agent-credentials";
import { httpError } from "@/lib/http";
export async function GET(request: Request) {
  try { return await withHiveBearerAuth(request, async (_request, ctx) => Response.json(await agentStatus(ctx), { headers: { "Cache-Control": "no-store" } })); }
  catch (error) { return httpError(error); }
}
