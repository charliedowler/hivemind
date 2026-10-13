import { timingSafeEqual } from "node:crypto";
import { runPendingCaptureRuleInstructions } from "@/server/capture-rule-instructions";

export const runtime = "nodejs";
export const maxDuration = 300;

export function authorizedCaptureCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!authorizedCaptureCron(request))
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  return Response.json({ results: await runPendingCaptureRuleInstructions(10) });
}
