import { hiveAskInput } from "@hivemind/core";
import { askHive } from "@/server/hive";
import { authenticated, readJson } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    const result = await askHive(ctx, hiveAskInput.parse(await readJson(request)));
    return Response.json(result);
  });
}
