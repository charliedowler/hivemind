import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { publishCell, withdrawPublication } from "@/server/project-sharing";
import { cellShareState } from "@/server/web-sharing";
import { humanActor } from "@/server/identity/onboarding-web";
import { HiveError } from "@/server/errors";
type Params = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Params) {
  return authenticated(async (ctx) =>
    Response.json(await cellShareState(ctx, (await params).id)),
  );
}
export async function POST(request: Request, { params }: Params) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    await humanActor(ctx);
    const { id } = await params;
    const data = z
      .strictObject({
        teamId: z.string().min(1),
        action: z.enum(["share", "withdraw"]),
        revision: z.number().int().positive(),
      })
      .parse(await readJson(request));
    if (data.action === "share") {
      const result = await publishCell(ctx, id, data.teamId, data.revision);
      if (!result.published)
        throw new HiveError(
          "This cell is kept private by your project selection or the team’s settings.",
          403,
        );
    } else await withdrawPublication(ctx, id, data.teamId);
    return Response.json(await cellShareState(ctx, id));
  });
}
