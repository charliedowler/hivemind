import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { hivePushInput, type HiveContext } from "@hivemind/core";
import { createTeam } from "./auth";
import { getSql } from "./db/client";
import { newId } from "./db/ids";
import { askHive, getLearning, pushLearning, searchLearnings } from "./hive";
import {
  editLearning,
  learningVersions,
  listConflicts,
  resolveConflict,
  verificationHorizon,
  answerLifecycleContext,
  acceptSupersession,
} from "./lifecycle";
import { learningView } from "./learning-view";
import { learningVisibleTo, visibleSupersededBySql } from "./capture-visibility";
import { PgDialect } from "drizzle-orm/pg-core";
import { frictionSummary } from "./friction";
import { createCaptureRule, deleteCaptureRule } from "./capture-rules";
import { applyConflictDecision, conflictCell, decisionRepos, listDecisions, reverseDecision, retryRelatedConflicts } from "./conflict-decisions";
import { embedText } from "./llm/embeddings";
import { judgeConflict } from "./conflict-judgments";
vi.mock("./conflict-judgments", async importOriginal => {
  const module = await importOriginal<typeof import("./conflict-judgments")>();
  return { ...module, judgeConflict: vi.fn(async () => ({ decision: "undecided", reason: "Both models remain uncertain.", confidence: 0.4, model: "unavailable", jev: null, latencyMs: 0 })) };
});
import { judgeMemory } from "./memory-judgments";
vi.mock("./llm/embeddings", () => ({ embedText: vi.fn(async () => null) }));
vi.mock("./memory-judgments", () => ({
  judgeMemory: vi.fn(async () => ({ relations: [], tags: [] })),
  rerankMemory: async (_: string, hits: unknown[]) => hits,
}));

it("uses a short horizon for environment and version facts", () => {
  const now = Date.now();
  expect(
    verificationHorizon("decision", "environment", []).getTime() - now,
  ).toBeCloseTo(14 * 86400000, -3);
  expect(
    verificationHorizon("decision", undefined, ["versions"]).getTime() - now,
  ).toBeCloseTo(30 * 86400000, -3);
  expect(
    verificationHorizon(
      "gotcha",
      undefined,
      [],
      "2026-01-01T00:00:00Z",
    ).toISOString(),
  ).toBe("2026-01-01T00:00:00.000Z");
});

it("builds the same owner-only SQL predicate for Drizzle queries", () => {
  const query = new PgDialect().sqlToQuery(learningVisibleTo({teamId: "team", teamName: "Team", memberId: "owner", memberName: "Owner"}));
  expect(query.sql).toContain("capture_flagged = false OR");
  expect(query.params).toEqual([false, "owner"]);
});

describe.skipIf(!process.env.DATABASE_URL)(
  "learning lifecycle integration",
  () => {
    let a: HiveContext, b: HiveContext, c: HiveContext, d: HiveContext;
    const teamIds: string[] = [];
    const push = async (ctx: HiveContext, title: string, body: string, extra = {}) => {
      const result = await pushLearning(ctx, hivePushInput.parse({ title, body, ...extra }));
      if ("dropped" in result) throw new Error("Unexpected dropped fixture.");
      return result;
    };
    const privacyCell = async (ctx: HiveContext, title: string, flagged = false, repo = "privacy/lifecycle") => {
      const id = newId("lrn");
      await getSql()`INSERT INTO learnings (id, team_id, member_id, title, body, kind, repo, source, confidence, capture_flagged) VALUES (${id}, ${ctx.teamId}, ${ctx.memberId}, ${title}, ${title + " body"}, 'learning', ${repo}, 'codex', 1, ${flagged})`;
      return id;
    };
    const privacyEdge = async (olderId: string, newerId: string, status = "candidate") => {
      const rows = await getSql()`SELECT id, revision FROM learnings WHERE team_id = ${a.teamId} AND id = ANY(${[olderId, newerId]}::text[])`;
      const id = newId("sup");
      await getSql()`INSERT INTO learning_supersessions (id, team_id, older_id, newer_id, older_revision, newer_revision, relation, confidence, reason, status, decided_at) VALUES (${id}, ${a.teamId}, ${olderId}, ${newerId}, ${rows.find(row => row.id === olderId)!.revision}, ${rows.find(row => row.id === newerId)!.revision}, 'update', 1, 'Privacy fixture', ${status}, ${status === "accepted" ? new Date() : null})`;
      return id;
    };
    beforeAll(async () => {
      a = (await createTeam({ teamName: "Lifecycle A", memberName: "Alice" }))
        .ctx;
      b = (await createTeam({ teamName: "Lifecycle B", memberName: "Bob" }))
        .ctx;
      teamIds.push(a.teamId, b.teamId);
      c = { ...a, memberId: newId("mem"), memberName: "Carol" };
      d = { ...a, memberId: newId("mem"), memberName: "Dan" };
      for (const ctx of [c, d])
        await getSql()`INSERT INTO members (id, team_id, name) VALUES (${ctx.memberId}, ${ctx.teamId}, ${ctx.memberName})`;
    });
    beforeEach(() => {
      vi.mocked(judgeMemory).mockResolvedValue({ relations: [], tags: [] });
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
          await sql`DELETE FROM teams WHERE id = ANY(${teamIds}::text[])`;
        else
          await sql`DELETE FROM ${sql(table)} WHERE team_id = ANY(${teamIds}::text[])`;
      }
      await sql.end();
    });
    it("guards flagged version and evidence reads and admin edits by the cell owner", async () => {
      const id = await privacyCell(c, "Owner only versions", true);
      expect(await learningVersions(c, id)).not.toHaveLength(0);
      expect(await conflictCell(c, id)).toMatchObject({id, title: "Owner only versions"});
      for (const ctx of [a, b, d]) {
        await expect(learningVersions(ctx, id)).rejects.toMatchObject({status: 404});
        await expect(editLearning(ctx, id, {revision: 1, body: "Disallowed edit"})).rejects.toMatchObject({status: 404});
        expect(await conflictCell(ctx, id)).toBeNull();
      }
      await editLearning(c, id, {revision: 1, body: "Owner changed body"});
      expect((await learningVersions(c, id))[0].content.body).toBe("Owner changed body");
    });
    for (const flaggedEnd of ["older", "newer"])
      it(`requires owner visibility at the ${flaggedEnd} endpoint of conflict and decision paths`, async () => {
        const repo = `privacy/${flaggedEnd}`;
        const older = await privacyCell(flaggedEnd === "older" ? c : a, `Private ${flaggedEnd} older`, flaggedEnd === "older", repo);
        const newer = await privacyCell(flaggedEnd === "newer" ? c : a, `Private ${flaggedEnd} newer`, flaggedEnd === "newer", repo);
        const edge = await privacyEdge(older, newer);
        expect((await listConflicts(c)).map(item => item.id)).toContain(edge);
        for (const ctx of [a, b, d]) {
          expect((await listConflicts(ctx, true)).map(item => item.id)).not.toContain(edge);
          for (const action of ["confirm", "reject"] as const)
            await expect(resolveConflict(ctx, edge, action)).rejects.toMatchObject({status: 404});
          await expect(getSql().begin(tx => acceptSupersession(tx, ctx, edge, "Disallowed"))).rejects.toMatchObject({status: 404});
          await expect(getSql().begin(tx => applyConflictDecision(tx, ctx, edge, {decision: "keep_both", reason: "Disallowed", confidence: 1, model: "claude-sonnet-5-5", jev: null, latencyMs: 0}))).rejects.toMatchObject({status: 404});
        }
        vi.mocked(judgeConflict).mockClear();
        expect(await retryRelatedConflicts(a, newer)).toEqual([]);
        expect(judgeConflict).not.toHaveBeenCalled();
        const decision = await getSql().begin(tx => applyConflictDecision(tx, c, edge, {decision: "keep_both", reason: "Private decision reason", confidence: 1, model: "claude-sonnet-5-5", jev: null, latencyMs: 0}));
        expect(decision).not.toBeNull();
        expect((await listDecisions(c, {repo})).map(item => item.id)).toContain(decision!.id);
        expect(await decisionRepos(c)).toContain(repo);
        for (const ctx of [a, b, d]) {
          expect(await listDecisions(ctx, {repo, search: "Private"})).toEqual([]);
          expect(await decisionRepos(ctx)).not.toContain(repo);
        }
        await expect(reverseDecision(a, decision!.id, "Disallowed reversal")).rejects.toMatchObject({status: 404});
      });
    it("stops answer chains at every flagged endpoint and removes hidden version pointers", async () => {
      const oldest = await privacyCell(a, "Visible old ancestor");
      const hidden = await privacyCell(c, "Hidden chain middle", true);
      const current = await privacyCell(a, "Visible current leaf");
      await getSql()`UPDATE learnings SET superseded_by = ${hidden}, lifecycle = 'superseded' WHERE id = ${oldest}`;
      await getSql()`UPDATE learnings SET superseded_by = ${current}, lifecycle = 'superseded' WHERE id = ${hidden}`;
      await privacyEdge(oldest, hidden, "accepted");
      await privacyEdge(hidden, current, "accepted");
      const [row] = await getSql()`SELECT l.*, m.name AS author_name FROM learnings l JOIN members m ON m.id = l.member_id WHERE l.id = ${current}`;
      for (const ctx of [a, c, d, b]) {
        const context = await answerLifecycleContext(ctx, [learningView(row)]);
        expect(context.citations).toEqual([]);
        expect(JSON.stringify(context)).not.toContain(hidden);
        expect(JSON.stringify(context)).not.toContain(oldest);
      }
      expect(JSON.stringify(await learningVersions(a, oldest))).not.toContain(hidden);
      expect(JSON.stringify(await learningVersions(c, oldest))).toContain(hidden);
      const [projected] = await getSql()`SELECT ${visibleSupersededBySql(a)} AS successor FROM learnings l WHERE l.id = ${oldest}`;
      expect(projected.successor).toBeNull();
      const [privateRow] = await getSql()`SELECT l.*, m.name AS author_name FROM learnings l JOIN members m ON m.id = l.member_id WHERE l.id = ${hidden}`;
      const ownHidden = await answerLifecycleContext(c, [{...learningView(privateRow), verifyBeforeUse: true}]);
      expect(JSON.stringify(ownHidden)).not.toContain(hidden);
    });
    it("does not move owner-only evidence into a shared cell during duplicate decisions", async () => {
      const older = await privacyCell(a, "Shared duplicate target");
      const newer = await privacyCell(c, "Private duplicate source", true);
      const pushId = newId("push");
      await getSql()`INSERT INTO learning_pushes (id, learning_id, team_id, member_id, source, merged) VALUES (${pushId}, ${newer}, ${a.teamId}, ${c.memberId}, 'codex', false)`;
      await getSql()`INSERT INTO learning_evidence (push_id, team_id, learning_id, payload, object_key, digest, bytes) VALUES (${pushId}, ${a.teamId}, ${newer}, ${getSql().json({text: "Owner-only evidence"})}, 'private-evidence', 'digest', 1)`;
      const edge = await privacyEdge(older, newer);
      const result = await getSql().begin(tx => applyConflictDecision(tx, c, edge, {decision: "keep_old", reason: "Duplicate", confidence: 1, model: "claude-sonnet-5-5", jev: null, latencyMs: 0}));
      expect(result).toMatchObject({decision: "undecided", mergedInto: null});
      expect((await conflictCell(a, older))?.evidence).toEqual([]);
      expect(await conflictCell(a, newer)).toBeNull();
      expect(await getSql()`SELECT learning_id FROM learning_evidence WHERE push_id = ${pushId}`).toMatchObject([{learning_id: newer}]);
    });
    it("hides pre-redaction decision reasons and prevents searches from matching their old text", async () => {
      const older = await privacyCell(a, "Safe reason older", false, "privacy/reasons");
      const newer = await privacyCell(c, "Safe reason newer", false, "privacy/reasons");
      const edge = await privacyEdge(older, newer);
      const result = await getSql().begin(tx => applyConflictDecision(tx, c, edge, {decision: "keep_both", reason: "sensitive-original-reason", confidence: 1, model: "claude-sonnet-5-5", jev: null, latencyMs: 0}));
      await getSql()`UPDATE learnings SET capture_redacted = true WHERE id = ${older}`;
      expect((await listDecisions(a, {repo: "privacy/reasons"})).find(item => item.id === result!.id)?.reason).toBe("A cell was redacted by a capture rule.");
      expect((await listConflicts(a, true)).find(item => item.id === edge)?.reason).not.toContain("sensitive-original-reason");
      expect(await listDecisions(a, {repo: "privacy/reasons", search: "sensitive-original-reason"})).toEqual([]);
    });
    it("excludes every flagged report from friction totals and citations, including the owner's", async () => {
      const repo = "privacy/friction";
      const publicId = await privacyCell(a, "Shared friction", false, repo);
      const privateId = await privacyCell(c, "Hidden friction", true, repo);
      for (const [id, ctx, cost] of [[publicId, a, 7], [privateId, c, 100]] as const) {
        await getSql()`UPDATE learnings SET kind = 'friction', area = 'tool', cost = ${cost} WHERE id = ${id}`;
        await getSql()`INSERT INTO learning_pushes (id, learning_id, team_id, member_id, source, merged, area, cost, blocked) VALUES (${newId("push")}, ${id}, ${a.teamId}, ${ctx.memberId}, 'codex', false, 'tool', ${cost}, ${id === privateId})`;
      }
      for (const ctx of [a, c, d]) {
        const summary = await frictionSummary(ctx, repo);
        expect(summary).toMatchObject({count: 1, minutes: 7, blocked: 0, cells: [{id: publicId, title: "Shared friction"}]});
        expect(JSON.stringify(summary)).not.toContain(privateId);
        expect(JSON.stringify(summary)).not.toContain("Hidden friction");
      }
    });
    it("drops edits before embedding, mutation, versions or evidence persist", async () => {
      const id = await privacyCell(c, "Edit drop target");
      const rule = await createCaptureRule(c, {name: "Edit exclusion", scope: "member", kind: "keyword", pattern: "excluded-text", regex: false, caseSensitive: false, action: "drop", enabled: true, source: "web"});
      try {
        vi.mocked(embedText).mockClear();
        await expect(editLearning(c, id, {revision: 1, body: "excluded-text"})).rejects.toMatchObject({status: 422});
        expect(embedText).not.toHaveBeenCalled();
        const versions = await learningVersions(c, id);
        expect(versions).toHaveLength(1);
        expect(versions[0].content.body).toBe("Edit drop target body");
      } finally {
        await deleteCaptureRule(c, rule.id);
      }
    });
    it("flags edit sidecar matches and revokes old snapshot capabilities", async () => {
      const id = await privacyCell(c, "Flag sidecar edit");
      await getSql()`UPDATE learnings SET tags = ${["private-sidecar"]}, capture_categories = ${getSql().json({customer_data: true})} WHERE id = ${id}`;
      const rule = await createCaptureRule(c, {name: "Private sidecar", scope: "member", kind: "keyword", pattern: "private-sidecar", regex: false, caseSensitive: false, action: "flag", enabled: true, source: "web"});
      try {
        await getSql()`INSERT INTO knowledge_snapshots (token_hash, team_id, member_id, revision, object_key, expires_at) VALUES (${newId("token")}, ${a.teamId}, ${a.memberId}, 1, 'old-archive', now() + interval '15 minutes')`;
        const [before] = await getSql()`SELECT revision FROM learnings WHERE id = ${id}`;
        await editLearning(c, id, {revision: before.revision, lifecycle: "confirmed"});
        const [row] = await getSql()`SELECT * FROM learnings WHERE id = ${id}`;
        expect(row).toMatchObject({capture_flagged: true, capture_rule_ids: [rule.id], capture_categories: {customer_data: true}});
        expect(await getSql()`SELECT token_hash FROM knowledge_snapshots WHERE team_id = ${a.teamId}`).toEqual([]);
        await expect(learningVersions(a, id)).rejects.toMatchObject({status: 404});
      } finally {
        await deleteCaptureRule(c, rule.id);
      }
    });
    it("redacts edit history, diffs, evidence and metadata and never reads retained evidence for a redacted cell", async () => {
      const id = await privacyCell(c, "Redaction original");
      const pushId = newId("push");
      await getSql()`UPDATE learnings SET tags = ${["mask-this"]}, paths = ${["mask-this/path"]}, session_ref = 'mask-this session', workaround = 'mask-this workaround' WHERE id = ${id}`;
      await getSql()`INSERT INTO learning_pushes (id, learning_id, team_id, member_id, source, merged, session_ref) VALUES (${pushId}, ${id}, ${a.teamId}, ${c.memberId}, 'codex', false, 'mask-this session')`;
      await getSql()`INSERT INTO learning_evidence (push_id, team_id, learning_id, payload, object_key, digest, bytes) VALUES (${pushId}, ${a.teamId}, ${id}, ${getSql().json({text: "mask-this evidence"})}, 'retained-evidence', 'digest', 1)`;
      const rule = await createCaptureRule(c, {name: "Edit mask", scope: "member", kind: "keyword", pattern: "mask-this", regex: false, caseSensitive: false, action: "redact", enabled: true, source: "web"});
      try {
        const [before] = await getSql()`SELECT revision FROM learnings WHERE id = ${id}`;
        await editLearning(c, id, {revision: before.revision, body: "mask-this original"});
        const [row] = await getSql()`SELECT * FROM learnings WHERE id = ${id}`;
        expect(row).toMatchObject({body: "[removed] original", capture_redacted: true, capture_rule_ids: [rule.id], tags: [], paths: [], repo: null, session_ref: null, workaround: null});
        const history = await learningVersions(a, id);
        expect(history).toHaveLength(1);
        expect(history[0].diff).toEqual({});
        expect(JSON.stringify(history)).not.toContain("mask-this");
        expect(await getSql()`SELECT push_id FROM learning_evidence WHERE learning_id = ${id}`).toEqual([]);
        await getSql()`INSERT INTO learning_evidence (push_id, team_id, learning_id, payload, object_key, digest, bytes) VALUES (${pushId}, ${a.teamId}, ${id}, ${getSql().json({text: "mask-this retained evidence"})}, 'retained-evidence', 'digest', 1)`;
        expect((await conflictCell(a, id))?.evidence).toEqual([]);
      } finally {
        await deleteCaptureRule(c, rule.id);
      }
    });
    it("keeps old cells readable, excludes them from default search and cites the chain", async () => {
      const old = await push(
        a,
        "Capybara gate",
        "Capybara gate runs on port 3000.",
      );
      const current = await push(
        a,
        "Capybara gate",
        "Capybara gate now runs on port 3001.",
        { supersedes: old.id, verify_after: "2020-01-01T00:00:00Z" },
      );
      expect(current.merged).toBe(false);
      expect(await getLearning(a, old.id)).toMatchObject({
        lifecycle: "superseded",
        supersededBy: current.id,
      });
      expect(current.learning.verifyBeforeUse).toBe(true);
      expect(
        (await searchLearnings(a, { query: "Capybara gate", limit: 8 })).map(
          (hit) => hit.id,
        ),
      ).toEqual([current.id]);
      expect(
        (
          await searchLearnings(a, {
            query: "Capybara gate",
            limit: 8,
            include_history: true,
          })
        ).map((hit) => hit.id),
      ).toContain(old.id);
      const answer = await askHive(a, { question: "Capybara gate" });
      expect(answer.answer).toContain(`[${old.id}]`);
      expect(answer.answer).toContain(`[${current.id}]`);
      expect(answer.answer).toContain("As of ");
      expect(answer.answer).toContain("Verify before use");
      expect(answer.citations.map((citation) => citation.id)).toEqual(
        expect.arrayContaining([old.id, current.id]),
      );
      await expect(
        push(a, "Invalid reverse", "A reverse correction.", {
          supersedes: old.id,
        }),
      ).rejects.toThrow("current cell");
    });
    it("does not merge changed claims when the classifier is unavailable", async () => {
      const old = await push(
        a,
        "Separate claims",
        "The endpoint accepts writes.",
      );
      const next = await push(
        a,
        "Separate claims",
        "The endpoint rejects writes.",
      );
      expect(next.id).not.toBe(old.id);
      expect(next.merged).toBe(false);
      expect((await getLearning(a, old.id))?.body).toBe(
        "The endpoint accepts writes.",
      );
    });
    it("rejects cross-team targets, conflicts, versions and edits", async () => {
      const old = await push(a, "Private koala", "Private team data.");
      await expect(
        push(b, "Bad target", "Cannot reference another team.", {
          supersedes: old.id,
        }),
      ).rejects.toThrow("not found");
      expect(await getLearning(b, old.id)).toBeNull();
      await expect(learningVersions(b, old.id)).rejects.toThrow("not found");
      await expect(
        editLearning(b, old.id, { revision: 1, body: "Leaked" }),
      ).rejects.toThrow("not found");
      expect(await listConflicts(b)).toEqual([]);
      await expect(
        resolveConflict(b, "sup_missing", "confirm"),
      ).rejects.toThrow("not found");
    });
    it("serializes two concurrent explicit replacements without an orphan correction", async () => {
      const old = await push(a, "Concurrent correction", "Before replacement.");
      const results = await Promise.allSettled([
        push(a, "Correction one", "First replacement.", { supersedes: old.id }),
        push(a, "Correction two", "Second replacement.", {
          supersedes: old.id,
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rows =
        await getSql()`SELECT id FROM learnings WHERE team_id = ${a.teamId} AND title IN ('Correction one','Correction two')`;
      expect(rows).toHaveLength(1);
    });
    it("stores candidate conflicts and requires two distinct member votes", async () => {
      const old = await push(a, "Team switch", "Enable the switch.");
      vi.mocked(judgeMemory).mockImplementation(async (_, candidates) => ({
        tags: [],
        relations: candidates.map((item) => ({
          id: item.id,
          revision: item.revision,
          relation: "contradiction",
          confidence: 0.85,
        })),
      }));
      const newer = await push(c, "Team switch", "Disable the switch.");
      const edge = (await listConflicts(a)).find(
        (item) => item.older.id === old.id,
      )!;
      expect(edge.newer.id).toBe(newer.id);
      await expect(resolveConflict(b, edge.id, "confirm")).rejects.toThrow(
        "not found",
      );
      await expect(resolveConflict(c, edge.id, "reject")).rejects.toThrow(
        "admin",
      );
      expect(await resolveConflict(c, edge.id, "confirm")).toEqual({
        status: "candidate",
      });
      expect(await resolveConflict(c, edge.id, "confirm")).toEqual({
        status: "candidate",
      });
      expect(await resolveConflict(d, edge.id, "confirm")).toEqual({
        status: "accepted",
      });
      expect((await getLearning(a, old.id))?.supersededBy).toBe(newer.id);
    });
    it("versions edits and prevents stale conflict acceptance", async () => {
      const old = await push(a, "Changed switch", "Enable the setting.");
      vi.mocked(judgeMemory).mockImplementation(async (_, candidates) => ({
        tags: [],
        relations: candidates.map((item) => ({
          id: item.id,
          revision: item.revision,
          relation: "update",
          confidence: 0.8,
        })),
      }));
      await push(c, "Changed switch", "Disable the setting.");
      const edge = (await listConflicts(a)).find(
        (item) => item.older.id === old.id,
      )!;
      await expect(
        editLearning(c, old.id, { revision: 1, body: "Not authorized" }),
      ).rejects.toThrow("author");
      await editLearning(a, old.id, {
        revision: 1,
        body: "Enable only for tests.",
      });
      const history = await learningVersions(a, old.id);
      expect(history.map((version) => version.revision)).toEqual([2, 1]);
      expect(history[0].diff.body).toEqual({
        before: "Enable the setting.",
        after: "Enable only for tests.",
      });
      await expect(
        editLearning(a, old.id, { revision: 1, body: "Stale" }),
      ).rejects.toThrow("changed");
      await expect(resolveConflict(a, edge.id, "confirm")).rejects.toThrow(
        "changed",
      );
      expect(await resolveConflict(a, edge.id, "reject")).toEqual({
        status: "rejected",
      });
    });
    it("applies automatic decisions for author and environment corrections", async () => {
      vi.mocked(judgeConflict).mockResolvedValue({ decision: "supersede", reason: "New evidence replaces earlier guidance.", confidence: 0.99, model: "claude-sonnet-5-5", jev: null, latencyMs: 10 });
      vi.mocked(judgeMemory).mockImplementation(async (_, candidates) => ({
        tags: [],
        relations: candidates.map((item) => ({
          id: item.id,
          revision: item.revision,
          relation: "update",
          confidence: 0.99,
        })),
      }));
      const first = await push(
        a,
        "Author correction",
        "The author used port 9000.",
      );
      const second = await push(
        a,
        "Author correction",
        "The author now uses port 9001.",
      );
      expect((await getLearning(a, first.id))?.supersededBy).toBe(second.id);
      const env = await push(a, "Environment port", "Use port 9100.", {
        area: "environment",
      });
      const changed = await push(c, "Environment port", "Use port 9101.", {
        area: "environment",
        confidence: 0.99,
      });
      expect((await getLearning(a, env.id))?.supersededBy).toBe(changed.id);
    });
  },
);
