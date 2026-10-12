import { httpError } from "@/lib/http";
import { withHiveBearerAuth } from "@/server/bearer-auth";
import { effectiveRules } from "@/server/capture-rules";
import { originFor, withOrigin } from "@/server/analytics/events";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return await withHiveBearerAuth(request, async (_request, ctx, claims) =>
      withOrigin(
        originFor(ctx, "hook", claims ? "oauth" : "api_key"),
        async () =>
          Response.json(
            { rules: await effectiveRules(ctx) },
            {
              headers: { "Cache-Control": "private, no-store" },
            },
          ),
      ),
    );
  } catch (error) {
    return httpError(error);
  }
}
