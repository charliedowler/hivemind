import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { Card, Sprite } from "@hivemind/design-system";
import { getWebContext } from "@/server/auth";
import { joinRequestLanding } from "@/server/identity/join-requests";
import { ShareOnJoin, type ShareOffer } from "@/components/share-on-join";
import { shareOnJoinOffer } from "@/server/share-on-join";
import { RequestToJoin, ApprovedJoin } from "@/components/request-to-join";
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
function JoinFrame({ children }: { children: ReactNode }) {
  return (
    <main className="page narrow stack">
      <Link className="brand" href="/">
        <Sprite name="bee" scale={3} />
        Hive
      </Link>
      {children}
    </main>
  );
}
function SignInToJoin({ phrase }: { phrase: string }) {
  return (
    <Card className="stack">
      <h1>Sign in to join a hive</h1>
      <p>Use your own work account. Your personal hive stays yours.</p>
      <ProviderButtons
        providers={enabledSignInProviders()}
        returnTo={`/j/${encodeURIComponent(phrase)}`}
      />
      <Link href={`/app/login?returnTo=${encodeURIComponent(`/j/${phrase}`)}`}>
        Sign in with email
      </Link>
    </Card>
  );
}
type Landing = Awaited<ReturnType<typeof joinRequestLanding>>;
function JoinContent({
  phrase,
  team,
  offer,
}: {
  phrase: string;
  team: Landing | null;
  offer: ShareOffer | null;
}) {
  if (!team) return <p role="status">{joinFailure}</p>;
  if (team.joined)
    return (
      <>
        <ApprovedJoin phrase={phrase} teamName={team.teamName} />
        {offer ? <ShareOnJoin {...offer} /> : null}
      </>
    );
  if (!team.automatic)
    return (
      <RequestToJoin
        phrase={phrase}
        teamName={team.teamName}
        domains={team.domains}
        status={team.requestStatus}
        retryAt={team.retryAt}
      />
    );
  return (
    <JoinHive
      phrase={phrase}
      teamName={team.teamName}
      sharedProjects={team.sharedProjects}
    />
  );
}
export default async function Page({
  params,
}: {
  params: Promise<{ phrase: string }>;
}) {
  const [{ phrase }, ctx] = await Promise.all([params, getWebContext()]);
  if (!ctx)
    return (
      <JoinFrame>
        <SignInToJoin phrase={phrase} />
      </JoinFrame>
    );
  let team: Landing | null;
  try {
    team = await joinRequestLanding(
      ctx,
      phrase,
      trustedProxyIp(
        new Request("https://gohive.dev", { headers: await headers() }),
      ),
    );
  } catch {
    team = null;
  }
  const offer = team?.joined ? await shareOnJoinOffer(ctx, team.teamId) : null;
  return (
    <JoinFrame>
      <JoinContent phrase={phrase} team={team} offer={offer} />
    </JoinFrame>
  );
}
