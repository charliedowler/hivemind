import type { AskResult, LearningView, SearchHit } from "@hivemind/core";

export const embeddingDimensions = 1536;

export async function embedText(text: string): Promise<number[] | null> {
  return null;
}

export async function synthesizeAnswer(question: string, hits: SearchHit[]): Promise<AskResult> {
  return extractiveAnswer(hits);
}

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

export async function suggestTags(learning: Pick<LearningView, "title" | "body" | "kind" | "repo">): Promise<string[]> {
  return [];
}
