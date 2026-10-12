import { z } from "zod";
import { authenticateApiKey } from "@/server/auth";
import { classifyCapture } from "@/server/classify";
import { rateLimit } from "@/server/identity/rate-limit";
import { httpError, readJson } from "@/lib/http";

export const runtime = "nodejs";
const inputSchema = z.object({
  changes: z.number().int().min(0).max(10000),
  errors: z.number().int().min(0).max(10000),
  observations: z.number().int().min(0).max(10000),
  text: z.string().max(6000),
});

export async function POST(request: Request) {
  try {
    const rawKey = request.headers
      .get("authorization")
      ?.match(/^Bearer (.+)$/i)?.[1];
    const ctx = rawKey ? await authenticateApiKey(rawKey) : null;
    if (!ctx)
      return Response.json(
        { error: "A valid hive API key is required." },
        { status: 401 },
      );
    const input = inputSchema.parse(await readJson(request));
    await rateLimit("capture", `${ctx.teamId}/${ctx.memberId}`, 30, 60);
    const result = await classifyCapture(input);
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "Server-Timing": `jev;dur=${result.classification?.latencyMs ?? 0}`,
      },
    });
  } catch (error) {
    return httpError(error);
  }
}
