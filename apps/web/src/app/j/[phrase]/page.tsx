import Link from "next/link";
import { headers } from "next/headers";
import { Card, Sprite } from "@hivemind/design-system";
import { getWebContext } from "@/server/auth";
import { joinLanding } from "@/server/identity/onboarding-web";
import { trustedProxyIp } from "@/server/trusted-proxy";
import { enabledSignInProviders } from "@/lib/auth-providers";
import { ProviderButtons } from "@/components/login";
import { JoinHive } from "@/components/join-hive";
import { joinFailure } from "@/lib/onboarding-copy";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Join a hive | Hive",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function Page({
  params,
}: {
  params: Promise<{ phrase: string }>;
}) {
  const [{ phrase }, ctx] = await Promise.all([params, getWebContext()]);
  let team;
  if (ctx) {
    try {
      team = await joinLanding(
        ctx,
        phrase,
        trustedProxyIp(
          new Request("https://gohive.dev", { headers: await headers() }),
        ),
      );
    } catch {
      team = null;
    }
  }
  return (
    <main className="page narrow stack">
      <Link className="brand" href="/">
        <Sprite name="bee" scale={3} />
        Hive
      </Link>
      {!ctx ? (
        <Card className="stack">
          <h1>Sign in to join a hive</h1>
          <p>Use your own work account. Your personal hive stays yours.</p>
          <ProviderButtons
            providers={enabledSignInProviders()}
            returnTo={`/j/${encodeURIComponent(phrase)}`}
          />
          <Link
            href={`/app/login?returnTo=${encodeURIComponent(`/j/${phrase}`)}`}
          >
            Sign in with email
          </Link>
        </Card>
      ) : team ? (
        <JoinHive
          phrase={phrase}
          teamName={team.teamName}
          sharedProjects={team.sharedProjects}
        />
      ) : (
        <p role="status">{joinFailure}</p>
      )}
    </main>
  );
}
