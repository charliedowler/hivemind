import type { LearningView, SearchHit } from "./contracts";
import { normalizeRepo } from "./normalize";

export type FeedbackStanding = {
  weightedNetVotes: number;
  usefulOutcomes: number;
  contradictedOutcomes: number;
  staleOutcomes: number;
  lastOutcome: "useful" | "contradicted" | "stale" | "inconclusive" | null;
  lastOutcomeAt: string | null;
  lastConfirmedAt: string | null;
  lastContradictedAt: string | null;
};

export type LearningStanding = LearningView & {
  feedbackStanding?: FeedbackStanding;
  retrievalExcluded?: boolean;
  unhelpfulLabel?: string | null;
};

export function excludedFromRetrieval(learning: LearningStanding): boolean {
  const standing = learning.feedbackStanding;
  return Boolean(
    (learning.lifecycle &&
      ["outdated", "superseded", "retracted"].includes(learning.lifecycle)) ||
      (learning.votes.down >= 2 && learning.votes.down > learning.votes.up) ||
      (standing?.lastContradictedAt &&
        (!standing.lastConfirmedAt ||
          Date.parse(standing.lastContradictedAt) >
            Date.parse(standing.lastConfirmedAt))),
  );
}

export function decayedVote(
  vote: number,
  at: string | Date,
  now: Date,
): number {
  const ageDays = Math.max(
    0,
    (now.getTime() - new Date(at).getTime()) / 86400000,
  );
  return vote * Math.pow(0.5, ageDays / 90);
}

export type RankCandidate = LearningStanding & {
  vector: number | null;
  fts: number;
};

export function rankCandidates(
  candidates: RankCandidate[],
  repo?: string | null,
  now: Date = new Date(),
  options: { includeHistory?: boolean } = {},
): (SearchHit & LearningStanding)[] {
  candidates = candidates.filter(
    (candidate) => options.includeHistory || !excludedFromRetrieval(candidate),
  );
  const maxFts = Math.max(0, ...candidates.map((candidate) => candidate.fts));
  const normalizedRepo = normalizeRepo(repo);
  return candidates
    .map(({ vector: rawVector, fts: rawFts, ...learning }) => {
      const vector =
        rawVector === null ? null : Math.max(0, Math.min(1, rawVector));
      const fts = maxFts > 0 ? rawFts / maxFts : 0;
      const ageDays = Math.max(
        0,
        (now.getTime() - new Date(learning.lastPushedAt).getTime()) / 86400000,
      );
      const recency = Math.exp(-ageDays / 45);
      const netVotes =
        learning.feedbackStanding?.weightedNetVotes ??
        decayedVote(
          learning.votes.up - learning.votes.down,
          learning.updatedAt,
          now,
        );
      const votes = Math.max(-0.5, Math.min(1.5, 0.5 + netVotes / 6));
      const repoMatch =
        normalizedRepo !== null &&
        normalizeRepo(learning.repo) === normalizedRepo;
      let score =
        vector === null
          ? 0.7 * fts + 0.15 * recency + 0.15 * votes
          : 0.55 * vector + 0.25 * fts + 0.1 * recency + 0.1 * votes;
      score =
        (score + (repoMatch ? 0.08 : 0)) * (0.85 + 0.15 * learning.confidence);
      if (
        learning.votes.outdated > learning.votes.up &&
        learning.votes.outdated >= 1
      )
        score *= 0.4;
      const lifecycle =
        learning.lifecycle === "fresh"
          ? 0.95
          : learning.lifecycle &&
              ["superseded", "outdated", "retracted"].includes(
                learning.lifecycle,
              )
            ? 0.25
            : 1;
      const verification =
        learning.verifyAfter &&
        Date.parse(learning.verifyAfter) <= now.getTime()
          ? 0.7
          : 1;
      score *= lifecycle * verification;
      return {
        ...learning,
        score,
        signals: {
          vector,
          fts,
          recency,
          votes,
          repoMatch,
          lifecycle,
          verification,
        },
      };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
