import Link from "next/link";
import { Sprite } from "@hivemind/design-system";
import { Login } from "@/components/login";
import { publicUrl } from "@/lib/public-url";
import { ErrorPanel } from "@/components/primitives";
import { errorMessage } from "@/lib/client";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  try {
    const [baseUrl, params] = await Promise.all([publicUrl(), searchParams]);
    return (
      <main className="page">
        <Link className="brand login-brand" href="/">
          <Sprite name="bee" scale={3} />
          Hive
        </Link>
        <Login
          baseUrl={baseUrl}
          invite={typeof params.invite === "string" ? params.invite : ""}
        />
      </main>
    );
  } catch (error) {
    return (
      <main className="page">
        <ErrorPanel message={errorMessage(error)} />
      </main>
    );
  }
}
