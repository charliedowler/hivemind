import { pageQuery, type PageQuery } from "@/lib/oauth-query";
import { isAgentMember, ownerTeams } from "./agent-enrollment";
import { enrollMember, memberContext } from "./enrollment";

export async function joinPageState(memberId: string, params: PageQuery) {
  const agent = await isAgentMember(memberId);
  const invite = typeof params.invite === "string" ? params.invite : "";
  const query = pageQuery(params);
  const joined = invite ? await enrollMember(memberId, { intent: "invite", inviteCode: invite }) : null;
  const ctx = joined ?? await memberContext(memberId);
  const destination = ctx ? params.client_id ? `/api/auth/oauth2/authorize?${query}` : agent ? "/app?agent_joined=1" : "/app" : null;
  return { agent, invite, destination, joinedTeamId: joined?.teamId ?? null, teams: agent ? await ownerTeams(memberId) : [], oauthQuery: params.client_id ? query : "" };
}
