import type { Metadata } from "next";
import Link from "next/link";
import { Sprite } from "@hivemind/design-system";

export const metadata: Metadata = {
  title: "Signed in | Hive",
  robots: { index: false, follow: false },
};

export default async function SignedInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const failed = params.error === "1";
  const client = params.client === "claude"
    ? "Claude Code"
    : params.client === "codex" ? "Codex" : undefined;
  return (
    <main className="page">
      <Link href="/" className="brand login-brand">
        <Sprite name="bee" scale={3} />
        Hive
      </Link>
      <section className="hm-card stack">
        <Sprite name={failed ? "bee" : "bee-carry"} scale={4} />
        <h1>{failed ? "Sign-in did not finish." : "You're signed in."}</h1>
        <p>
          Go back to your terminal and run{" "}
          <code>{failed ? "npx gohive login" : "npx gohive status"}</code>
          {failed ? " to try again." : "."}
        </p>
        {!failed && client ? <p className="muted">Continue setting up Hive for {client}.</p> : null}
      </section>
    </main>
  );
}
