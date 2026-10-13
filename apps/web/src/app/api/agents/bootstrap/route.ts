import { bootstrapAgent } from "@/server/identity/agent-credentials";
import { trustedProxyIp } from "@/server/trusted-proxy";
import { httpError, readJson } from "@/lib/http";
export async function POST(request: Request) {
  try { return Response.json(await bootstrapAgent(await readJson(request), trustedProxyIp(request)), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return httpError(error); }
}
