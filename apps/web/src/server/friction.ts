import {
  normalizeRepo,
  type HiveContext,
  type FrictionSummary,
  type AskResult,
} from "@hivemind/core";
import { getSql } from "./db/client";
export function isFrictionAsk(question: string): boolean {
  return /\b(friction|bottlenecks?|minutes lost)\b|\b(?:slowing|blocking) (?:us|the team|our team)\b/i.test(
    question,
  );
}
export async function frictionSummary(
  ctx: HiveContext,
  repoInput?: string,
): Promise<FrictionSummary> {
  const sql = getSql(),
    repo = normalizeRepo(repoInput);
  const since = new Date(Date.now() - 7 * 86400000);
  const rows =
    await sql`SELECT p.learning_id AS id, l.title, p.area, p.cost, p.blocked FROM learning_pushes p JOIN learnings l ON l.id = p.learning_id AND l.team_id = p.team_id WHERE p.team_id = ${ctx.teamId} AND l.kind = 'friction' AND p.created_at >= ${since} AND (${repo}::text IS NULL OR l.repo = ${repo}) ORDER BY p.created_at DESC`;
  const areas = new Map<string, FrictionSummary["areas"][number]>();
  const titles = new Map<string, FrictionSummary["recurring"][number]>();
  const cells = new Map<string, string>();
  let minutes = 0,
    unmeasured = 0,
    blocked = 0;
  for (const row of rows) {
    const cost = Number(row.cost ?? 0),
      area = row.area ?? "Unspecified";
    minutes += cost;
    unmeasured += row.cost == null ? 1 : 0;
    blocked += row.blocked ? 1 : 0;
    cells.set(row.id, row.title);
    const key = String(row.title).trim().toLowerCase().replace(/\s+/g, " ");
    const a: FrictionSummary["areas"][number] = areas.get(area) ?? {
      area,
      count: 0,
      minutes: 0,
      ids: [],
    };
    const t: FrictionSummary["recurring"][number] = titles.get(key) ?? {
      title: row.title,
      count: 0,
      minutes: 0,
      ids: [],
    };
    for (const entry of [a, t]) {
      entry.count++;
      entry.minutes += cost;
      if (!entry.ids.includes(row.id)) entry.ids.push(row.id);
    }
    areas.set(area, a);
    titles.set(key, t);
  }
  const sorted = <T extends { minutes: number; count: number }>(items: T[]) =>
    items.sort((a, b) => b.minutes - a.minutes || b.count - a.count);
  return {
    since: since.toISOString(),
    count: rows.length,
    minutes,
    unmeasured,
    blocked,
    areas: sorted([...areas.values()]),
    recurring: sorted([...titles.values()].filter((item) => item.count > 1)),
    cells: [...cells].map(([id, title]) => ({ id, title })),
  };
}
export function frictionAnswer(summary: FrictionSummary): AskResult {
  const cite = (ids: string[]) => ids.map((id) => `[${id}]`).join(" ");
  return {
    answer:
      `This week the hive records ${summary.count} friction reports and ${summary.minutes} measured minutes lost. ${summary.unmeasured} reports have no measured cost.\n\n` +
      summary.areas
        .map(
          (area) =>
            `- ${area.area}: ${area.minutes} minutes across ${area.count} reports. ${cite(area.ids)}`,
        )
        .join("\n") +
      (summary.recurring.length
        ? "\n\nRecurring friction:\n" +
          summary.recurring
            .map(
              (item) =>
                `- ${item.title}: ${item.count} reports. ${cite(item.ids)}`,
            )
            .join("\n")
        : ""),
    citations: summary.cells.map((cell) => ({
      ...cell,
      why: "Recorded friction this week",
    })),
    confidence: "high",
    gaps: summary.unmeasured
      ? "Unmeasured costs are excluded from minutes lost. These are reported observations, not all team activity."
      : "Only reported friction is included.",
    synthesized: false,
  };
}
