import { describe, expect, it } from "vitest";
import {
  decayedVote,
  rankCandidates,
  type FeedbackStanding,
  type RankCandidate,
} from "./ranking";

const now = new Date("2026-10-12T12:00:00Z");
function candidate(overrides: Partial<RankCandidate> = {}): RankCandidate {
  return {
    id: "lrn_aaaaaaaaaaaa",
    title: "Title",
    body: "Body",
    kind: "learning",
    tags: [],
    repo: null,
    paths: [],
    confidence: 1,
    captureFlagged: false,
    captureRedacted: false,
    captureRuleIds: [],
    source: "manual",
    author: { id: "mem_a", name: "Author" },
    pushCount: 1,
    votes: { up: 0, down: 0, outdated: 0 },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lastPushedAt: now.toISOString(),
    vector: null,
    fts: 2,
    ...overrides,
  };
}

describe("rankCandidates", () => {
  it("uses the exact weights without vector data", () => {
    const hit = rankCandidates([candidate()], null, now)[0];
    expect(hit.score).toBeCloseTo(0.7 + 0.15 + 0.15 * 0.5);
    expect(hit.signals).toMatchObject({
      vector: null,
      fts: 1,
      recency: 1,
      votes: 0.5,
      repoMatch: false,
    });
  });
  it("uses vector weights, clamps similarity and normalizes FTS over all candidates", () => {
    const hits = rankCandidates(
      [
        candidate({ vector: 2 }),
        candidate({ id: "lrn_b", vector: -1, fts: 1 }),
      ],
      null,
      now,
    );
    expect(hits[0].score).toBeCloseTo(0.55 + 0.25 + 0.1 + 0.1 * 0.5);
    expect(hits[1].signals.vector).toBe(0);
    expect(hits[1].signals.fts).toBe(0.5);
  });
  it("applies repo boost before confidence and outdated penalty", () => {
    const input = candidate({
      repo: "owner/repo",
      confidence: 0.5,
      votes: { up: 0, down: 0, outdated: 1 },
    });
    const hit = rankCandidates(
      [input],
      "https://github.com/Owner/Repo.git",
      now,
    )[0];
    expect(hit.score).toBeCloseTo((0.925 + 0.08) * 0.925 * 0.4);
    expect(hit.signals.repoMatch).toBe(true);
    expect(
      rankCandidates(
        [candidate({ votes: { up: 1, down: 0, outdated: 1 } })],
        null,
        now,
      )[0].score,
    ).toBeGreaterThan(0.9);
  });
  it("uses exponential age decay and current feedback without counting repeat pushes", () => {
    const hit = rankCandidates(
      [
        candidate({
          fts: 0,
          lastPushedAt: new Date(now.getTime() - 45 * 86400000).toISOString(),
          pushCount: 3,
          votes: { up: 4, down: 2, outdated: 0 },
        }),
      ],
      null,
      now,
    )[0];
    expect(hit.signals.recency).toBeCloseTo(Math.exp(-1));
    expect(hit.signals.votes).toBeCloseTo(0.5 + 2 / 6);
    expect(hit.signals.fts).toBe(0);
  });
  it("sorts by score and handles an empty candidate set", () => {
    expect(rankCandidates([], null, now)).toEqual([]);
    expect(
      rankCandidates(
        [candidate({ id: "low", fts: 0 }), candidate({ id: "high" })],
        null,
        now,
      )[0].id,
    ).toBe("high");
  });
});

function standing(overrides: Partial<FeedbackStanding> = {}): FeedbackStanding {
  return {
    weightedNetVotes: 0,
    usefulOutcomes: 0,
    contradictedOutcomes: 0,
    staleOutcomes: 0,
    lastOutcome: null,
    lastOutcomeAt: null,
    lastConfirmedAt: null,
    lastContradictedAt: null,
    ...overrides,
  };
}

it("three net useful outcomes double the feedback term and lift otherwise equal evidence", () => {
  const hits = rankCandidates(
    [
      candidate({ id: "neutral", lifecycle: "confirmed" }),
      candidate({
        id: "useful",
        lifecycle: "confirmed",
        votes: { up: 3, down: 0, outdated: 0 },
        feedbackStanding: standing({ weightedNetVotes: 3, usefulOutcomes: 3 }),
      }),
    ],
    null,
    now,
  );
  expect(hits[0].id).toBe("useful");
  expect(hits[0].signals.votes).toBe(2 * hits[1].signals.votes);
  expect(hits[0].score - hits[1].score).toBeCloseTo(0.075);
});

it("caps positive and negative feedback symmetrically", () => {
  const positive = rankCandidates(
    [candidate({ feedbackStanding: standing({ weightedNetVotes: 10000 }) })],
    null,
    now,
  )[0];
  const negative = rankCandidates(
    [candidate({ feedbackStanding: standing({ weightedNetVotes: -10000 }) })],
    null,
    now,
    { includeHistory: true },
  )[0];
  expect(positive.signals.votes).toBe(1.5);
  expect(negative.signals.votes).toBe(-0.5);
  expect(positive.signals.votes - 0.5).toBe(0.5 - negative.signals.votes);
});

it("halves feedback weight every 90 days without aging the cell's content", () => {
  const old = new Date(now.getTime() - 90 * 86400000);
  expect(decayedVote(3, old, now)).toBeCloseTo(1.5);
  expect(decayedVote(-3, old, now)).toBeCloseTo(-1.5);
  expect(decayedVote(3, new Date(now.getTime() + 86400000), now)).toBe(3);
  const hits = rankCandidates(
    [
      candidate({
        id: "old",
        feedbackStanding: standing({
          weightedNetVotes: decayedVote(3, old, now),
        }),
      }),
      candidate({
        id: "new",
        feedbackStanding: standing({ weightedNetVotes: 3 }),
      }),
    ],
    null,
    now,
  );
  expect(hits[0].id).toBe("new");
  expect(hits[0].signals.votes - 0.5).toBeCloseTo(
    2 * (hits[1].signals.votes - 0.5),
  );
});

it.each([
  { up: 0, down: 1, included: true },
  { up: 0, down: 2, included: false },
  { up: 1, down: 2, included: false },
  { up: 2, down: 2, included: true },
  { up: 3, down: 2, included: true },
])(
  "enforces the net negative threshold for $up up and $down down",
  ({ up, down, included }) => {
    const cell = candidate({ votes: { up, down, outdated: 0 } });
    expect(rankCandidates([cell], null, now)).toHaveLength(included ? 1 : 0);
    expect(
      rankCandidates([cell], null, now, { includeHistory: true }),
    ).toHaveLength(1);
  },
);

it.each(["outdated", "superseded", "retracted"] as const)(
  "excludes %s even with positive feedback",
  (lifecycle) => {
    const cell = candidate({
      lifecycle,
      votes: { up: 10, down: 0, outdated: 0 },
    });
    expect(rankCandidates([cell], null, now)).toEqual([]);
    expect(
      rankCandidates([cell], null, now, { includeHistory: true }),
    ).toHaveLength(1);
  },
);

it("excludes an evidenced contradiction until a newer useful outcome or withdrawal", () => {
  const cell = candidate({
    feedbackStanding: standing({ lastContradictedAt: now.toISOString() }),
  });
  expect(rankCandidates([cell], null, now)).toEqual([]);
  cell.feedbackStanding!.lastConfirmedAt = new Date(
    now.getTime() - 1000,
  ).toISOString();
  expect(rankCandidates([cell], null, now)).toEqual([]);
  cell.feedbackStanding!.lastConfirmedAt = new Date(
    now.getTime() + 1000,
  ).toISOString();
  expect(rankCandidates([cell], null, now)).toHaveLength(1);
  cell.feedbackStanding!.lastConfirmedAt = null;
  cell.feedbackStanding!.lastContradictedAt = null;
  expect(rankCandidates([cell], null, now)).toHaveLength(1);
});

it("restores inclusion when withdrawal removes the deciding negative contribution", () => {
  const cell = candidate({ votes: { up: 0, down: 2, outdated: 0 } });
  expect(rankCandidates([cell], null, now)).toEqual([]);
  cell.votes.down = 1;
  expect(rankCandidates([cell], null, now)).toHaveLength(1);
});

it.each([null, 0.1])(
  "keeps off-topic popularity below relevant evidence with vector %s",
  (vector) => {
    const hits = rankCandidates(
      [
        candidate({ id: "topic", vector: vector === null ? null : 0.9 }),
        candidate({
          id: "popular",
          fts: 0.05,
          vector,
          feedbackStanding: standing({ weightedNetVotes: 10000 }),
        }),
      ],
      null,
      now,
    );
    expect(hits[0].id).toBe("topic");
  },
);
