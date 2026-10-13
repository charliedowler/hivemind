import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { selectHive } from "@/server/web-hive-session";
import { createOrganisation } from "@/server/identity/onboarding-web";
import {
  readOrganisationInvite,
  deliverOrganisationCreated,
} from "@/server/organisation-invites";
import { publicUrl } from "@/lib/public-url";
import { HiveError } from "@/server/errors";

export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    const { requestKey } = z
      .strictObject({ requestKey: z.string().uuid() })
      .parse(await readJson(request));
    const created = await createOrganisation(ctx, requestKey);
    await selectHive(ctx, created.teamId);
    const invite = await readOrganisationInvite(
      { ...ctx, teamId: created.teamId },
      await publicUrl(),
    );
    if (!invite)
      throw new HiveError("The join link is not available. Try again.", 503);
    await deliverOrganisationCreated(ctx, invite);
    return Response.json(invite);
  });
}
