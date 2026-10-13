import { randomUUID } from "node:crypto";
import { z } from "zod";
import { recordEvent } from "@/server/analytics/events";

const input = z.strictObject({ route: z.string().max(300).regex(/^\/[^?#]*$/), digest: z.string().max(128).regex(/^[a-zA-Z0-9_-]+$/).nullable() });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const body = await request.text();
  if (body.length > 1024) return new Response(null, { status: 413 });
  let parsed;
  try { parsed = input.safeParse(JSON.parse(body)); } catch { return new Response(null, { status: 400 }); }
  if (!parsed.success) return new Response(null, { status: 400 });
  await recordEvent({ name: "error.page_shown", key: randomUUID(), outcome: "failed", properties: parsed.data });
  return new Response(null, { status: 204 });
}
