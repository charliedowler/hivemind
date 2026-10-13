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
  return (
    <>
      {ctx && justJoined ? (
        <p role="status">You're in {justJoined.teamName}.</p>
      ) : null}
      <Feed teamName={ctx?.teamName} personal={personal} />
    </>
  );
}
