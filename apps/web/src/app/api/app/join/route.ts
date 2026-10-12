import { joinTeamInput } from "@hivemind/core";
import { joinTeam, startWebSession } from "@/server/auth";
import { httpError, identity, readJson } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const result = await joinTeam(joinTeamInput.parse(await readJson(request)));
    if (!result) return Response.json({ error: "Invite code not found." }, { status: 404 });
    await startWebSession(result.ctx);
    return Response.json({ ...identity(result.ctx), apiKey: result.apiKey, }, { status: 201 });
  } catch (error) { return httpError(error); }
}
