import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Sprite } from "@hivemind/design-system";
import { Enrollment } from "@/components/enrollment";
import { getAuth } from "@/server/better-auth";
import { pageQuery, type PageQuery } from "@/lib/oauth-query";
import { selectHive } from "@/server/web-hive-session";
import { memberContext } from "@/server/identity/enrollment";
import { joinPageState } from "@/server/identity/join-page";
import { AgentTeams } from "@/components/agent-teams";

export const dynamic = "force-dynamic";
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  const params = await searchParams;
  const query = pageQuery(params);
  const session = await (
    await getAuth()
  ).api.getSession({ headers: await headers() });
  if (!session?.user.emailVerified)
    redirect(`/app/login${query ? `?${query}` : ""}`);
  const state = await joinPageState(session.user.id, params);
  const joinedTeamId = (
    state as typeof state & { joinedTeamId?: string | null }
  ).joinedTeamId;
  if (joinedTeamId) {
    const ctx = await memberContext(session.user.id, joinedTeamId);
    if (ctx) await selectHive(ctx, joinedTeamId);
  }
  if (state.destination) redirect(state.destination);
  return (
    <main className="page narrow stack">
      <Link className="brand" href="/">
        <Sprite name="bee" scale={3} />
        Hive
      </Link>
      {state.teams.length > 1 ? (
        <AgentTeams teams={state.teams} oauthQuery={state.oauthQuery} />
      ) : (
        <Enrollment
          email={session.user.email}
          invite={state.invite}
          oauthQuery={state.oauthQuery}
          agent={state.agent}
        />
      )}
    </main>
  );
}
