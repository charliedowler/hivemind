import { z } from "zod";
import { pollAgentConnection } from "@/server/identity/agent-credentials";
import { rateLimit } from "@/server/identity/rate-limit";
import { httpError, readJson } from "@/lib/http";
export async function POST(request: Request) {
  try {
    const data = z.strictObject({ requestId: z.string().min(1).max(80), pollingToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).parse(await readJson(request));
    await rateLimit("agent-connect-poll", data.requestId, 60, 60);
    return Response.json(await pollAgentConnection(data.requestId, data.pollingToken), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return httpError(error); }
}
