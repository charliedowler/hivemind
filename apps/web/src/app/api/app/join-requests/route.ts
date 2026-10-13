import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import {
  listJoinRequests,
  decideJoinRequest,
} from "@/server/identity/join-requests";
export async function GET() {
  return authenticated(async (ctx) =>
    Response.json({ requests: await listJoinRequests(ctx) }),
  );
}
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    const { id, decision } = z
      .strictObject({
        id: z.string().min(1).max(100),
        decision: z.enum(["approve", "decline"]),
      })
      .parse(await readJson(request));
    await decideJoinRequest(ctx, id, decision);
    return Response.json({ requests: await listJoinRequests(ctx) });
  });
}
