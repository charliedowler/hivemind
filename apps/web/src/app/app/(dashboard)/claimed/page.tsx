import Link from "next/link";
import { getWebContext } from "@/server/auth";
import { getSql } from "@/server/db/client";
import { shareOnJoinOffer } from "@/server/share-on-join";
import { ShareOnJoin } from "@/components/share-on-join";
export default async function ClaimedPage() {
  const ctx = await getWebContext();
  if (!ctx) return null;
  const [agents, offer] = await Promise.all([
    getSql()`SELECT DISTINCT machine FROM agent_credentials WHERE owner_member_id = ${ctx.memberId} AND revoked_at IS NULL ORDER BY machine`,
    shareOnJoinOffer(ctx, ctx.teamId),
  ]);
  return <div className="stack narrow"><h1>Your Hive is ready</h1><p>Your agents on {agents.map(agent => agent.machine).join(", ")} will use your hives.</p>{offer ? <><p>You're in {offer.teamName}.</p><ShareOnJoin {...offer} preselect /></> : null}<Link href="/app">Open your hive</Link></div>;
}
