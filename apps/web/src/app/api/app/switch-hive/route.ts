import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { requireSameOrigin } from "@/lib/web-mutation";
import { selectHive } from "@/server/web-hive-session";
export async function POST(request: Request) {
  return authenticated(async (ctx) => {
    requireSameOrigin(request);
    const { teamId } = z
      .strictObject({ teamId: z.string().min(1).max(80) })
      .parse(await readJson(request));
    await selectHive(ctx, teamId);
    return Response.json({ ok: true });
  });
}
