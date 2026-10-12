import { getAuth } from "@/server/better-auth";
import { enrollMember } from "@/server/identity/enrollment";
import { hiveRegistration } from "@/lib/hive-registration";
import { httpError, identity, readJson } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const session = await (await getAuth()).api.getSession({ headers: request.headers });
    if (!session?.user.emailVerified) return Response.json({ error: "Sign in and verify your email first." }, { status: 401 });
    const ctx = await enrollMember(session.user.id, hiveRegistration.parse(await readJson(request)));
    return ctx ? Response.json(identity(ctx)) : Response.json({ error: "Choose a team to join." }, { status: 400 });
  } catch (error) { return httpError(error); }
}
