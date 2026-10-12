import Link from "next/link";
import { Login } from "@/components/login";
import { getBaseUrl } from "@/lib/base-url";
import { ErrorPanel } from "@/components/primitives";
import { errorMessage } from "@/lib/client";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  try {
    const [baseUrl, params] = await Promise.all([getBaseUrl(), searchParams]);
    return <main className="page"><Link className="brand login-brand" href="/"><span className="hive-mark" aria-hidden="true" />Hivemind</Link><Login baseUrl={baseUrl} invite={typeof params.invite === "string" ? params.invite : ""} /></main>;
  } catch (error) { return <main className="page"><ErrorPanel message={errorMessage(error)} /></main>; }
}
