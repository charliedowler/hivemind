import { recordEvent, originFor, withOrigin } from "@/server/analytics/events";
import { signInInput } from "@hivemind/core";
import {
  authenticateApiKey,
  startWebSession,
  endWebSession,
} from "@/server/auth";
import { httpError, identity, readJson } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const input = signInInput.parse(await readJson(request));
    const ctx = await authenticateApiKey(input.apiKey);
    if (!ctx) {
      await recordEvent({
        name: "access.changed",
        outcome: "login_failed",
        reasonCode: "invalid_credentials",
        origin: originFor(),
        properties: { actorKind: "anonymous" },
      });
      return Response.json({ error: "API key not found." }, { status: 401 });
    }
    await withOrigin(originFor(ctx, "web", "api_key"), () =>
      startWebSession(ctx),
    );
    return Response.json(identity(ctx));
  } catch (error) {
    return httpError(error);
  }
}
export async function DELETE() {
  try {
    await endWebSession();
    return new Response(null, { status: 204 });
  } catch (error) {
    return httpError(error);
  }
}
