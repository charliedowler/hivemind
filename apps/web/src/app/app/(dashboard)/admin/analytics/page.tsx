import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, Sprite } from "@hivemind/design-system";
import { getWebContext } from "@/server/auth";
import { analyticsReports } from "@/server/analytics/reports";
import { AnalyticsRefresh } from "@/components/analytics-refresh";
import { AnalyticsReport } from "@/components/analytics-report";
import "./analytics.css";

export default async function Page() {
  const ctx = await getWebContext();
  if (!ctx) redirect("/app/login");
  let reports;
  try {
    reports = await analyticsReports(ctx);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 403
    )
      return (
        <Card>
          <h1>Analytics needs a team admin</h1>
          <p>Ask your team admin to open this page.</p>
          <Link href="/app">Back to the comb</Link>
        </Card>
      );
    return (
      <Card>
        <h1>Analytics is unavailable</h1>
        <p>Reload after the event database is available.</p>
        <Link href="/app/admin/analytics">Reload analytics</Link>
      </Card>
    );
  }
  return (
    <div className="analytics-page stack">
      <div className="analytics-heading">
        <div className="row">
          <Sprite name="hive-entrance" scale={3} />
          <div>
            <h1>Watch the hive</h1>
            <p>Activity, knowledge and quality for {ctx.teamName}.</p>
          </div>
        </div>
        <AnalyticsRefresh />
      </div>
      <div className="analytics-scope">
        <strong>Last 30 days · UTC</strong>
        <span>
          Only your team. Tables separate real, synthetic and unclassified
          traffic. Bars show totals.
        </span>
      </div>
      <div className="analytics-grid">
        <AnalyticsReport name="usage" rows={reports.usage} />
        <AnalyticsReport name="funnel" rows={reports.funnel} />
        <AnalyticsReport name="stalls" rows={reports.stalls} />
        <AnalyticsReport name="knowledge" rows={reports.knowledge} />
        <AnalyticsReport name="quality" rows={reports.quality} />
      </div>
      <p className="small">
        Waitlist totals stay private. Matched signups use the existing waitlist
        row ID. Missing completions can also mean an event write failed.
      </p>
    </div>
  );
}
