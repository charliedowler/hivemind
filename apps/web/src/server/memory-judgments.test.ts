import { afterEach, expect, it, vi } from "vitest";
import { rankCandidates, type RankCandidate } from "@hivemind/core";
import { rerankMemory } from "./memory-judgments";

const model = vi.hoisted(() => ({ systemOne: vi.fn() }));
vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: class {
    systemOne = model.systemOne;
  },
  choice: vi.fn(),
  score: vi.fn(),
  noul: (question: string) => question,
}));
vi.mock("./analytics/events", () => ({
  beginCall: async () => async () => {},
  reportedModel: () => "fixture",
}));

const candidate: RankCandidate = {
  id: "lrn_aaaaaaaaaaaa",
  title: "Migration",
  body: "Release the lock",
  kind: "learning",
  tags: [],
  repo: null,
  paths: [],
  confidence: 1,
  source: "manual",
  author: { id: "actor", name: "Actor" },
  pushCount: 1,
  votes: { up: 3, down: 0, outdated: 0 },
  lifecycle: "confirmed",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastPushedAt: new Date().toISOString(),
  vector: null,
  fts: 1,
  feedbackStanding: {
    weightedNetVotes: 3,
    usefulOutcomes: 3,
    contradictedOutcomes: 0,
    staleOutcomes: 0,
    lastOutcome: "useful",
    lastOutcomeAt: new Date().toISOString(),
    lastConfirmedAt: new Date().toISOString(),
    lastContradictedAt: null,
  },
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("gives the reranker the audience's counts, outcomes, timestamps and lifecycle", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "test-only");
  model.systemOne.mockResolvedValue({
    answers: { cell0: { type: "noul", noul: 0.9 } },
  });
  const hits = rankCandidates([candidate]);
  expect(await rerankMemory("migration", hits)).toHaveLength(1);
  expect(model.systemOne.mock.calls[0][0].state.cells[0]).toMatchObject({
    votes: candidate.votes,
    feedbackStanding: candidate.feedbackStanding,
    lifecycle: "confirmed",
  });
});
it("never resurrects excluded cells even when the provider is absent or fails", async () => {
  const hits = rankCandidates(
    [{ ...candidate, lifecycle: "retracted" }],
    null,
    new Date(),
    { includeHistory: true },
  );
  vi.stubEnv("TYPESAFE_API_KEY", "");
  expect(await rerankMemory("migration", hits)).toEqual([]);
  vi.stubEnv("TYPESAFE_API_KEY", "test-only");
  model.systemOne.mockRejectedValue(new Error("provider unavailable"));
  expect(await rerankMemory("migration", hits)).toEqual([]);
  expect(
    await rerankMemory("migration", hits, { includeHistory: true }),
  ).toEqual(hits);
});
