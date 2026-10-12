import { z } from "zod";
import { withHiveBearerAuth } from "@/server/bearer-auth";
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
    return await withHiveBearerAuth(request, async (request, ctx) => {
    const input = inputSchema.parse(await readJson(request));
    await rateLimit("capture", `${ctx.teamId}/${ctx.memberId}`, 30, 60);
    const result = await classifyCapture(input);
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "Server-Timing": `jev;dur=${result.classification?.latencyMs ?? 0}`,
      },
    });
    });
  } catch (error) {
    return httpError(error);
  }
}
