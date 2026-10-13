import { AuthErrorPage } from "@/components/auth-error-page";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { Sprite } from "@hivemind/design-system";
import { Login } from "@/components/login";
import { ErrorPanel } from "@/components/primitives";
import { authError } from "@/lib/auth-error";
import { errorMessage } from "@/lib/client";
import { enabledSignInProviders } from "@/lib/auth-providers";
import { pageQuery, type PageQuery } from "@/lib/oauth-query";
import { getAuth } from "@/server/better-auth";

export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  const params = await searchParams;
  const returnTo =
    typeof params.returnTo === "string" &&
    /^\/(?:j\/[a-z]+-[a-z]+-[a-z]+|app\/create-hive)$/.test(params.returnTo)
      ? params.returnTo
      : undefined;
  const reason = typeof params.error === "string" ? params.error : "unknown";
  const error = params.error ? authError(reason) : undefined;
  const emailError = error?.href === "/app/login?email" ? error : undefined;
  if (error && !emailError) return <AuthErrorPage reason={reason} />;
  await redirectSignedIn(params, returnTo);
  try {
    return (
      <main className="page">
        <Link className="brand login-brand" href="/">
          <Sprite name="bee" scale={3} />
          Hive
        </Link>
        <Login
          returnTo={returnTo}
          invite={typeof params.invite === "string" ? params.invite : ""}
          providers={enabledSignInProviders()}
          initialEmailOpen={params.email !== undefined}
          initialError={
            emailError ? `${emailError.title} ${emailError.next}` : ""
          }
        />
      </main>
    );
  } catch (error) {
    return (
      <main className="page">
        <ErrorPanel message={errorMessage(error)} />
      </main>
    );
  }
}

async function redirectSignedIn(params: PageQuery, returnTo?: string) {
  const jar = await cookies();
  if (
    jar.get("better-auth.session_token") ||
    jar.get("__Secure-better-auth.session_token")
  ) {
    const session = await (
      await getAuth()
    ).api.getSession({ headers: await headers() });
    if (session?.user.emailVerified)
      redirect(
        params.client_id
          ? `/api/auth/oauth2/authorize?${pageQuery(params)}`
          : (returnTo ?? "/app/join"),
      );
  }
}
