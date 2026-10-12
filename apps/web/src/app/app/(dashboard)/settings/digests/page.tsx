import { redirect } from "next/navigation";
import { getWebContext } from "@/server/auth";
import { account } from "@/server/identity/access";
import { digestChannels } from "@/server/digests/connection";
import { listSchedules, digestHistory } from "@/server/digests/store";
import { DigestSettings } from "@/components/digest-settings";
import "./digests.css";
export const metadata = { title: "Slack digests | Hive" };
export default async function DigestsPage() {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  const [schedules, history, channels, member] = await Promise.all([
    listSchedules(ctx.teamId),
    digestHistory(ctx.teamId),
    digestChannels(ctx),
    account(ctx),
  ]);
  return (
    <DigestSettings
      initial={{
        schedules,
        history,
        channels,
        isAdmin: member.member.role === "admin",
      }}
    />
  );
}
