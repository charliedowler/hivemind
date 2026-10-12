import { hiveFeedbackInput } from "@hivemind/core";
import { recordFeedback } from "@/server/hive";
import { authenticated, readJson } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    const result = await recordFeedback(
      ctx,
      hiveFeedbackInput.parse(await readJson(request)),
    );
    return Response.json(result);
  });
}
