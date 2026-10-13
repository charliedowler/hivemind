import Link from "next/link";
import { redirect } from "next/navigation";
import { getWebContext } from "@/server/auth";
import { humanActor } from "@/server/identity/onboarding-web";
import { memberContext } from "@/server/identity/enrollment";
import { readOrganisationInvite } from "@/server/organisation-invites";
import { publicUrl } from "@/lib/public-url";
import { CreateHive } from "@/components/create-hive";
import { InviteBlock } from "@/components/hive-invite";
export const metadata = { title: "Create a hive | Hive" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login?returnTo=%2Fapp%2Fcreate-hive");
  await humanActor(ctx);
  const { created } = await searchParams;
  if (!created)
    return (
      <div className="narrow">
        <CreateHive />
      </div>
    );
  const team = await memberContext(ctx.memberId, created);
  if (!team) return <p>This hive is no longer available.</p>;
  const invite = await readOrganisationInvite(team, await publicUrl());
  if (!invite) return <p>This hive is no longer available.</p>;
  return (
    <div className="stack narrow">
      <h1>{team.teamName} is ready</h1>
      <InviteBlock {...invite} />
      {invite.joinPaused ? (
        <Link href="/app/team">Set up joining on the Team page</Link>
      ) : null}
    </div>
  );
}
