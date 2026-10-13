import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hivePushInput, type HiveContext } from "@hivemind/core";
import {
  createTeam,
  joinTeam,
  authenticateApiKey,
  issueApiKey,
  startWebSession,
  getWebContext,
  endWebSession,
} from "./auth";
import { getSql, hasEmbeddingColumn } from "./db/client";
import {
  pushLearning as pushLearningRaw,
  searchLearnings,
  recentLearnings,
  getLearning,
  recordFeedback,
  askHive,
  listMembers,
  teamOverview,
  submitEarlyAccess,
} from "./hive";
import * as classifier from "./classify";
import {
  currentOrigin,
  bindApiKey,
  originFor,
  withOrigin,
  type EventRow,
} from "./analytics/events";
import { frictionSummary } from "./friction";
import { HiveNotFoundError } from "./errors";

vi.mock("./llm/embeddings", () => ({ embedText: vi.fn(async () => null) }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { value: jar.get(name) } : undefined,
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));

async function pushLearning(...args: Parameters<typeof pushLearningRaw>) {
  const result = await withOrigin({...originFor(args[0], "slack"), ...(currentOrigin() ?? {}), entrypoint: "slack"}, () => pushLearningRaw(...args));
  if (result.dropped) throw new Error("Unexpected capture drop in accepted push fixture.");
  return result;
}

const enabled = Boolean(process.env.DATABASE_URL);
describe.skipIf(!enabled)("hive database integration", () => {
  let a: HiveContext;
  let b: HiveContext;
  let key: string;
  let inviteCode: string;
  const teamIds: string[] = [];
  const earlyIds: string[] = [];
  beforeAll(async () => {
    const first = await createTeam({
      teamName: "Integration A",
      memberName: "Alice",
    });
    const second = await createTeam({
      teamName: "Integration B",
      memberName: "Bob",
    });
    a = first.ctx;
    b = second.ctx;
    key = first.apiKey;
    inviteCode = first.inviteCode;
    teamIds.push(a.teamId, b.teamId);
  });
  afterAll(async () => {
    const sql = getSql();
    for (const table of [
      "feedback",
      "learning_pushes",
      "ask_log",
      "learnings",
      "api_keys",
      "web_sessions",
      "members",
      "teams",
    ]) {
      if (table === "teams")
        await sql`DELETE FROM teams WHERE id IN ${sql(teamIds)}`;
      else if (table === "members")
        await sql`DELETE FROM members WHERE id IN (SELECT member_id FROM hive_memberships WHERE team_id IN ${sql(teamIds)})`;
      else
        await sql`DELETE FROM ${sql(table)} WHERE team_id IN ${sql(teamIds)}`;
    }
    for (const id of earlyIds)
      await sql`DELETE FROM early_access WHERE id = ${id}`;
    await sql.end();
  });

  it("keeps learning data isolated across two teams", async () => {
    const pushed = await pushLearning(
      a,
      hivePushInput.parse({
        title: "Isolation aardvark",
        body: "Aardvark isolation fixture.",
      }),
    );
    expect(
      (await searchLearnings(a, { query: "aardvark", limit: 8 })).map(
        (hit) => hit.id,
      ),
    ).toContain(pushed.id);
    expect(await searchLearnings(b, { query: "aardvark", limit: 8 })).toEqual(
      [],
    );
    expect(await recentLearnings(b, { since: "1d", limit: 20 })).toEqual([]);
    expect(await getLearning(b, pushed.id)).toBeNull();
    await expect(
      recordFeedback(b, { id: pushed.id, vote: "up" }),
    ).rejects.toBeInstanceOf(HiveNotFoundError);
  });

  it("dedupes matching content, merges metadata and records every push with embeddings off", async () => {
    const first = await pushLearning(
      a,
      hivePushInput.parse({
        title: "  Duplicate   TITLE  ",
        body: "Short body.",
        repo: "https://github.com/Owner/Repo.git",
        tags: ["SQL query"],
        paths: ["a.ts"],
        confidence: 0.4,
      }),
    );
    const second = await pushLearning(
      a,
      hivePushInput.parse({
        title: "duplicate title",
        body: "Short body.",
        repo: "owner/repo",
        tags: ["sql-query", "auth"],
        paths: ["b.ts"],
        confidence: 0.9,
      }),
    );
    expect(second).toMatchObject({ id: first.id, merged: true, pushCount: 2 });
    expect(second.learning.tags.sort()).toEqual(["auth", "sql-query"]);
    expect(second.learning.paths.sort()).toEqual(["a.ts", "b.ts"]);
    expect(second.learning.confidence).toBeCloseTo(0.9);
    expect(second.learning.title).toBe("Duplicate   TITLE");
    expect(second.learning.body).toBe("Short body.");
    const rows =
      await getSql()`SELECT merged FROM learning_pushes WHERE learning_id = ${first.id} AND team_id = ${a.teamId} ORDER BY created_at`;
    expect(rows.map((row) => row.merged)).toEqual([false, true]);
    expect(
      (
        await pushLearning(
          a,
          hivePushInput.parse({
            title: "duplicate title",
            body: "Other repo",
            repo: "owner/other",
          }),
        )
      ).merged,
    ).toBe(false);
  });

  it("merges concurrent duplicates without losing pushes", async () => {
    const input = hivePushInput.parse({
      title: "Concurrent wombat",
      body: "Concurrent dedupe fixture.",
    });
    const pushes = await Promise.all([
      pushLearning(a, input),
      pushLearning(a, input),
      pushLearning(a, input),
    ]);
    expect(new Set(pushes.map((push) => push.id)).size).toBe(1);
    expect((await getLearning(a, pushes[0].id))?.pushCount).toBe(3);
  });

  it("recomputes counters when a member changes a vote", async () => {
    const pushed = await pushLearning(
      a,
      hivePushInput.parse({ title: "Votes", body: "Vote fixture." }),
    );
    expect(
      (await recordFeedback(a, { id: pushed.id, vote: "up" })).votes,
    ).toEqual({ up: 1, down: 0, outdated: 0 });
    expect(
      (await recordFeedback(a, { id: pushed.id, vote: "down" })).votes,
    ).toEqual({ up: 0, down: 1, outdated: 0 });
    expect(
      (await recordFeedback(a, { id: pushed.id, vote: "outdated" })).votes,
    ).toEqual({ up: 0, down: 0, outdated: 1 });
  });

  it("supports full-text and prefix search, hard tag filters and repo boosts", async () => {
    const pushed = await pushLearning(
      a,
      hivePushInput.parse({
        title: "Capybara migration",
        body: "Use transactional migrations.",
        repo: "owner/capybara",
        tags: ["database"],
      }),
    );
    const hits = await searchLearnings(a, {
      query: "capybara",
      repo: "different/repo",
      limit: 8,
    });
    expect(hits[0].id).toBe(pushed.id);
    expect(hits[0].signals.vector).toBeNull();
    expect((await searchLearnings(a, { query: "capyb", limit: 8 }))[0].id).toBe(
      pushed.id,
    );
    expect(
      await searchLearnings(a, {
        query: "capybara",
        tags: ["other"],
        limit: 8,
      }),
    ).toEqual([]);
    expect(
      (
        await searchLearnings(a, {
          query: "capybara",
          tags: ["DATABASE"],
          limit: 8,
        })
      )[0].id,
    ).toBe(pushed.id);
    const boosted = await searchLearnings(a, {
      query: "capybara",
      repo: "owner/capybara",
      limit: 8,
    });
    expect(boosted[0].score).toBeGreaterThan(hits[0].score);
  });

  it("redacts title and body before storage", async () => {
    const pushed = await pushLearning(
      a,
      hivePushInput.parse({
        title: `Credential ghp_${"a".repeat(36)}`,
        body: `Connect postgres://user:password@host/db with hm_${"b".repeat(43)}`,
      }),
    );
    expect(pushed.redactions).toBe(3);
    expect(pushed.learning.title).toBe("Credential [redacted]");
    expect(pushed.learning.body).not.toContain("password");
    expect(pushed.learning.body).not.toContain("b".repeat(43));
  });

  it("authenticates, throttles activity writes and rejects revoked keys", async () => {
    expect(await authenticateApiKey(key)).toEqual(a);
    const first =
      await getSql()`SELECT last_used_at FROM api_keys WHERE member_id = ${a.memberId} AND team_id = ${a.teamId}`;
    expect(await authenticateApiKey(key)).toEqual(a);
    const second =
      await getSql()`SELECT last_used_at FROM api_keys WHERE member_id = ${a.memberId} AND team_id = ${a.teamId}`;
    expect(second[0].last_used_at).toEqual(first[0].last_used_at);
    const issued = await issueApiKey(a, "Test");
    expect(await authenticateApiKey(issued.apiKey)).toEqual(a);
    await getSql()`UPDATE api_keys SET revoked_at = now() WHERE prefix = ${issued.prefix} AND team_id = ${a.teamId}`;
    expect(await authenticateApiKey(issued.apiKey)).toBeNull();
    expect(await authenticateApiKey("wrong")).toBeNull();
  });

  it("joins teams, exposes isolated overview and manages web sessions", async () => {
    await teamOverview(a);
    const joined = await joinTeam({
      inviteCode,
      memberName: "New member",
    });
    expect(joined?.ctx.teamId).toBe(a.teamId);
    expect(
      await joinTeam({ inviteCode: "hive-missing", memberName: "Nobody" }),
    ).toBeNull();
    expect((await listMembers(a)).map((member) => member.name)).toEqual([
      "Alice",
      "New member",
    ]);
    expect((await teamOverview(b)).learningCount).toBe(0);
    await startWebSession(a);
    expect(await getWebContext()).toEqual(a);
    await endWebSession();
    expect(await getWebContext()).toBeNull();
    await startWebSession(a);
    await getSql()`UPDATE web_sessions SET expires_at = now() - interval '1 day' WHERE team_id = ${a.teamId}`;
    expect(await getWebContext()).toBeNull();
    jar.clear();
  });

  it("returns and logs empty answers and extractive answers", async () => {
    const empty = await askHive(b, { question: "aardvark" });
    expect(empty).toMatchObject({
      synthesized: false,
      confidence: "low",
      citations: [],
    });
    const result = await askHive(a, { question: "capybara" });
    expect(result.citations.length).toBeGreaterThan(0);
    const rows =
      await getSql()`SELECT cited_ids FROM ask_log WHERE team_id = ${a.teamId}`;
    expect(rows[0].cited_ids).toEqual(
      result.citations.map((citation) => citation.id),
    );
  });

  it("filters kinds and counts only this week's friction observations", async () => {
    const data = hivePushInput.parse({
      title: "Slow fixture forager",
      body: "An observed tool delay.",
      kind: "friction",
      area: "tool",
      cost: 100,
      blocked: true,
      repo: "team/friction",
    });
    const first = await pushLearning(a, data);
    await getSql()`UPDATE learning_pushes SET created_at = now() - interval '8 days' WHERE learning_id = ${first.id} AND team_id = ${a.teamId}`;
    const second = await pushLearning(a, {
      ...data,
      title: "slow fixture forager",
      cost: 7,
      blocked: false,
    });
    const third = await pushLearning(a, {
      ...data,
      cost: undefined,
      blocked: false,
    });
    expect(second.id).toBe(first.id);
    expect(third.learning.cost).toBe(107);
    const insight = await pushLearning(
      a,
      hivePushInput.parse({
        title: data.title,
        body: "A broader team observation.",
        kind: "insight",
        repo: data.repo,
      }),
    );
    expect(insight.merged).toBe(false);
    expect(
      (
        await recentLearnings(a, { since: "1d", kind: "friction", limit: 50 })
      ).map((item) => item.id),
    ).toEqual([first.id]);
    expect(
      (
        await searchLearnings(a, {
          query: "fixture forager",
          kind: "insight",
          limit: 25,
        })
      ).map((item) => item.id),
    ).toEqual([insight.id]);
    const summary = await frictionSummary(a);
    expect(summary).toMatchObject({
      count: 2,
      minutes: 7,
      unmeasured: 1,
      blocked: 0,
      recurring: [{ count: 2, minutes: 7, ids: [first.id] }],
    });
    expect((await frictionSummary(b)).count).toBe(0);
    expect((await frictionSummary(a, "team/other")).count).toBe(0);
    const answer = await askHive(a, {
      question: "what is slowing the team down",
    });
    expect(answer.answer).toContain("7 measured minutes");
    expect(answer.citations.map((item) => item.id)).toContain(first.id);
    expect(answer.gaps).toContain("excludes reports without a measured cost");
  });

  it("refuses sensitive pushes before writing a learning or embedding", async () => {
    const before =
      await getSql()`SELECT count(*)::int AS count FROM learnings WHERE team_id = ${a.teamId}`;
    const spy = vi.spyOn(classifier, "classifyPush").mockResolvedValueOnce({
      classification: null,
      decision: {
        action: "refuse",
        kind: "learning",
        tags: [],
        worthSharing: true,
        severity: null,
      },
    });
    try {
      await expect(
        pushLearning(
          a,
          hivePushInput.parse({
            title: "Private fixture",
            body: "Private contact details.",
          }),
        ),
      ).rejects.toThrow("personal data");
      const after =
        await getSql()`SELECT count(*)::int AS count FROM learnings WHERE team_id = ${a.teamId}`;
      expect(after[0].count).toBe(before[0].count);
    } finally {
      spy.mockRestore();
    }
  });

  it("stores classifier evidence and refuses an unsupported ask before synthesis", async () => {
    const pushSpy = vi.spyOn(classifier, "classifyPush").mockResolvedValueOnce({
      classification: null,
      decision: {
        action: "accept",
        kind: "insight",
        tags: ["process"],
        worthSharing: true,
        severity: null,
      },
    });
    const learning = await pushLearning(
      a,
      hivePushInput.parse({
        title: "Classifier porcupine",
        body: "Porcupine team workflow.",
      }),
    );
    expect(learning.learning.kind).toBe("insight");
    pushSpy.mockRestore();
    const evidence = {
      model: "jev-1.13.0",
      latencyMs: 45,
      answers: { relevant: { type: "noul" as const, noul: 0.03 } },
    };
    const askSpy = vi
      .spyOn(classifier, "classifyAsk")
      .mockResolvedValueOnce({ decision: "gap", classification: evidence });
    try {
      const result = await askHive(a, { question: "porcupine" });
      expect(result).toMatchObject({
        synthesized: false,
        confidence: "low",
        citations: [],
      });
      const rows =
        await getSql()`SELECT classification FROM ask_log WHERE team_id = ${a.teamId} AND question = 'porcupine'`;
      expect(rows[0].classification).toEqual(evidence);
    } finally {
      askSpy.mockRestore();
    }
  });

  it("records trusted MCP mutations, refusals and retrieval without private content", async () => {
    const rows: EventRow[] = [];
    const actor = bindApiKey(a, "key_aaaaaaaaaaaa");
    await withOrigin(
      originFor(actor, "mcp"),
      async () => {
        const input = hivePushInput.parse({
          title: "Boundary fixture mandarin",
          body: "Private fixture prose about a deployment rule.",
          kind: "gotcha",
          source: "codex",
        });
        const first = await pushLearning(actor, input);
        const merged = await pushLearning(actor, input);
        expect(merged.merged).toBe(true);
        await recordFeedback(actor, {
          id: first.id,
          vote: "up",
          note: "Private vote text",
        });
        await pushLearning(
          actor,
          hivePushInput.parse({
            ...input,
            title: "Boundary fixture correction",
            body: "Corrected deployment rule.",
            supersedes: first.id,
          }),
        );
        await searchLearnings(actor, {
          query: "Private mandarin query",
          limit: 8,
        });
        await askHive(actor, { question: "Private mandarin question" });
        await recentLearnings(actor, { since: "24h", limit: 20 });
        const spy = vi.spyOn(classifier, "classifyPush").mockResolvedValueOnce({
          classification: null,
          decision: {
            action: "refuse",
            kind: "learning",
            tags: [],
            worthSharing: true,
            severity: null,
          },
        });
        try {
          await expect(pushLearning(actor, input)).rejects.toThrow(
            "personal data",
          );
        } finally {
          spy.mockRestore();
        }
      },
      async (row) => {
        rows.push(row);
      },
    );
    expect(
      rows.every(
        (row) =>
          row.team_id === a.teamId &&
          row.member_id === a.memberId &&
          row.api_key_id === "key_aaaaaaaaaaaa" &&
          ["mcp", "slack"].includes(row.entrypoint),
      ),
    ).toBe(true);
    expect(new Set(rows.map((row) => row.request_id)).size).toBe(1);
    expect(
      rows.filter(
        (row) =>
          row.event_name === "learning.pushed" && row.outcome === "completed",
      ),
    ).toHaveLength(3);
    expect(
      rows.find(
        (row) => row.event_name === "learning.pushed" && row.properties.merged,
      ),
    ).toBeDefined();
    expect(
      rows.find((row) => row.event_name === "learning.superseded"),
    ).toBeDefined();
    expect(
      rows.find(
        (row) =>
          row.event_name === "learning.lifecycle_changed" &&
          row.properties.state === "superseded",
      ),
    ).toBeDefined();
    expect(
      rows.find(
        (row) =>
          row.event_name === "learning.pushed" &&
          row.reason_code === "sensitive_refused",
      ),
    ).toBeDefined();
    expect(
      rows.find((row) => row.event_name === "learning.feedback")?.properties
        .vote,
    ).toBe("up");
    expect(rows.some((row) => row.event_name === "search.performed")).toBe(
      true,
    );
    expect(rows.some((row) => row.event_name === "ask.performed")).toBe(true);
    expect(rows.some((row) => row.event_name === "recent.performed")).toBe(
      true,
    );
    expect(JSON.stringify(rows)).not.toMatch(/Private|mandarin|correction/);
  });

  it("handles every recent since form and an early access submission", async () => {
    for (const since of ["24h", "7d", "30m", "1w", "2026-01-01T00:00:00Z"]) {
      expect(
        (await recentLearnings(a, { since, limit: 50 })).length,
      ).toBeGreaterThan(0);
    }
    const result = await submitEarlyAccess({
      name: "Test",
      email: "test@example.com",
      company: "",
      teamSize: "1-5",
    });
    earlyIds.push(result.id);
    expect(result.id).toMatch(/^ea_[a-z2-7]{12}$/);
    expect(typeof (await hasEmbeddingColumn())).toBe("boolean");
  });
});
