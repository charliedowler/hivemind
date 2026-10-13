import { headers } from "next/headers";
import { getAuth } from "@/server/better-auth";
import { getWebContext } from "@/server/auth";
import { getSql } from "@/server/db/client";
import { ErrorShell } from "@/components/error-shell";
import { signOutAndContinue } from "@/app/app/actions";

export default async function Forbidden() {
  const session = await (
    await getAuth()
  ).api.getSession({ headers: await headers() });
  const ctx = await getWebContext();
  const teams = session
    ? await getSql()`SELECT t.name FROM hive_memberships h JOIN teams t ON t.id = h.team_id WHERE h.member_id = ${session.user.id} AND h.removed_at IS NULL ORDER BY h.joined_at LIMIT 1`
    : [];
  const teamName = teams[0]?.name ?? "this hive";
  return (
    <ErrorShell
      code="403"
      title="You do not have access to this page."
      actions={
        <form action={signOutAndContinue}>
          <button className="hm-btn hm-btn-primary hm-btn-md" type="submit">
            Sign out
          </button>
        </form>
      }
    >
      <p>
        {ctx
          ? `You are signed in as ${session?.user.email ?? ctx.memberName} but need an admin role in ${ctx.teamName} to open this page.`
          : `You are signed in as ${session?.user.email ?? "a member"} but not a member of ${teamName}.`}
      </p>
    </ErrorShell>
  );
}
