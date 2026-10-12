import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { Sprite } from "@hivemind/design-system";
import { Login } from "@/components/login";
import { ErrorPanel } from "@/components/primitives";
import { errorMessage } from "@/lib/client";
import { enabledSignInProviders } from "@/lib/auth-providers";
import { pageQuery, type PageQuery } from "@/lib/oauth-query";
import { getAuth } from "@/server/better-auth";

export const dynamic = "force-dynamic";
export default async function LoginPage({ searchParams }: { searchParams: Promise<PageQuery> }) {
  const params = await searchParams;
  const jar = await cookies();
  if (jar.get("better-auth.session_token") || jar.get("__Secure-better-auth.session_token")) {
    const session = await (await getAuth()).api.getSession({ headers: await headers() });
    if (session?.user.emailVerified) redirect(params.client_id ? `/api/auth/oauth2/authorize?${pageQuery(params)}` : "/app/join");
  }
  try {
    return <main className="page">
      <Link className="brand login-brand" href="/"><Sprite name="bee" scale={3} />Hive</Link>
      <Login invite={typeof params.invite === "string" ? params.invite : ""} providers={enabledSignInProviders()} initialError={params.error ? "Sign-in could not finish. Try again or use your email." : ""} />
    </main>;
  } catch (error) { return <main className="page"><ErrorPanel message={errorMessage(error)} /></main>; }
}
