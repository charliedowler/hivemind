import { hiveRecentInput } from "@hivemind/core";
import { recentLearnings } from "@/server/hive";
import { authenticated } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return authenticated(async (ctx) => {
    const params = new URL(request.url).searchParams;
    const input = hiveRecentInput.parse({
      since: params.get("since") ?? "30d",
      limit: Number(params.get("limit") ?? 50),
      repo: params.get("repo") || undefined,
      kind: params.get("kind") || undefined,
    });
    return Response.json({ learnings: await recentLearnings(ctx, input) });
  });
}
