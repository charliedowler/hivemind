import { forbidden, redirect } from "next/navigation";
import { getWebContext } from "@/server/auth";
import { slackSettings } from "@/server/slack/store";
import { SlackSettings } from "@/components/slack-settings";
export const metadata = { title: "Slack settings | Hive" };
export default async function Page() {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  try {
    return <SlackSettings initial={await slackSettings(ctx)} />;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 403)
      forbidden();
    throw error;
  }
}
