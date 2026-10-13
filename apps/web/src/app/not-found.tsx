import Link from "next/link";
import { ErrorLink, ErrorShell } from "@/components/error-shell";
import { getWebContext } from "@/server/auth";

export default async function NotFound() {
  const session = await getWebContext().catch(() => null);
  return <ErrorShell code="404" title="That page is not here." actions={<><ErrorLink href="/">Home</ErrorLink><ErrorLink href={session ? "/app" : "/app/login"}>{session ? "Dashboard" : "Sign in"}</ErrorLink></>}>
    <p><Link prefetch={false} href="/app/install">Install Hive</Link></p>
  </ErrorShell>;
}
