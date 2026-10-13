import { redirect } from "next/navigation";
import { personalMemberContext } from "@/server/identity/enrollment";
import { getWebContext } from "@/server/auth";
import { account } from "@/server/identity/access";
import { InstallPage } from "@/components/install";
import { publicUrl } from "@/lib/public-url";
import { ErrorPanel } from "@/components/primitives";
import { errorMessage } from "@/lib/client";
export const metadata = { title: "Connect | Hive" };

export default async function Page() {
  const selected = await getWebContext();
  if (!selected) redirect("/app/login");
  const ctx = await personalMemberContext(selected.memberId);
  if (!ctx) redirect("/app");
  try {
    const [baseUrl, data] = await Promise.all([publicUrl(), account(ctx)]);
    return (
      <>
        <InstallPage baseUrl={baseUrl} initialKeys={data.keys} />
      </>
    );
  } catch (error) {
    return <ErrorPanel message={errorMessage(error)} />;
  }
}
