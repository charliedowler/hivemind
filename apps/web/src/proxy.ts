import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/better-auth";
import { isAgentMember } from "@/server/identity/agent-enrollment";

export async function proxy(request: NextRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const session = await (await getAuth()).api.getSession({ headers: request.headers });
    if (session && await isAgentMember(session.user.id)) return Response.json({ error: "Ask a human team admin to change privacy rules." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/app/capture-rules/:path*" };
