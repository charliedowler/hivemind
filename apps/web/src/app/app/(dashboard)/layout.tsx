import { AuthErrorPage } from "@/components/auth-error-page";
import { cookies, headers } from "next/headers";
import { getAuth } from "@/server/better-auth";
import type { ReactNode } from "react";
import { forbidden, redirect } from "next/navigation";
import { getWebContext } from "@/server/auth";
import { getSql } from "@/server/db/client";
import { Navigation } from "@/components/navigation";
export const dynamic = "force-dynamic";
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await getWebContext();
  if (!ctx) {
    const jar = await cookies();
    if (!jar.get("better-auth.session_token") && !jar.get("__Secure-better-auth.session_token")) redirect("/app/login");
    const session = await (await getAuth()).api.getSession({ headers: await headers() });
    if (!session) redirect("/app/login");
    if (!session.user.emailVerified) return <AuthErrorPage reason="email_not_verified" />;
    forbidden();
  }
  const [membership] = await getSql()`SELECT count(DISTINCT team_id)::int AS count FROM members WHERE id = ${ctx.memberId} AND removed_at IS NULL`;
  return (
    <>
      <Navigation
        teamName={ctx.teamName}
        memberName={ctx.memberName}
        teamCount={membership.count}
      />
      <main className="page">{children}</main>
    </>
  );
}
