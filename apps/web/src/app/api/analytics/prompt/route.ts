import { z } from "zod";
import { httpError, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { recordEvent } from "@/server/analytics/events";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { attemptId } = z.strictObject({ attemptId: z.string().uuid() }).parse(await readJson(request));
    await recordEvent({ name: "onboarding.prompt_copied", key: attemptId, properties: { page: "landing" } });
    return new Response(null, { status: 204 });
  } catch (error) { return httpError(error); }
}
