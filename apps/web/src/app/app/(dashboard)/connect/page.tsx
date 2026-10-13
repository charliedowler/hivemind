import { redirect } from "next/navigation";
import { getWebContext } from "@/server/auth";
import { account } from "@/server/identity/access";
import { AnalyticsBeacon } from "@/components/analytics-beacon";
import { InstallPage } from "@/components/install";
import { publicUrl } from "@/lib/public-url";
import { ErrorPanel } from "@/components/primitives";
import { errorMessage } from "@/lib/client";
export const metadata = { title: "Connect | Hive" };

export default async function Page() {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  try {
    const [baseUrl, data] = await Promise.all([publicUrl(), account(ctx)]);
    return (
      <>
        <AnalyticsBeacon page="install" />
        <InstallPage baseUrl={baseUrl} initialKeys={data.keys} />
      </>
    );
  } catch (error) {
    return <ErrorPanel message={errorMessage(error)} />;
  }
}
