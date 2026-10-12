import { endWebSession } from "@/server/auth";
import { getAuth } from "@/server/better-auth";
import { httpError } from "@/lib/http";
export const runtime = "nodejs";
export async function POST() {
  return Response.json({ error: "Sign in with email and password, Google or Slack." }, { status: 410 });
}
export async function DELETE(request: Request) {
  try {
    await endWebSession();
    return (await getAuth()).api.signOut({ headers: request.headers, asResponse: true });
  } catch (error) { return httpError(error); }
}
