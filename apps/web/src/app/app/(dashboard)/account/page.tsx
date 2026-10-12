import { redirect } from "next/navigation";
import { getWebContext } from "@/server/auth";
import { account } from "@/server/identity/access";
import { Account } from "@/components/account";
export default async function Page() {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  return <Account initial={await account(ctx)} />;
}
