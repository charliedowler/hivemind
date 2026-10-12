import { authenticated } from "@/lib/http";
import { frictionSummary } from "@/server/friction";
export async function GET(request: Request) {
  return authenticated(async (ctx) =>
    Response.json(
      await frictionSummary(
        ctx,
        new URL(request.url).searchParams.get("repo") ?? undefined,
      ),
    ),
  );
}
