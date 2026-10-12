import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getWebContext } from "@/server/auth";
import { requireAdmin } from "@/server/identity/access";
import { Navigation } from "@/components/navigation";
import { ErrorPanel } from "@/components/primitives";
import { errorMessage } from "@/lib/client";
export const dynamic = "force-dynamic";
export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  let ctx;
  try {
    ctx = await getWebContext();
  } catch (error) {
    return (
      <main className="page narrow stack">
        <Link className="brand" href="/">
          Hive
        </Link>
        <ErrorPanel message={errorMessage(error)} />
        <Link href="/app/login" className="text-button">
          Go to sign in
        </Link>
      </main>
    );
  }
  if (!ctx) redirect("/app/login");
  const isAdmin = await requireAdmin(ctx)
    .then(() => true)
    .catch(() => false);
  return (
    <>
      <Navigation
        teamName={ctx.teamName}
        memberName={ctx.memberName}
        isAdmin={isAdmin}
      />
      <main className="page">{children}</main>
    </>
  );
}
