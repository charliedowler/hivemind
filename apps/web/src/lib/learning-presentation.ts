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
  if (learning.author.actorType === "agent")
    return learning.author.ownerName
      ? `${learning.author.ownerName} · ${learning.author.name}`
      : learning.author.name;
  const agent = agentKind(learning.source);
  return agent
    ? `${learning.author.name} · ${agent === "claude" ? "Claude" : "Codex"}`
    : learning.author.name;
}

export function kindLabel(kind: LearningView["kind"]) {
  return kind === "decision" || kind === "friction" ? kind : "learning";
}

export function cellStateLabel(
  learning: Pick<
    LearningView,
    "votes" | "pushCount" | "adminOutdated" | "lifecycle"
  >,
) {
  if (learning.lifecycle === "superseded") return "Replaced";
  if (learning.lifecycle === "retracted") return "Removed";
  const status = learningStatus(learning);
  if (status === "outdated") return "Outdated";
  if (status === "confirmed")
    return `Seen ${learning.pushCount} ${learning.pushCount === 1 ? "time" : "times"}`;
  return undefined;
}
