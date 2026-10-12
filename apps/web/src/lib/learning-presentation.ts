import type { LearningView } from "@hivemind/core";
import type { LearningStatus, AgentKind } from "@hivemind/design-system";

export function learningStatus(
  learning: Pick<
    LearningView,
    "votes" | "pushCount" | "adminOutdated" | "lifecycle"
  >,
): LearningStatus {
  if (learning.lifecycle === "superseded" || learning.lifecycle === "retracted")
    return "outdated";
  if (learning.lifecycle) return learning.lifecycle;
  if (learning.adminOutdated) return "outdated";
  if (learning.votes.outdated > learning.votes.up) return "outdated";
  if (learning.votes.up > 0 || learning.pushCount > 1) return "confirmed";
  return "fresh";
}

export function agentKind(source: string): AgentKind | undefined {
  if (source === "claude-code") return "claude";
  if (source === "codex") return "codex";
  return undefined;
}

export function learnedBy(
  learning: Pick<LearningView, "author" | "source">,
): string {
  if (learning.source === "slack") return `${learning.author.name} via Slack`;
  const agent = agentKind(learning.source);
  return `${learning.author.name}'s ${agent === "claude" ? "Claude" : agent === "codex" ? "Codex" : "learning"}`;
}
