import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  type HiveContext,
  type LearningStanding,
  type OutcomeKind,
} from "@hivemind/core";
import { createTeam } from "./auth";
import { getSql } from "./db/client";
import { newId } from "./db/ids";
import { askHive, getLearning, recentLearnings, searchLearnings } from "./hive";
import { recordFeedback, reportOutcome } from "./feedback";
import { captureOwner, publishCell, shareProjects } from "./project-sharing";
import {
  bindVerifiedOwner,
  followOwnerMemberships,
} from "./identity/legacy-owner-fixture";
import { memberContext } from "./identity/enrollment";
import * as judgments from "./memory-judgments";

const models = vi.hoisted(() => ({ outcome: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./llm/embeddings", () => ({ embedText: async () => null }));
vi.mock("./capture-categories", () => ({
  classifyCaptureCategories: async (_: unknown, categories: string[]) =>
    Object.fromEntries(categories.map((category) => [category, false])),
}));
vi.mock("./outcome-judgments", () => ({ classifyOutcome: models.outcome }));
vi.mock("./classify", async (original) => ({
  ...(await original<typeof import("./classify")>()),
  classifyAsk: async () => ({ decision: "answer", classification: null }),
}));
vi.mock("./llm/synthesize", () => ({
  synthesizeAnswer: async () => {
    throw new Error("Use deterministic evidence");
  },
  extractiveAnswer: (hits: LearningStanding[]) => ({
    answer: hits.map((hit) => hit.body).join("\n"),
    citations: hits.map((hit) => ({
      id: hit.id,
      title: hit.title,
      why: "Evidence",
    })),
    confidence: "high",
    gaps: null,
    synthesized: false,
  }),
}));

describe.skipIf(!process.env.DATABASE_URL)("feedback decides retrieval", () => {
  const sql = getSql();
  const teams: string[] = [],
    members: string[] = [];
  let a: HiveContext, b: HiveContext, c: HiveContext;
  beforeAll(async () => {
    for (const name of ["Ranking owner", "Ranking second", "Ranking third"]) {
      const ctx = (await createTeam({ teamName: name, memberName: name })).ctx;
      teams.push(ctx.teamId);
      members.push(ctx.memberId);
    }
    a = (await memberContext(members[0], teams[0]))!;
    await sql`INSERT INTO hive_memberships (member_id, team_id) VALUES (${members[1]}, ${a.teamId}), (${members[2]}, ${a.teamId})`;
    b = (await memberContext(members[1], a.teamId))!;
    c = (await memberContext(members[2], a.teamId))!;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    models.outcome.mockReset();
    models.outcome.mockResolvedValue({
      classification: "useful",
      judgment: { model: "fixture" },
    });
  });
  afterAll(async () => {
    await sql`DELETE FROM ask_log WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM learning_pushes WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM learnings WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM api_keys WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM teams WHERE id = ANY(${teams}::text[]) OR personal_owner_member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM members WHERE id = ANY(${members}::text[])`;
    await sql.end();
  });
  async function cell(ctx = a, kind = "learning") {
    const id = newId("lrn");
    const word = `rankingcanary${id.slice(4)}`;
    await sql`INSERT INTO learnings (id, team_id, member_id, owner_member_id, title, body, kind, source, confidence, lifecycle, repo) VALUES (${id}, ${ctx.teamId}, ${ctx.memberId}, ${ctx.memberId}, ${word}, ${`${word} migration lock evidence`}, ${kind}, 'manual', 1, 'fresh', 'github.com/fixture/ranking')`;
    return { id, query: word };
  }
  async function outcome(
    ctx: HiveContext,
    id: string,
    classification: OutcomeKind,
    evidence = "Observed command output: exit 0",
  ) {
    models.outcome.mockResolvedValueOnce({
      classification,
      judgment: { model: "fixture" },
    });
    return reportOutcome(ctx, {
      id,
      outcome: `Observed ${classification} result`,
      evidence,
    });
  }
  async function retrieved(
    ctx: HiveContext,
    id: string,
    query: string,
    include_history = false,
  ) {
    const [search, ask, recent] = await Promise.all([
      searchLearnings(
        ctx,
        { query, limit: 25, include_history },
        { cellsOnly: true },
      ),
      askHive(ctx, { question: query, include_history }),
      recentLearnings(ctx, { since: "1h", limit: 50, include_history }),
    ]);
    return [
      search.some((hit) => hit.id === id),
      ask.citations.some((hit) => hit.id === id),
      recent.some((hit) => hit.id === id),
    ];
  }

  it("hides two net negative votes across search, ask and recent; history and direct ID remain available; withdrawal restores immediately", async () => {
    const fixture = await cell();
    await recordFeedback(a, { id: fixture.id, vote: "down" });
    expect(await retrieved(a, fixture.id, fixture.query)).toEqual([
      true,
      true,
      true,
    ]);
    const deciding = await recordFeedback(b, { id: fixture.id, vote: "down" });
    expect(await retrieved(a, fixture.id, fixture.query)).toEqual([
      false,
      false,
      false,
    ]);
    expect(await retrieved(a, fixture.id, fixture.query, true)).toEqual([
      true,
      true,
      true,
    ]);
    expect(await getLearning(a, fixture.id)).toMatchObject({
      unhelpfulLabel: "Marked unhelpful by 2",
      retrievalExcluded: true,
    });
    await recordFeedback(b, {
      id: fixture.id,
      withdraw: true,
      receipt: deciding.receipt,
    });
    expect(await retrieved(a, fixture.id, fixture.query)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("hides one evidenced contradiction, restores on withdrawal, and lets newer confirmed evidence resolve an older contradiction", async () => {
    const fixture = await cell();
    const contradiction = await outcome(a, fixture.id, "contradicted");
    expect(await retrieved(a, fixture.id, fixture.query)).toEqual([
      false,
      false,
      false,
    ]);
    expect(await retrieved(a, fixture.id, fixture.query, true)).toEqual([
      true,
      true,
      true,
    ]);
    await outcome(b, fixture.id, "useful");
    expect(await retrieved(a, fixture.id, fixture.query)).toEqual([
      true,
      true,
      true,
    ]);
    await sql`UPDATE feedback_receipts SET created_at = now() + interval '1 second' WHERE id = ${contradiction.receipt!}`;
    expect(await retrieved(a, fixture.id, fixture.query)).toEqual([
      false,
      false,
      false,
    ]);
    await recordFeedback(a, {
      id: fixture.id,
      withdraw: true,
      receipt: contradiction.receipt,
    });
    expect(await retrieved(a, fixture.id, fixture.query)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("uses the supported contradiction stamp when the result contains inline evidence", async () => {
    const fixture = await cell();
    models.outcome.mockResolvedValueOnce({
      classification: "contradicted",
      judgment: { model: "fixture" },
    });
    await reportOutcome(a, {
      id: fixture.id,
      outcome:
        "The command output contradicts this cell: observed exit 1 instead of exit 0.",
      evidence: {},
    });
    await sql`UPDATE feedback_receipts SET evidence = NULL WHERE learning_id = ${fixture.id}`;
    expect(await retrieved(a, fixture.id, fixture.query)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it.each(["outdated", "superseded", "retracted"])(
    "hides lifecycle %s and retains history",
    async (lifecycle) => {
      const fixture = await cell();
      await sql`UPDATE learnings SET lifecycle = ${lifecycle} WHERE id = ${fixture.id}`;
      expect(await retrieved(a, fixture.id, fixture.query)).toEqual([
        false,
        false,
        false,
      ]);
      expect(await retrieved(a, fixture.id, fixture.query, true)).toEqual([
        true,
        true,
        true,
      ]);
      expect(await getLearning(a, fixture.id)).not.toBeNull();
    },
  );

  it("keeps publication votes and outcome stamps separate from personal feedback, including the author's agents", async () => {
    const personal = (await captureOwner(a)).personal;
    const ownerSub = `ranking-owner-${newId("auth")}`;
    const email = `${ownerSub}@fixture.work.example.test`;
    await sql`UPDATE members SET email = ${email}, email_verified = true WHERE id = ${personal.memberId}`;
    await sql.begin((tx) =>
      bindVerifiedOwner(tx, { sub: ownerSub, email }, true),
    );
    const agentId = newId("mem");
    members.push(agentId);
    await sql`INSERT INTO members (id, name, actor_type, email, email_verified) VALUES (${agentId}, 'Owner agent', 'agent', ${`${agentId}@agentmail.to`}, true)`;
    await sql`INSERT INTO auth_accounts (id, user_id, account_id, provider_id, owner_sub, owner_email_verified) VALUES (${newId("auth")}, ${agentId}, ${agentId}, 'agentid', ${ownerSub}, true)`;
    await sql.begin((tx) => followOwnerMemberships(tx, personal.memberId));
    const agent = (await memberContext(agentId, personal.teamId))!;
    await shareProjects(personal, {
      include: ["github.com/fixture/ranking"],
      revision: 0,
    });
    const fixture = await cell(personal);
    expect(await publishCell(personal, fixture.id, a.teamId, 1)).toEqual({
      published: true,
    });
    await outcome(b, fixture.id, "contradicted");
    expect(await retrieved(b, fixture.id, fixture.query)).toEqual([
      false,
      false,
      false,
    ]);
    expect(await retrieved(personal, fixture.id, fixture.query)).toEqual([
      true,
      true,
      true,
    ]);
    await outcome(agent, fixture.id, "useful");
    await outcome(agent, fixture.id, "useful");
    expect(await getLearning(personal, fixture.id)).toMatchObject({
      votes: { up: 1, down: 0, outdated: 0 },
      feedbackStanding: { usefulOutcomes: 1, contradictedOutcomes: 0 },
    });
    expect(await getLearning(b, fixture.id)).toMatchObject({
      votes: { up: 0, down: 1, outdated: 0 },
      feedbackStanding: { usefulOutcomes: 0, contradictedOutcomes: 1 },
    });
    await recordFeedback(b, { id: fixture.id, withdraw: true });
    expect(await retrieved(b, fixture.id, fixture.query)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("maps all outcomes to the existing counters without stacking votes per actor", async () => {
    const fixture = await cell();
    for (const [classification, votes] of [
      ["useful", { up: 1, down: 0, outdated: 0 }],
      ["useful", { up: 1, down: 0, outdated: 0 }],
      ["contradicted", { up: 0, down: 1, outdated: 0 }],
      ["stale", { up: 0, down: 0, outdated: 1 }],
      ["inconclusive", { up: 0, down: 0, outdated: 1 }],
    ] as const) {
      expect((await outcome(a, fixture.id, classification)).votes).toEqual(
        votes,
      );
    }
    expect(
      await sql`SELECT member_id FROM feedback WHERE learning_id = ${fixture.id}`,
    ).toHaveLength(1);
    expect(await retrieved(a, fixture.id, fixture.query)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("passes standing to the ask reranker and retrieval never changes votes or receipts", async () => {
    const fixture = await cell();
    await outcome(a, fixture.id, "useful");
    await outcome(b, fixture.id, "useful");
    await outcome(c, fixture.id, "useful");
    const before =
      await sql`SELECT to_jsonb(f) AS row FROM feedback f WHERE learning_id = ${fixture.id} ORDER BY member_id`;
    const receipts =
      await sql`SELECT to_jsonb(r) AS row FROM feedback_receipts r WHERE learning_id = ${fixture.id} ORDER BY id`;
    const spy = vi.spyOn(judgments, "rerankMemory");
    try {
      await retrieved(a, fixture.id, fixture.query);
      expect(
        spy.mock.calls[0][1].find((hit) => hit.id === fixture.id),
      ).toMatchObject({
        votes: { up: 3, down: 0, outdated: 0 },
        lifecycle: "confirmed",
        feedbackStanding: { usefulOutcomes: 3, lastOutcome: "useful" },
      });
      expect(
        await sql`SELECT to_jsonb(f) AS row FROM feedback f WHERE learning_id = ${fixture.id} ORDER BY member_id`,
      ).toEqual(before);
      expect(
        await sql`SELECT to_jsonb(r) AS row FROM feedback_receipts r WHERE learning_id = ${fixture.id} ORDER BY id`,
      ).toEqual(receipts);
      expect(await getLearning(a, fixture.id)).toMatchObject({
        votes: { up: 3, down: 0, outdated: 0 },
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("decays each receipt separately and withdrawal does not freshen restored feedback", async () => {
    const fixture = await cell();
    const first = await outcome(a, fixture.id, "useful");
    await sql`UPDATE feedback_receipts SET created_at = now() - interval '90 days' WHERE id = ${first.receipt!}`;
    const replacement = await outcome(a, fixture.id, "contradicted");
    await recordFeedback(a, {
      id: fixture.id,
      withdraw: true,
      receipt: replacement.receipt,
    });
    expect(
      ((await getLearning(a, fixture.id)) as LearningStanding).feedbackStanding
        ?.weightedNetVotes,
    ).toBeCloseTo(0.5);
    await outcome(b, fixture.id, "useful");
    expect(
      ((await getLearning(a, fixture.id)) as LearningStanding).feedbackStanding
        ?.weightedNetVotes,
    ).toBeCloseTo(1.5);
  });

  it("does not cite a hidden cell through the friction aggregate shortcut", async () => {
    const fixture = await cell(a, "friction");
    await sql`INSERT INTO learning_pushes (id, learning_id, member_id, team_id, merged, area, cost, blocked, source) VALUES (${newId("psh")}, ${fixture.id}, ${a.memberId}, ${a.teamId}, false, 'tool', 7, false, 'manual')`;
    await recordFeedback(a, { id: fixture.id, vote: "down" });
    await recordFeedback(b, { id: fixture.id, vote: "down" });
    expect(
      (
        await askHive(a, { question: `friction ${fixture.query}` })
      ).citations.some((hit) => hit.id === fixture.id),
    ).toBe(false);
    expect(
      (
        await askHive(a, {
          question: `friction ${fixture.query}`,
          include_history: true,
        })
      ).citations.some((hit) => hit.id === fixture.id),
    ).toBe(true);
  });
});
