import { InstallPage } from "@/components/install";
import { getBaseUrl } from "@/lib/base-url";
import { ErrorPanel } from "@/components/primitives";
import { errorMessage } from "@/lib/client";
export default async function Page() {
  try {
    return <InstallPage baseUrl={await getBaseUrl()} />;
  } catch (error) {
    return <ErrorPanel message={errorMessage(error)} />;
  }
}
