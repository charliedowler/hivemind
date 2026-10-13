import { redirect } from "next/navigation";
import { Members } from "@/components/members";
import { SlackSettings } from "@/components/slack-settings";
import { CaptureRules } from "@/components/capture-rules";
import { KnowledgeBrowser } from "@/components/knowledge-browser";
import { publicUrl } from "@/lib/public-url";
import { getWebContext } from "@/server/auth";
import { memberPage } from "@/server/identity/member-page";
import { teamSlackSettings } from "@/server/slack/store";
import { listCaptureRules } from "@/server/capture-rules";
import styles from "./team.module.css";

export const metadata = { title: "Team | Hive" };

export default async function Page() {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  const [baseUrl, members, slack, rules] = await Promise.all([
    publicUrl(), memberPage(ctx), teamSlackSettings(ctx), listCaptureRules(ctx),
  ]);
  const isAdmin = members.overview.role === "admin";
  return (
    <div className={`stack ${styles.team}`}>
      <h1>Team</h1>
      <section className={styles.section} aria-labelledby="members">
        <h2 id="members">Members</h2>
        <Members baseUrl={baseUrl} initial={members} />
      </section>
      <section className={styles.section} aria-labelledby="slack">
        <h2 id="slack">Slack</h2>
        <fieldset className={styles.controls} disabled={!isAdmin}>
          <SlackSettings initial={slack} />
        </fieldset>
      </section>
      <section className={styles.section} aria-labelledby="keeps">
        <h2 id="keeps">What Hive keeps</h2>
        <fieldset className={styles.controls} disabled={!isAdmin}>
          <CaptureRules initial={{ rules, isAdmin }} scope="team" />
        </fieldset>
      </section>
      <section className={styles.section} aria-labelledby="export">
        <h2 id="export">Export</h2>
        <fieldset className={styles.controls} disabled={!isAdmin}>
          {/* TODO Round E: replace this export-only view with the extracted ExportArchive. */}
          <KnowledgeBrowser exportOnly />
        </fieldset>
      </section>
    </div>
  );
}
