import { Feed } from "@/components/feed";
import { getWebContext } from "@/server/auth";
import { hiveChoices } from "@/server/identity/onboarding-web";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, ctx] = await Promise.all([searchParams, getWebContext()]);
  const hives = ctx ? await hiveChoices(ctx) : [];
  const personal = Boolean(
    hives.find((hive) => hive.teamId === ctx?.teamId)?.personal,
  );
  return (
    <>
      {ctx && (!personal || params.joined === "1") ? (
        <p role="status">You're in {ctx.teamName}.</p>
      ) : null}
      <Feed teamName={ctx?.teamName} personal={personal} />
    </>
  );
}
