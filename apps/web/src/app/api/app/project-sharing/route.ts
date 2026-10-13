import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { publishProject, withdrawProject } from "@/server/project-sharing";
import { projectShareState } from "@/server/web-sharing";
import { humanActor } from "@/server/identity/onboarding-web";
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    await humanActor(ctx);
    const data = z
      .discriminatedUnion("action", [
        z.strictObject({
          action: z.literal("share"),
          teamId: z.string().min(1),
          pattern: z.string().min(1).max(256),
        }),
        z.strictObject({
          action: z.literal("withdraw"),
          teamId: z.string().min(1),
          grantId: z.string().min(1),
        }),
      ])
      .parse(await readJson(request));
    if (data.action === "share")
      await publishProject(ctx, data.teamId, data.pattern);
    else await withdrawProject(ctx, data.grantId, data.teamId);
    return Response.json(await projectShareState(ctx));
  });
}
