import { z } from "zod";
import { hiveShareProjectsInput } from "@hivemind/core";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { humanActor } from "@/server/identity/onboarding-web";
import { delegateProjectSelection } from "@/server/project-sharing";

export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    await humanActor(ctx);
    const data = z
      .strictObject({
        agentId: z.string().min(1).max(120),
        selection: hiveShareProjectsInput,
      })
      .parse(await readJson(request));
    return Response.json(
      await delegateProjectSelection(ctx, data.agentId, data.selection),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
