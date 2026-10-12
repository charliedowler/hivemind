import { Members } from "@/components/members";
import { getBaseUrl } from "@/lib/base-url";
import { ErrorPanel } from "@/components/primitives";
import { errorMessage } from "@/lib/client";
export default async function Page() {
  try {
    return <Members baseUrl={await getBaseUrl()} />;
  } catch (error) {
    return <ErrorPanel message={errorMessage(error)} />;
  }
}
