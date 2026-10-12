import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Sprite } from "@hivemind/design-system";
import { Enrollment } from "@/components/enrollment";
import { getAuth } from "@/server/better-auth";
import { memberContext } from "@/server/identity/enrollment";
import { pageQuery, type PageQuery } from "@/lib/oauth-query";

export const dynamic = "force-dynamic";
export default async function JoinPage({ searchParams }: { searchParams: Promise<PageQuery> }) {
  const params = await searchParams;
  const query = pageQuery(params);
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  if (!session?.user.emailVerified) redirect(`/app/login${query ? `?${query}` : ""}`);
  if (await memberContext(session.user.id)) redirect(params.client_id ? `/api/auth/oauth2/authorize?${query}` : "/app");
  return <main className="page narrow stack">
    <Link className="brand" href="/"><Sprite name="bee" scale={3} />Hive</Link>
    <Enrollment email={session.user.email} invite={typeof params.invite === "string" ? params.invite : ""} oauthQuery={params.client_id ? query : ""} />
  </main>;
}
