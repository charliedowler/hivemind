import { redirect } from "next/navigation";
import { Members } from "@/components/members";
import { SlackSettings } from "@/components/slack-settings";
import { CaptureRules } from "@/components/capture-rules";
import { ExportArchive } from "@/components/export-archive";
import { publicUrl } from "@/lib/public-url";
import { getWebContext } from "@/server/auth";
import { memberPage } from "@/server/identity/member-page";
import { teamSlackSettings } from "@/server/slack/store";
import { listCaptureRules } from "@/server/capture-rules";
import styles from "./team.module.css";

export const metadata = { title: "Team | Hive" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ debug?: string | string[] }>;
}) {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  const [baseUrl, members, slack, rules, query] = await Promise.all([
    publicUrl(),
    memberPage(ctx),
    teamSlackSettings(ctx),
    listCaptureRules(ctx),
    searchParams,
  ]);
  const isAdmin = members.overview.role === "admin";
  return (
    <div className={`stack ${styles.team}`}>
      <h1>Team</h1>
      <section
        id="members"
        className={styles.section}
        aria-labelledby="members-heading"
      >
        <h2 id="members-heading">Members</h2>
        <fieldset className={styles.controls} disabled={!isAdmin}>
          <Members baseUrl={baseUrl} initial={members} />
        </fieldset>
      </section>
      <section
        id="slack"
        className={styles.section}
        aria-labelledby="slack-heading"
      >
        <h2 id="slack-heading">Slack</h2>
        <fieldset className={styles.controls} disabled={!isAdmin}>
          <SlackSettings initial={slack} debug={query.debug !== undefined} />
        </fieldset>
      </section>
      <section
        id="keeps"
        className={styles.section}
        aria-label="What Hive keeps"
      >
        <fieldset className={styles.controls} disabled={!isAdmin}>
          <CaptureRules initial={{ rules, isAdmin }} scope="team" />
        </fieldset>
      </section>
      <section
        id="export"
        className={styles.section}
        aria-labelledby="export-heading"
      >
        <h2 id="export-heading">Export</h2>
        <fieldset className={styles.controls} disabled={!isAdmin}>
          <ExportArchive />
        </fieldset>
      </section>
    </div>
  );
}
