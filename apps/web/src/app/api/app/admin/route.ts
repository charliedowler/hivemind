import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import {
  allowDomain,
  removeMember,
  rotateInvite,
  moderateLearning,
  revokeKey,
} from "@/server/identity/access";
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite") }),
  z.object({ action: z.literal("domain") }),
  z.object({ action: z.literal("remove"), id: z.string() }),
  z.object({ action: z.literal("revoke"), id: z.string() }),
  z.object({ action: z.enum(["delete", "outdated"]), id: z.string() }),
]);
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    const data = input.parse(await readJson(request));
    if (data.action === "invite") return Response.json(await rotateInvite(ctx));
    if (data.action === "domain") await allowDomain(ctx);
    else if (data.action === "remove") await removeMember(ctx, data.id);
    else if (data.action === "revoke") await revokeKey(ctx, data.id);
    else await moderateLearning(ctx, data.id, data.action);
    return Response.json({ ok: true });
  });
}
