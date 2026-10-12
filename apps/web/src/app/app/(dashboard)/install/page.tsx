import { InstallPage } from "@/components/install";
import { publicUrl } from "@/lib/public-url";
import { ErrorPanel } from "@/components/primitives";
import { errorMessage } from "@/lib/client";
export default async function Page() {
  try {
    return <InstallPage baseUrl={await publicUrl()} />;
  } catch (error) {
    return <ErrorPanel message={errorMessage(error)} />;
  }
}
