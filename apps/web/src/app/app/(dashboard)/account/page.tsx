import { redirect } from "next/navigation";
import { getWebContext } from "@/server/auth";
import { account } from "@/server/identity/access";
import { getSql } from "@/server/db/client";
import { Account } from "@/components/account";
export default async function Page() {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  const [data, credentials] = await Promise.all([
    account(ctx),
    getSql()`SELECT EXISTS (SELECT 1 FROM auth_accounts WHERE user_id = ${ctx.memberId} AND provider_id = 'credential' AND password IS NOT NULL) AS has_password`,
  ]);
  // TODO Round D: mount personal CaptureRules when its scope prop lands.
  return (
    <Account
      initial={{ member: data.member }}
      hasPassword={Boolean(credentials[0]?.has_password)}
    />
  );
}
