import { redirect } from "next/navigation";
import { personalMemberContext } from "@/server/identity/enrollment";
import { getWebContext } from "@/server/auth";
import { account } from "@/server/identity/access";
import { getSql } from "@/server/db/client";
import { listCaptureRules } from "@/server/capture-rules";
import { ownerCapturePolicy } from "@/server/project-sharing";
import { ownerAgentChoices, projectShareState } from "@/server/web-sharing";
import { Account } from "@/components/account";
export default async function Page() {
  const selected = await getWebContext();
  if (!selected) redirect("/app/login");
  const ctx = await personalMemberContext(selected.memberId);
  if (!ctx) redirect("/app");
  const [data, credentials, rules, policy, sharing, agents] = await Promise.all(
    [
      account(ctx),
      getSql()`SELECT EXISTS (SELECT 1 FROM auth_accounts WHERE user_id = ${ctx.memberId} AND provider_id = 'credential' AND password IS NOT NULL) AS has_password`,
      listCaptureRules(ctx),
      ownerCapturePolicy(ctx),
      projectShareState(ctx),
      ownerAgentChoices(ctx),
    ],
  );
  return (
    <Account
      initial={{ member: data.member }}
      policy={policy}
      sharing={sharing}
      agents={agents}
      rules={rules.filter((rule) => rule.scope === "member")}
      hasPassword={Boolean(credentials[0]?.has_password)}
    />
  );
}
