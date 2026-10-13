import { formatHumanDate } from "./human-time";
export type DigestAuthor = { name: string; slackId?: string | null };
export type DigestItem = {
  id: string;
  sourceKey?: string;
  title: string;
  author: DigestAuthor;
  state?: string;
  replacementId?: string | null;
};
export type DigestFriction = DigestItem & {
  area: string;
  minutes: number | null;
  blocked: boolean;
  workaround?: string | null;
};
export type DigestData = {
  since: string;
  until: string;
  learnings: DigestItem[];
  insights: DigestItem[];
  friction: DigestFriction[];
  decisions: DigestItem[];
};
export type DigestIncludes = {
  learnings: boolean;
  insights: boolean;
  friction: boolean;
  decisions: boolean;
};
export type DigestBlock = {
  type: "header" | "section";
  text: {
    type: "plain_text" | "mrkdwn";
    text: string;
    emoji?: boolean;
    verbatim?: boolean;
  };
};
export type ComposedDigest = {
  blocks: DigestBlock[];
  text: string;
  empty: boolean;
  counts: {
    learnings: number;
    insights: number;
    friction: number;
    decisions: number;
    minutes: number;
    unmeasured: number;
    blocked: number;
  };
};
const clip = (s: string, max: number) =>
  Array.from(s).length > max
    ? Array.from(s)
        .slice(0, max - 1)
        .join("")
        .trimEnd() + "…"
    : s;
export const escapeDigestText = (s: string) =>
  s
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[|*_`~]/g, "");
function author(a: DigestAuthor) {
  return a.slackId && /^[UW][A-Z0-9]+$/.test(a.slackId)
    ? `<@${a.slackId}>`
    : escapeDigestText(clip(a.name, 60));
}
function link(id: string, title: string, base: string) {
  return `<${base}/app/cells/${encodeURIComponent(id)}|${escapeDigestText(clip(title, 180))}>`;
}
export function composeDigest(
  data: DigestData,
  include: DigestIncludes,
  timezone: string,
  base = "https://gohive.dev",
): ComposedDigest {
  const date = (s: string) => formatHumanDate(s, { timeZone: timezone });
  const counts = {
    learnings: include.learnings ? data.learnings.length : 0,
    insights: include.insights ? data.insights.length : 0,
    friction: include.friction ? data.friction.length : 0,
    decisions: include.decisions ? data.decisions.length : 0,
    minutes: 0,
    unmeasured: 0,
    blocked: 0,
  };
  const blocks: DigestBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        emoji: false,
        text: `Hive update, ${date(data.since)} to ${date(data.until)}`,
      },
    },
  ];
  const section = (text: string) =>
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", verbatim: true, text },
    });
  const items = (label: string, entries: DigestItem[]) => {
    if (!entries.length) return;
    section(
      `*${label}*\n` +
        entries
          .slice(0, 5)
          .map(
            (item) =>
              `${link(item.id, item.title, base)} · ${author(item.author)}${item.state === "superseded" ? ` (replaced${item.replacementId ? ` by ${link(item.replacementId, "a newer cell", base)}` : ""})` : item.state === "confirmed" ? " (confirmed)" : ""}`,
          )
          .join("\n") +
        (entries.length > 5 ? `\nand ${entries.length - 5} more` : ""),
    );
  };
  if (include.learnings) items("Learnings", data.learnings);
  if (include.insights) items("Insights", data.insights);
  if (include.friction && data.friction.length) {
    const areas = new Map<string, DigestFriction[]>();
    for (const report of data.friction) {
      const list = areas.get(report.area) ?? [];
      list.push(report);
      areas.set(report.area, list);
      counts.minutes += report.minutes ?? 0;
      counts.unmeasured += report.minutes === null ? 1 : 0;
      counts.blocked += report.blocked ? 1 : 0;
    }
    const groups = [...areas].sort(
      (a, b) =>
        b[1].reduce((n, r) => n + (r.minutes ?? 0), 0) -
        a[1].reduce((n, r) => n + (r.minutes ?? 0), 0),
    );
    section(
      "*Friction and pain points*\n" +
        groups
          .slice(0, 5)
          .map(([area, reports]) => {
            const minutes = reports.reduce((n, r) => n + (r.minutes ?? 0), 0),
              blocked = reports.filter((r) => r.blocked).length,
              unknown = reports.filter((r) => r.minutes === null).length;
            const citations = [
              ...new Map(reports.map((r) => [r.id, r])).values(),
            ].slice(0, 3);
            return (
              `${escapeDigestText(clip(area, 40))}: ${reports.length} reports, ${minutes} measured minutes lost, ${blocked} blocked${unknown ? `, ${unknown} unmeasured` : ""}\n` +
              citations
                .map(
                  (r) =>
                    `${link(r.id, r.title, base)} · ${author(r.author)}${r.workaround ? `\nWorkaround: ${escapeDigestText(clip(r.workaround, 160))}` : ""}`,
                )
                .join("\n")
            );
          })
          .join("\n\n") +
        (groups.length > 5 ? `\nand ${groups.length - 5} more areas` : ""),
    );
  }
  if (include.decisions) items("Conflict decisions", data.decisions);
  const empty =
    counts.learnings + counts.insights + counts.friction + counts.decisions ===
    0;
  if (empty) section("No changes since the last update.");
  else
    section(
      `${counts.learnings} learnings, ${counts.insights} insights, ${counts.friction} friction reports, ${counts.decisions} conflict decisions. ${counts.minutes} measured minutes lost, ${counts.blocked} blocked reports${counts.unmeasured ? `, ${counts.unmeasured} without a measured cost` : ""}.\n<${base}/app|Open your hive>`,
    );
  const bounded: DigestBlock[] = [];
  for (const block of blocks) {
    if (block.text.text.length <= 3000) {
      bounded.push(block);
      continue;
    }
    const lines = block.text.text.split("\n");
    let text = "";
    for (const line of lines) {
      if ((text + line).length > 2900) {
        text += `\nMore reports are in <${base}/app|your hive>.`;
        break;
      }
      text += (text ? "\n" : "") + line;
    }
    bounded.push({ ...block, text: { ...block.text, text } });
  }
  return {
    blocks: bounded,
    text: bounded.map((b) => b.text.text).join("\n\n"),
    empty,
    counts,
  };
}
