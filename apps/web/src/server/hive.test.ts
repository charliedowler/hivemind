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
  pushLearning,
  searchLearnings,
  recentLearnings,
  getLearning,
  recordFeedback,
  askHive,
  listMembers,
  teamOverview,
  submitEarlyAccess,
} from "./hive";
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

  it("dedupes normalized titles, merges fields and records every push with embeddings off", async () => {
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
        body: "A much longer body with more evidence and context.",
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
    expect(second.learning.body).toContain("much longer");
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
