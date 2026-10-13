import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { selectHive } from "@/server/web-hive-session";
import { createOrganisation } from "@/server/identity/onboarding-web";

export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    const { requestKey } = z
      .strictObject({ requestKey: z.string().uuid() })
      .parse(await readJson(request));
    const created = await createOrganisation(ctx, requestKey);
    await selectHive(ctx, created.teamId);
    return Response.json(created);
  });
}
