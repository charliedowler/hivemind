import { redirect } from "next/navigation";
import { Members } from "@/components/members";
import { publicUrl } from "@/lib/public-url";
import { getWebContext } from "@/server/auth";
import { memberPage } from "@/server/identity/member-page";
export default async function Page() {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  const [baseUrl, initial] = await Promise.all([publicUrl(), memberPage(ctx)]);
  return <Members baseUrl={baseUrl} initial={initial} />;
}
