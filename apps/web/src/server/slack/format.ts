import type { AskResult } from "@hivemind/core";
export function slackEscape(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
export function citationLink(citation: AskResult["citations"][number]) {
  const url =
    citation.permalink ??
    `${process.env.PUBLIC_URL ?? "https://gohive.dev"}/app/cells/${encodeURIComponent(citation.id)}`;
  return `<${url}|${slackEscape(citation.title).replace(/\|/g, "/")} >`.replace(
    " >",
    ">",
  );
}
export function slackAnswer(result: AskResult) {
  const links = new Map(result.citations.map((c) => [c.id, citationLink(c)]));
  const text = slackEscape(result.answer).replace(
    /\[((?:lrn|slk)_[a-z0-9]+)\]/g,
    (_, id: string) => links.get(id) ?? "",
  );
  return `${text}\n\nSources:\n${result.citations.map((c) => citationLink(c)).join("\n") || "No sources yet."}\n\nConfidence: ${result.confidence}.\nGap: ${slackEscape(result.gaps ?? "No gap reported. Check the sources for context.")}`;
}
