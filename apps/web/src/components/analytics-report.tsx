import { Card } from "@hivemind/design-system";
import type { ReportName, ReportRow } from "@/server/analytics/reports";

const definitions = {
  usage: {
    title: "Who uses the hive",
    description:
      "Members and teams by day and entrypoint. Search inside an ask counts once.",
    metric: "interactions",
    columns: [
      "day",
      "environment",
      "traffic",
      "entrypoint",
      "interactions",
      "active_members",
      "active_teams",
    ],
  },
  funnel: {
    title: "From signup to first answer",
    description:
      "Matched waitlist signups and member steps in order. Total waitlist counts stay private.",
    metric: "first_ask",
    columns: [
      "environment",
      "traffic",
      "waitlisted_signups",
      "signups",
      "key_or_oauth",
      "first_push",
      "first_ask",
    ],
  },
  knowledge: {
    title: "What the team brings back",
    description:
      "Pushes, merges and replacements. Minutes include measured friction only.",
    metric: "pushes",
    columns: [
      "day",
      "environment",
      "traffic",
      "kind",
      "source",
      "pushes",
      "merges",
      "supersessions",
      "friction_minutes",
      "unmeasured_friction",
    ],
  },
  quality: {
    title: "How well it answers",
    description:
      "Evidence gaps, refusals and latency. A fallback stays visible.",
    metric: "events",
    columns: [
      "day",
      "environment",
      "traffic",
      "entrypoint",
      "event_name",
      "events",
      "ask_gap_percent",
      "sensitive_refusals",
      "failures_or_fallbacks",
      "p50_ms",
      "p95_ms",
    ],
  },
  stalls: {
    title: "Where work stalls",
    description:
      "Failed calls and starts with no completion after two minutes.",
    metric: "events",
    columns: ["environment", "traffic", "purpose", "stall", "events"],
  },
} as const;
const labels: Record<string, string> = {
  active_members: "Members",
  active_teams: "Teams",
  waitlisted_signups: "Waitlisted",
  key_or_oauth: "Access",
  first_push: "First push",
  first_ask: "First ask",
  friction_minutes: "Minutes lost",
  unmeasured_friction: "Unknown cost",
  event_name: "Event",
  ask_gap_percent: "Gap %",
  sensitive_refusals: "Refusals",
  failures_or_fallbacks: "Failures",
  p50_ms: "P50 ms",
  p95_ms: "P95 ms",
  reason_code: "Reason",
};
function PixelBars({
  rows,
  metric,
  name,
}: {
  rows: ReportRow[];
  metric: string;
  name: string;
}) {
  const daily = new Map<string, number>();
  for (const row of rows) {
    const label = String(row.day ?? `${row.environment}/${row.traffic}`);
    daily.set(label, (daily.get(label) ?? 0) + Number(row[metric] ?? 0));
  }
  const values = [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30);
  const max = Math.max(1, ...values.map(([, value]) => value));
  return (
    <div
      className="analytics-bars"
      role="img"
      aria-label={`${name}: ${values.map(([day, value]) => `${day}, ${value}`).join("; ") || "No events"}`}
    >
      {values.map(([day, value]) => (
        <span
          key={day}
          title={`${day}: ${value}`}
          className="analytics-bar"
          style={{
            height: `${Math.max(4, Math.round(((value / max) * 48) / 4) * 4)}px`,
          }}
        />
      ))}
    </div>
  );
}
export function AnalyticsReport({
  name,
  rows,
}: {
  name: ReportName;
  rows: ReportRow[];
}) {
  const definition = definitions[name];
  return (
    <Card className={`analytics-report analytics-${name}`}>
      <div className="analytics-report-heading">
        <div>
          <h2>{definition.title}</h2>
          <p className="small">{definition.description}</p>
        </div>
        <PixelBars
          rows={rows}
          metric={definition.metric}
          name={definition.title}
        />
      </div>
      {rows.length ? (
        <div
          className="analytics-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={`${definition.title} table`}
        >
          <table>
            <caption className="sr-only">
              {definition.title}, last 30 days
            </caption>
            <thead>
              <tr>
                {definition.columns.map((column) => (
                  <th scope="col" key={column}>
                    {labels[column] ??
                      column.charAt(0).toUpperCase() + column.slice(1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={JSON.stringify(row)}>
                  {definition.columns.map((column) => (
                    <td key={column}>
                      {row[column] === null || row[column] === undefined
                        ? "Unknown"
                        : column === "stall"
                          ? row[column] === "missing_completion"
                            ? "No completion"
                            : "Failed"
                          : String(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="analytics-empty">
          {name === "stalls"
            ? "No stalls recorded in this window."
            : "No events yet. Activity appears after the next recorded request."}
        </p>
      )}
    </Card>
  );
}
