import type { LearningView } from "@hivemind/core";

export async function suggestTags(
  learning: Pick<LearningView, "title" | "body" | "kind" | "repo">,
): Promise<string[]> {
  return [];
}
