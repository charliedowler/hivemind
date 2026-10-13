import { joinOrRequest } from "@/server/identity/join-requests";
import { HiveError } from "@/server/errors";
import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import {
  joinFailure,
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
      const joined = await joinOrRequest(
        ctx,
        phrase,
        trustedProxyIp(request),
      );
      if (joined.status === "requested") return Response.json({status:"requested"});
      await selectHive(ctx, joined.teamId);
      return Response.json({
        teamName: joined.teamName,
        destination: `/app?joined=1`,
      });
    } catch (error) {
      return Response.json({ error: joinFailure }, { status: error instanceof HiveError ? error.status : 403 });
    }
  });
}
