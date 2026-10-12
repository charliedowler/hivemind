import { hiveSearchInput } from "@hivemind/core";
import { searchLearnings } from "@/server/hive";
import { authenticated, readJson } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    const result = await searchLearnings(ctx, hiveSearchInput.parse(await readJson(request)));
    return Response.json({ hits: result });
  });
}
