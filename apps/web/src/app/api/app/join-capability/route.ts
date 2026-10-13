import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { issueJoinCapability } from "@/server/identity/join-phrases";
import { humanActor } from "@/server/identity/onboarding-web";
import { trustedProxyIp } from "@/server/trusted-proxy";
import { joinFailure } from "@/lib/onboarding-copy";

export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    try {
      await humanActor(ctx);
      const data = z
        .strictObject({
          phrase: z.string().trim().min(1).max(80),
          agentId: z.string().min(1).max(120),
        })
        .parse(await readJson(request));
      return Response.json(
        await issueJoinCapability(ctx, data.phrase, data.agentId, {
          trustedProxyIp: trustedProxyIp(request),
        }),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch {
      return Response.json({ error: joinFailure }, { status: 403 });
    }
  });
}
