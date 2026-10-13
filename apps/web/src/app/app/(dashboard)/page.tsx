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
  return (
    <>
      {params.joined === "1" && ctx ? (
        <p role="status">
          You joined {ctx.teamName}. Your personal hive stays yours.
        </p>
      ) : null}
      <Feed
        teamName={ctx?.teamName}
        personal={Boolean(
          hives.find((hive) => hive.teamId === ctx?.teamId)?.personal,
        )}
      />
    </>
  );
}
