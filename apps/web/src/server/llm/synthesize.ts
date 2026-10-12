import type { AskResult, SearchHit } from "@hivemind/core";

export function extractiveAnswer(hits: SearchHit[]): AskResult {
  return {
    answer: hits
      .slice(0, 3)
      .map((hit) => `- ${hit.title} [${hit.id}]`)
      .join("\n"),
    citations: hits.slice(0, 3).map((hit) => ({ id: hit.id, title: hit.title, why: "Top search result." })),
    confidence: "low",
    gaps: null,
    synthesized: false,
  };
}

export async function synthesizeAnswer(question: string, hits: SearchHit[]): Promise<AskResult> {
  return extractiveAnswer(hits);
}
