import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hivePushInput, type HiveContext } from "@hivemind/core";
import { createTeam } from "./auth";
import { getSql } from "./db/client";
import { newId } from "./db/ids";
import { askHive, getLearning, pushLearning, searchLearnings } from "./hive";
import { editLearning, learningVersions, listConflicts, resolveConflict, verificationHorizon } from "./lifecycle";
import { judgeMemory } from "./memory-judgments";
vi.mock("./llm/embeddings", () => ({ embedText: async () => null }));
vi.mock("./memory-judgments", () => ({ judgeMemory: vi.fn(async () => ({ relations: [], tags: [] })), rerankMemory: async (_: string, hits: unknown[]) => hits }));

it("uses a short horizon for environment and version facts", () => {
  const now = Date.now();
  expect(verificationHorizon("decision", "environment", []).getTime() - now).toBeCloseTo(14 * 86400000, -3);
  expect(verificationHorizon("decision", undefined, ["versions"]).getTime() - now).toBeCloseTo(30 * 86400000, -3);
  expect(verificationHorizon("gotcha", undefined, [], "2026-01-01T00:00:00Z").toISOString()).toBe("2026-01-01T00:00:00.000Z");
});

describe.skipIf(!process.env.DATABASE_URL)("learning lifecycle integration", () => {
  let a: HiveContext, b: HiveContext, c: HiveContext, d: HiveContext;
  const teamIds: string[] = [];
  const push = (ctx: HiveContext, title: string, body: string, extra = {}) => pushLearning(ctx, hivePushInput.parse({ title, body, ...extra }));
  beforeAll(async () => {
    a = (await createTeam({ teamName: "Lifecycle A", memberName: "Alice" })).ctx;
    b = (await createTeam({ teamName: "Lifecycle B", memberName: "Bob" })).ctx;
    teamIds.push(a.teamId, b.teamId);
    c = { ...a, memberId: newId("mem"), memberName: "Carol" };
    d = { ...a, memberId: newId("mem"), memberName: "Dan" };
    for (const ctx of [c, d]) await getSql()`INSERT INTO members (id, team_id, name) VALUES (${ctx.memberId}, ${ctx.teamId}, ${ctx.memberName})`;
  });
  beforeEach(() => { vi.mocked(judgeMemory).mockResolvedValue({ relations: [], tags: [] }); });
  afterAll(async () => {
    const sql = getSql();
    for (const table of ["feedback", "learning_pushes", "ask_log", "learnings", "api_keys", "web_sessions", "members", "teams"]) {
      if (table === "teams") await sql`DELETE FROM teams WHERE id = ANY(${teamIds}::text[])`;
      else await sql`DELETE FROM ${sql(table)} WHERE team_id = ANY(${teamIds}::text[])`;
    }
    await sql.end();
  });
  it("keeps old cells readable, excludes them from default search and cites the chain", async () => {
    const old = await push(a, "Capybara gate", "Capybara gate runs on port 3000.");
    const current = await push(a, "Capybara gate", "Capybara gate now runs on port 3001.", { supersedes: old.id, verify_after: "2020-01-01T00:00:00Z" });
    expect(current.merged).toBe(false);
    expect(await getLearning(a, old.id)).toMatchObject({ lifecycle: "superseded", supersededBy: current.id });
    expect(current.learning.verifyBeforeUse).toBe(true);
    expect((await searchLearnings(a, { query: "Capybara gate", limit: 8 })).map((hit) => hit.id)).toEqual([current.id]);
    expect((await searchLearnings(a, { query: "Capybara gate", limit: 8, include_history: true })).map((hit) => hit.id)).toContain(old.id);
    const answer = await askHive(a, { question: "Capybara gate" });
    expect(answer.answer).toContain(`[${old.id}]`);
    expect(answer.answer).toContain(`[${current.id}]`);
    expect(answer.answer).toContain("As of ");
    expect(answer.answer).toContain("Verify before use");
    expect(answer.citations.map((citation) => citation.id)).toEqual(expect.arrayContaining([old.id, current.id]));
    await expect(push(a, "Invalid reverse", "A reverse correction.", { supersedes: old.id })).rejects.toThrow("current cell");
  });
  it("does not merge changed claims when the classifier is unavailable", async () => {
    const old = await push(a, "Separate claims", "The endpoint accepts writes.");
    const next = await push(a, "Separate claims", "The endpoint rejects writes.");
    expect(next.id).not.toBe(old.id);
    expect(next.merged).toBe(false);
    expect((await getLearning(a, old.id))?.body).toBe("The endpoint accepts writes.");
  });
  it("rejects cross-team targets, conflicts, versions and edits", async () => {
    const old = await push(a, "Private koala", "Private team data.");
    await expect(push(b, "Bad target", "Cannot reference another team.", { supersedes: old.id })).rejects.toThrow("not found");
    expect(await getLearning(b, old.id)).toBeNull();
    await expect(learningVersions(b, old.id)).rejects.toThrow("not found");
    await expect(editLearning(b, old.id, { revision: 1, body: "Leaked" })).rejects.toThrow("not found");
    expect(await listConflicts(b)).toEqual([]);
    await expect(resolveConflict(b, "sup_missing", "confirm")).rejects.toThrow("not found");
  });
  it("serializes two concurrent explicit replacements without an orphan correction", async () => {
    const old = await push(a, "Concurrent correction", "Before replacement.");
    const results = await Promise.allSettled([push(a, "Correction one", "First replacement.", { supersedes: old.id }), push(a, "Correction two", "Second replacement.", { supersedes: old.id })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rows = await getSql()`SELECT id FROM learnings WHERE team_id = ${a.teamId} AND title IN ('Correction one','Correction two')`;
    expect(rows).toHaveLength(1);
  });
  it("stores candidate conflicts and requires two distinct member votes", async () => {
    const old = await push(a, "Team switch", "Enable the switch.");
    vi.mocked(judgeMemory).mockImplementation(async (_, candidates) => ({ tags: [], relations: candidates.map((item) => ({ id: item.id, revision: item.revision, relation: "contradiction", confidence: 0.85 })) }));
    const newer = await push(c, "Team switch", "Disable the switch.");
    const edge = (await listConflicts(a)).find((item) => item.older.id === old.id)!;
    expect(edge.newer.id).toBe(newer.id);
    await expect(resolveConflict(b, edge.id, "confirm")).rejects.toThrow("not found");
    await expect(resolveConflict(c, edge.id, "reject")).rejects.toThrow("admin");
    expect(await resolveConflict(c, edge.id, "confirm")).toEqual({ status: "candidate" });
    expect(await resolveConflict(c, edge.id, "confirm")).toEqual({ status: "candidate" });
    expect(await resolveConflict(d, edge.id, "confirm")).toEqual({ status: "accepted" });
    expect((await getLearning(a, old.id))?.supersededBy).toBe(newer.id);
  });
  it("versions edits and prevents stale conflict acceptance", async () => {
    const old = await push(a, "Changed switch", "Enable the setting.");
    vi.mocked(judgeMemory).mockImplementation(async (_, candidates) => ({ tags: [], relations: candidates.map((item) => ({ id: item.id, revision: item.revision, relation: "update", confidence: 0.8 })) }));
    await push(c, "Changed switch", "Disable the setting.");
    const edge = (await listConflicts(a)).find((item) => item.older.id === old.id)!;
    await expect(editLearning(c, old.id, { revision: 1, body: "Not authorized" })).rejects.toThrow("author");
    await editLearning(a, old.id, { revision: 1, body: "Enable only for tests." });
    const history = await learningVersions(a, old.id);
    expect(history.map((version) => version.revision)).toEqual([2, 1]);
    expect(history[0].diff.body).toEqual({ before: "Enable the setting.", after: "Enable only for tests." });
    await expect(editLearning(a, old.id, { revision: 1, body: "Stale" })).rejects.toThrow("changed");
    await expect(resolveConflict(a, edge.id, "confirm")).rejects.toThrow("changed");
    expect(await resolveConflict(a, edge.id, "reject")).toEqual({ status: "rejected" });
  });
  it("automatically accepts confident author and environment corrections", async () => {
    vi.mocked(judgeMemory).mockImplementation(async (_, candidates) => ({ tags: [], relations: candidates.map((item) => ({ id: item.id, revision: item.revision, relation: "update", confidence: 0.99 })) }));
    const first = await push(a, "Author correction", "The author used port 9000.");
    const second = await push(a, "Author correction", "The author now uses port 9001.");
    expect((await getLearning(a, first.id))?.supersededBy).toBe(second.id);
    const env = await push(a, "Environment port", "Use port 9100.", { area: "environment" });
    const changed = await push(c, "Environment port", "Use port 9101.", { area: "environment", confidence: 0.99 });
    expect((await getLearning(a, env.id))?.supersededBy).toBe(changed.id);
  });
});
