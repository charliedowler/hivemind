import { formatHumanDate } from "@hivemind/core";
import type { AskCitation, AskResult, PushResult } from "@hivemind/core";
export function slackEscape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
export function shortCitationTitle(title: string) {
  const text = title.replace(/\s+/g, " ").trim();
  if (text.length <= 80) return text;
  const prefix = text.slice(0, 79);
  const boundary = prefix.lastIndexOf(" ");
  return boundary > 0 ? `${prefix.slice(0, boundary)}…` : "Hive cell";
}
export function citationLink(citation: AskCitation) {
  const url = `${process.env.PUBLIC_URL ?? "https://gohive.dev"}/app/cells/${encodeURIComponent(citation.id)}`;
  return `<${url}|${slackEscape(shortCitationTitle(citation.title)).replace(/\|/g, "/")}>`;
}
function citationAliases(citations: AskCitation[]) {
  const cells = new Map<string, AskCitation>();
  const groups = new Map<string, AskCitation>();
  for (const citation of citations) {
    if (cells.has(citation.id)) continue;
    cells.set(citation.id, citation);
    const key = citation.permalink
      ? `slack:${citation.permalink}`
      : `cell:${citation.id}`;
    const prior = groups.get(key);
    if (
      !prior ||
      (citation.id.startsWith("lrn_") && !prior.id.startsWith("lrn_"))
    )
      groups.set(key, citation);
  }
  return new Map(
    [...cells.values()].map((citation) => [
      citation.id,
      groups.get(
        citation.permalink
          ? `slack:${citation.permalink}`
          : `cell:${citation.id}`,
      )!,
    ]),
  );
}
export function slackAnswer(result: AskResult, timeZone?: string) {
  const aliases = citationAliases(result.citations);
  const numbered = new Map<string, { number: number; citation: AskCitation }>();
  const paragraphs = result.answer
    .split(/\n\s*\n/)
    .filter(
      (paragraph) => !/^As of \d{4}-\d{2}-\d{2}\.$/.test(paragraph.trim()),
    )
    .map((paragraph) => {
      const references = new Set<number>();
      const plain = paragraph
        .replace(
          / ?\[((?:lrn|slk)_[a-zA-Z0-9_-]+)\]/g,
          (_marker, id: string) => {
            const citation = aliases.get(id);
            if (!citation) return "";
            if (!numbered.has(citation.id))
              numbered.set(citation.id, {
                number: numbered.size + 1,
                citation,
              });
            references.add(numbered.get(citation.id)!.number);
            return "";
          },
        )
        .replace(/ +([.,!?])/g, "$1")
        .trim();
      if (!plain) return "";
      const marker = references.size ? ` [${[...references].join(", ")}]` : "";
      const text = slackEscape(plain);
      return /[.!?]$/.test(text)
        ? text.slice(0, -1) + marker + text.slice(-1)
        : text + marker;
    })
    .filter(Boolean);
  if (!numbered.size) {
    for (const citation of aliases.values())
      if (!numbered.has(citation.id))
        numbered.set(citation.id, { number: numbered.size + 1, citation });
  }
  if (numbered.size)
    paragraphs.push(
      `Sources\n${[...numbered.values()]
        .map(({ number, citation }) => {
          const date = citation.date?.slice(0, 10);
          return `${number}. ${citationLink(citation)}${date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? ` (${formatHumanDate(date, { timeZone })})` : ""}`;
        })
        .join("\n")}`,
    );
  if (result.confidence === "medium")
    paragraphs.push("I'm moderately confident.");
  if (result.confidence === "low") paragraphs.push("My confidence is low.");
  if (result.gaps?.trim())
    paragraphs.push(`Gap: ${slackEscape(result.gaps.trim())}`);
  return paragraphs.join("\n\n");
}

export function slackCaptureReply(result: PushResult | null) {
  if (!result) return "That message is already saved.";
  if (result.dropped) return "This capture was excluded by a capture rule.";
  const url = `${process.env.PUBLIC_URL ?? "https://gohive.dev"}/app/cells/${result.id}`;
  if (result.learning.captureFlagged)
    return `Kept privately for your review: <${url}|Review cell>. Confirm it before sharing.`;
  return `Saved <${url}|${slackEscape(result.learning.title).replace(/\|/g, "/")}>.`;
}

export function slackDecisionSignals(
  value: unknown,
): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const outer = value as Record<string, unknown>;
  const signals =
    outer.signals &&
    typeof outer.signals === "object" &&
    !Array.isArray(outer.signals)
      ? outer.signals
      : outer;
  const numbers = Object.fromEntries(
    Object.entries(signals).filter(
      ([, score]) =>
        typeof score === "number" &&
        Number.isFinite(score) &&
        score >= 0 &&
        score <= 1,
    ),
  ) as Record<string, number>;
  return Object.keys(numbers).length ? numbers : null;
}
