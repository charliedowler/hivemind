import { redirect } from "next/navigation";
import { getWebContext } from "@/server/auth";
import { account } from "@/server/identity/access";
import { getSql } from "@/server/db/client";
import { listCaptureRules } from "@/server/capture-rules";
import { ownerCapturePolicy } from "@/server/project-sharing";
import { Account } from "@/components/account";
export default async function Page() {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  const [data, credentials, rules, policy] = await Promise.all([
    account(ctx),
    getSql()`SELECT EXISTS (SELECT 1 FROM auth_accounts WHERE user_id = ${ctx.memberId} AND provider_id = 'credential' AND password IS NOT NULL) AS has_password`,
    listCaptureRules(ctx),
    ownerCapturePolicy(ctx),
  ]);
  return (
    <Account
      initial={{ member: data.member }}
      policy={policy}
      rules={rules.filter((rule) => rule.scope === "member")}
      hasPassword={Boolean(credentials[0]?.has_password)}
    />
  );
}
