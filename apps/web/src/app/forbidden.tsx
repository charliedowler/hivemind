import { headers } from "next/headers";
import { getAuth } from "@/server/better-auth";
import { getWebContext } from "@/server/auth";
import { getSql } from "@/server/db/client";
import { ErrorShell, ErrorLink } from "@/components/error-shell";

export default async function Forbidden() {
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  const ctx = await getWebContext();
  const teams = session ? await getSql()`SELECT t.name FROM members m JOIN teams t ON t.id = m.team_id WHERE m.id = ${session.user.id}` : [];
  const teamName = teams[0]?.name ?? "this hive";
  return <ErrorShell code="403" title="You do not have access to this page." actions={<ErrorLink href="/app/switch-account">Switch account</ErrorLink>}>
    <p>{ctx ? `You are signed in as ${session?.user.email ?? ctx.memberName} but need an admin role in ${ctx.teamName} to open this page.` : `You are signed in as ${session?.user.email ?? "a member"} but not a member of ${teamName}.`}</p>
  </ErrorShell>;
}
