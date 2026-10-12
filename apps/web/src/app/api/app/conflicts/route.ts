import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { listConflicts, resolveConflict } from "@/server/lifecycle";
export async function GET(request: Request) {
  return authenticated(async (ctx) => Response.json({ conflicts: await listConflicts(ctx, new URL(request.url).searchParams.get("history") === "true") }));
}
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    const data = z.object({ id: z.string(), action: z.enum(["confirm", "reject"]) }).parse(await readJson(request));
    return Response.json(await resolveConflict(ctx, data.id, data.action));
  });
}
