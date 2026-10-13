import { getAuth } from "@/server/better-auth";
import { enabledSignInProviders } from "@/lib/auth-providers";

export async function GET(request: Request) {
  if (!enabledSignInProviders().includes("agentid")) return Response.json({ error: "Agent sign-in is not configured." }, { status: 503 });
  const query = new URL(request.url).searchParams;
  const invite = query.get("invite");
  query.delete("login_hint");
  const { headers, response } = await (await getAuth()).api.signInSocial({
    body: {
      provider: "agentid",
      callbackURL: `/app/join${query.size ? `?${query}` : ""}`,
      loginHint: new URL(request.url).searchParams.get("login_hint") ?? undefined,
      additionalData: invite ? { hiveRegistration: { intent: "invite", inviteCode: invite } } : undefined,
    },
    headers: request.headers,
    returnHeaders: true,
  });
  if (!response.url) return Response.json({ error: "Agent sign-in could not start." }, { status: 503 });
  const redirect = new Response(null, { status: 302, headers: { Location: response.url } });
  for (const cookie of headers.getSetCookie()) redirect.headers.append("Set-Cookie", cookie);
  return redirect;
}
