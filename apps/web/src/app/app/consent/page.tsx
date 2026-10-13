import { headers } from "next/headers";
import Link from "next/link";
import { Sprite } from "@hivemind/design-system";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { Consent } from "@/components/consent";
import { AuthErrorPage } from "@/components/auth-error-page";
import { getAuth } from "@/server/better-auth";
import { memberContext } from "@/server/identity/enrollment";
import { pageQuery, type PageQuery } from "@/lib/oauth-query";

export const dynamic = "force-dynamic";
export default async function ConsentPage({ searchParams }: { searchParams: Promise<PageQuery> }) {
  const params = await searchParams;
  const query = pageQuery(params);
  const auth = await getAuth();
  const { secret } = await auth.$context;
  if (!await verifyOAuthQueryParams(query, secret)) return <AuthErrorPage reason="connection_expired" />;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const ctx = session?.user.emailVerified ? await memberContext(session.user.id) : null;
  if (!session || !ctx || typeof params.client_id !== "string") return <AuthErrorPage reason={session && !session.user.emailVerified ? "email_not_verified" : "access_changed"} />;
  let client;
  try { client = await auth.api.getOAuthClientPublic({ headers: requestHeaders, query: { client_id: params.client_id } }); }
  catch { return <AuthErrorPage reason="invalid_client" />; }
  let requestedClaims: string[] = [];
  try { requestedClaims = Object.keys(JSON.parse(typeof params.claims === "string" ? params.claims : "{}").userinfo ?? {}); } catch {}
  return <main className="page narrow stack">
    <Link className="brand" href="/"><Sprite name="bee" scale={3} />Hive</Link>
    <Consent clientName={client.client_name || "Your agent"} teamName={ctx.teamName} email={session.user.email} scopes={typeof params.scope === "string" ? params.scope.split(" ").filter(Boolean) : []} claims={requestedClaims} oauthQuery={query} />
  </main>;
}
