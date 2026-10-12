import { z } from "zod";
import { issueApiKey } from "@/server/auth";
import { authenticated, readJson } from "@/lib/http";
const keyInput = z.object({ label: z.string().trim().min(1).max(120).optional() });
export const runtime = "nodejs";
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    const input = keyInput.parse(await readJson(request));
    return Response.json(await issueApiKey(ctx, input.label), { status: 201 });
  });
}
