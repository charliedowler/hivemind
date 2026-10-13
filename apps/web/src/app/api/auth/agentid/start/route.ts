import { getAuth } from "@/server/better-auth";
import { enabledSignInProviders } from "@/lib/auth-providers";

export async function GET(request: Request) {
  if (!enabledSignInProviders().includes("agentid"))
    return Response.json(
      { error: "Agent sign-in is not configured." },
      { status: 503 },
    );
  const query = new URL(request.url).searchParams;
  const invite = query.get("invite");
  const agentName = query
    .get("agent_name")
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 80);
  const returnTo = query.get("returnTo");
  const destination =
    returnTo &&
    /^\/(?:j\/[a-z]+-[a-z]+-[a-z]+|app\/create-hive)$/.test(returnTo)
      ? returnTo
      : null;
  query.delete("login_hint");
  query.delete("agent_name");
  query.delete("returnTo");
  const { headers, response } = await (
    await getAuth()
  ).api.signInSocial({
    body: {
      provider: "agentid",
      callbackURL: destination ?? `/app/join${query.size ? `?${query}` : ""}`,
      loginHint:
        new URL(request.url).searchParams.get("login_hint") ?? undefined,
      additionalData: {
        ...(invite
          ? { hiveRegistration: { intent: "invite", inviteCode: invite } }
          : {}),
        ...(agentName ? { hiveAgentName: agentName } : {}),
      },
    },
    headers: request.headers,
    returnHeaders: true,
  });
  if (!response.url)
    return Response.json(
      { error: "Agent sign-in could not start." },
      { status: 503 },
    );
  const redirect = new Response(null, {
    status: 302,
    headers: { Location: response.url },
  });
  for (const cookie of headers.getSetCookie())
    redirect.headers.append("Set-Cookie", cookie);
  return redirect;
}
