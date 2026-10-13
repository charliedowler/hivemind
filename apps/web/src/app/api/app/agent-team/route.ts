import { z } from "zod";
import { getAuth } from "@/server/better-auth";
import { agentEnrollmentNotice, enrollAgent } from "@/server/identity/agent-enrollment";
import { httpError, readJson } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const session = await (await getAuth()).api.getSession({ headers: request.headers });
    if (!session?.user.emailVerified) return Response.json({ error: "Sign in first." }, { status: 401 });
    const { teamId } = z.object({ teamId: z.string().min(1).max(100) }).parse(await readJson(request));
    const ctx = await enrollAgent(session.user.id, undefined, teamId);
    return Response.json({ joined: Boolean(ctx), notice: await agentEnrollmentNotice(session.user.id) });
  } catch (error) { return httpError(error); }
}
