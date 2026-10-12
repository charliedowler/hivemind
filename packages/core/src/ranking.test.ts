import { describe, expect, it } from "vitest";
import { rankCandidates, type RankCandidate } from "./ranking";

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
    expect(hit.signals).toEqual({
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
  it("uses exponential age decay and tanh vote and push counts", () => {
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
    expect(hit.signals.votes).toBeCloseTo(0.5 + 0.5 * Math.tanh(1));
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
