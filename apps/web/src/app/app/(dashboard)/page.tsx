import { Feed } from "@/components/feed";
import { getWebContext } from "@/server/auth";
import { agentEnrollmentNotice } from "@/server/identity/agent-enrollment";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = params.agent_joined === "1" ? await getWebContext() : null;
  const notice = ctx ? await agentEnrollmentNotice(ctx.memberId) : null;
  return <>{notice ? <p role="status">{notice}</p> : null}<Feed /></>;
}
