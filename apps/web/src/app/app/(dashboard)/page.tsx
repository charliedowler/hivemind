import { shareOnJoinOffer } from "@/server/share-on-join";
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
  const offer = ctx && !personal ? await shareOnJoinOffer(ctx, ctx.teamId) : null;
  return (
    <>
      {ctx && justJoined ? (
        <p role="status">You're in {justJoined.teamName}.</p>
      ) : null}
      {offer ? <ShareOnJoin {...offer} /> : null}
      <Feed teamName={ctx?.teamName} personal={personal} />
    </>
  );
}
