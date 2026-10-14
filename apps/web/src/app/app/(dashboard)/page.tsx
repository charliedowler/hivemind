import { shareOnJoinSettings } from "@/server/share-on-join";
import Link from "next/link";
import { ShareOnJoin } from "@/components/share-on-join";
import { Feed } from "@/components/feed";
import { getWebContext } from "@/server/auth";
import { hiveChoices } from "@/server/identity/onboarding-web";
export default async function Page() {
  const ctx = await getWebContext();
  const hives = ctx ? await hiveChoices(ctx) : [];
  const personal = Boolean(
    hives.find((hive) => hive.teamId === ctx?.teamId)?.personal,
  );
  const justJoined = (
    ctx as typeof ctx & {
      justJoined?: { teamId: string; teamName: string } | null;
    }
  )?.justJoined;
  const offers = ctx
    ? (await Promise.all(hives.filter((hive) => !hive.personal).map((hive) => shareOnJoinSettings(ctx, hive.teamId)))).filter((offer) => offer !== null)
    : [];
  const current = offers.find((offer) => offer.teamId === ctx?.teamId);
  return (
    <>
      {ctx && justJoined ? (
        <p role="status">You're in {justJoined.teamName}.</p>
      ) : null}
      {offers.filter((offer) => !offer.decision).map((offer) => <ShareOnJoin key={offer.teamId} {...offer} preselect={offer.teamId === justJoined?.teamId} />)}
      {current?.decision && current.mode === "selected" && !current.projects.length ? <p>Hive is set to selected projects only and none are listed; <Link href="/app/account#projects">change that on Account</Link>{current.decision === "yes" ? " and they'll be shared" : ""}.</p> : null}
      <Feed teamName={ctx?.teamName} personal={personal} />
    </>
  );
}
