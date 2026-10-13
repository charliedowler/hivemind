import { timingSafeEqual } from "node:crypto";
import { tickDigests } from "@/server/digests/runner";
import { digestTransport } from "@/server/digests/connection";
export const runtime = "nodejs";
export const maxDuration = 300;
export function authorizedCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`),
    actual = Buffer.from(request.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function GET(request: Request) {
  if (!authorizedCron(request))
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  return Response.json({
    results: await tickDigests(
      digestTransport,
      new URL(request.url).searchParams.get("team") ?? undefined,
    ),
  });
}
