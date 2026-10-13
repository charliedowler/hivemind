import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import {
  joinFailure,
  joinOrganisation,
} from "@/server/identity/onboarding-web";
import { trustedProxyIp } from "@/server/trusted-proxy";
import { selectHive } from "@/server/web-hive-session";

export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    try {
      const { phrase } = z
        .strictObject({ phrase: z.string().min(1).max(80) })
        .parse(await readJson(request));
      const joined = await joinOrganisation(
        ctx,
        phrase,
        trustedProxyIp(request),
      );
      await selectHive(ctx, joined.teamId);
      return Response.json({
        teamName: joined.teamName,
        destination: `/app?joined=1`,
      });
    } catch {
      return Response.json({ error: joinFailure }, { status: 403 });
    }
  });
}
