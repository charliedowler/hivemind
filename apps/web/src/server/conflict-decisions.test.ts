import {originFor, withOrigin} from "./analytics/events";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { hivePushInput, type HiveContext } from "@hivemind/core";
import { createTeam } from "./auth";
import { getSql } from "./db/client";
import { newId } from "./db/ids";
import { pushLearning as pushOrganisationFixture, getLearning } from "./hive";
import { editLearning } from "./lifecycle";
import {
  listDecisions,
  reverseDecision,
  retryRelatedConflicts,
  hasDecisionSnapshots,
  updateDecisionReason,
} from "./conflict-decisions";
import {
  judgeConflict,
  decideConflict,
  decisionKinds,
  type ConflictJev,
} from "./conflict-judgments";
import { judgeMemory } from "./memory-judgments";
import { runReversibleAction, undoLastAction } from "./slack/actions";
import { GET, POST } from "../app/api/app/conflicts/route";
const auth = vi.hoisted(() => ({ ctx: null as HiveContext | null }));
vi.mock("./auth", async (original) => ({
  ...(await original<typeof import("./auth")>()),
  getWebContext: async () => auth.ctx,
}));
vi.mock("./llm/embeddings", () => ({ embedText: async () => null }));
vi.mock("./classify", async (original) => ({
  ...(await original<typeof import("./classify")>()),
  classifyPush: async (input: { kind?: string }) => ({
    classification: null,
    decision: { action: "accept", kind: input.kind ?? "learning", tags: [] },
  }),
}));
vi.mock("./memory-judgments", () => ({
  judgeMemory: vi.fn(async () => ({ relations: [], tags: [] })),
  rerankMemory: async (_: string, hits: unknown[]) => hits,
}));
vi.mock("./conflict-judgments", async (original) => ({
  ...(await original<typeof import("./conflict-judgments")>()),
  judgeConflict: vi.fn(),
}));
const jev = (kind: (typeof decisionKinds)[number], confidence: number) =>
  ({
    decision: {
      type: "choice",
      choice: kind,
      confidence,
      probabilities: Object.fromEntries(
        decisionKinds.map((value) => [value, value === kind ? 0.96 : 0.01]),
      ),
    },
  }) as ConflictJev;
it("uses fixed Jev and Sonnet results for each decision and both confidence floors", () => {
  for (const decision of decisionKinds) {
    expect(
      decideConflict(jev("keep_both", 0.2), {
        decision,
        confidence: 0.8,
        reason: "Evidence supports this outcome.",
      }),
    ).toMatchObject({ decision, model: "claude-sonnet-5-5" });
    expect(
      decideConflict(jev(decision, 0.85), {
        decision: "keep_both",
        confidence: 0.79,
        reason: "Uncertain.",
      }),
    ).toMatchObject({ decision, model: "jev-1.13.0" });
  }
  expect(
    decideConflict(jev("supersede", 0.84), {
      decision: "supersede",
      confidence: 0.79,
      reason: "Uncertain.",
    }).decision,
  ).toBe("undecided");
  expect(decideConflict(null, null).decision).toBe("undecided");
});
describe.skipIf(!process.env.DATABASE_URL)(
  "automatic conflict integration",
  () => {
    let a: HiveContext, b: HiveContext, member: HiveContext;
    const teams: string[] = [];
    const push = async (ctx: HiveContext, title: string, body: string) => {
      const result = await pushLearning(
        ctx,
        hivePushInput.parse({
          title,
          body,
          repo: "team/conflicts",
          evidence: { session_excerpt: body },
        }),
      );
      if ("dropped" in result) throw new Error("Unexpected dropped fixture.");
      return result;
    };
    beforeAll(async () => {
      a = (await createTeam({ teamName: "Decisions A", memberName: "A" })).ctx;
      b = (await createTeam({ teamName: "Decisions B", memberName: "B" })).ctx;
      teams.push(a.teamId, b.teamId);
      member = { ...a, memberId: newId("mem"), memberName: "Member" };
      await getSql()`INSERT INTO members (id, name) VALUES (${member.memberId}, 'Member')`;
      await getSql()`INSERT INTO hive_memberships (member_id,team_id) VALUES (${member.memberId},${a.teamId})`;
    });
    beforeEach(() => {
      vi.mocked(judgeMemory).mockResolvedValue({ relations: [], tags: [] });
      auth.ctx = a;
      vi.mocked(judgeConflict).mockResolvedValue({
        decision: "undecided",
        reason: "Hive retries automatically.",
        confidence: 0.4,
        model: "unavailable",
        jev: null,
        latencyMs: 20,
      });
    });
    afterAll(async () => {
      for (const table of [
        "slack_tool_actions",
        "feedback",
        "learning_pushes",
        "ask_log",
        "learnings",
        "api_keys",
        "web_sessions",
        "members",
        "teams",
      ]) {
        const sql = getSql();
        if (table === "teams")
          await sql`DELETE FROM teams WHERE id = ANY(${teams}::text[])`;
        else if (table === "members")
          await sql`DELETE FROM members WHERE id IN (SELECT member_id FROM hive_memberships WHERE team_id = ANY(${teams}::text[]))`;
        else
          await sql`DELETE FROM ${sql(table)} WHERE team_id = ANY(${teams}::text[])`;
      }
      await getSql().end();
    });
    async function pair(
      decision: (typeof decisionKinds)[number] | "undecided",
      title: string,
    ) {
      const old = await push(a, title, "The setting accepts writes.");
      vi.mocked(judgeMemory).mockImplementation(async (_, candidates) => ({
        tags: [],
        relations: candidates.filter((cell) => cell.id === old.id).map((cell) => ({
          id: cell.id,
          revision: cell.revision,
          relation: "contradiction",
          confidence: 0.95,
        })),
      }));
      vi.mocked(judgeConflict).mockResolvedValue({
        decision,
        confidence: decision === "undecided" ? 0.4 : 0.9,
        reason: "Supplied evidence supports this outcome.",
        model: "claude-sonnet-5-5",
        jev: null,
        latencyMs: 21,
      });
      const next = await push(a, title, "The setting rejects writes.");
      const record = (await listDecisions(a, { search: title }))[0];
      return { old, next, record };
    }
    for (const decision of decisionKinds)
      it(`applies and reverses ${decision} atomically`, async () => {
        const { old, next, record } = await pair(
          decision,
          `Outcome ${decision}`,
        );
        expect(record.decision).toBe(decision);
        const oldCell = await getLearning(a, old.id),
          newCell = await getLearning(a, record.newer.id);
        if (decision === "supersede")
          expect(oldCell).toMatchObject({
            lifecycle: "superseded",
            supersededBy: record.newer.id,
          });
        if (decision === "keep_both") {
          expect(oldCell?.lifecycle).toBe("fresh");
          expect(newCell?.lifecycle).toBe("fresh");
        }
        if (decision === "keep_old") {
          expect(next).toMatchObject({
            id: old.id,
            merged: true,
            pushCount: 2,
          });
          expect(newCell?.lifecycle).toBe("retracted");
          const pushes =
            await getSql()`SELECT learning_id, merged FROM learning_pushes WHERE team_id = ${a.teamId} AND member_id = ${a.memberId} AND learning_id = ${old.id} AND merged`;
          expect(pushes).toHaveLength(1);
          expect(pushes[0].merged).toBe(true);
        }
        if (decision === "mark_outdated") {
          expect(oldCell?.lifecycle).toBe("outdated");
          const deadlines = await getSql()`SELECT verify_after <= now() AS due FROM learnings WHERE id = ${old.id} AND team_id = ${a.teamId}`;
          expect(deadlines[0].due).toBe(true);
          const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(oldCell!.verifyAfter!) + 1);
          try {
            expect((await getLearning(a, old.id))?.verifyBeforeUse).toBe(true);
          } finally {
            clock.mockRestore();
          }
          expect(newCell?.lifecycle).toBe("outdated");
        }
        if (decision === "retract_new")
          expect(newCell?.lifecycle).toBe("retracted");
        await expect(
          reverseDecision(member, record.id, "Incorrect automation."),
        ).rejects.toThrow("admin");
        await expect(
          reverseDecision(b, record.id, "Other team."),
        ).rejects.toThrow("not found");
        const reversed = await reverseDecision(a, record.id, "The evidence needs a correction.");
        expect((await getLearning(a, old.id))?.lifecycle).toBe("fresh");
        expect((await getLearning(a, record.newer.id))?.lifecycle).toBe(
          "fresh",
        );
        expect((await getLearning(a, old.id))?.pushCount).toBe(1);
        if (decision === "keep_old")
          expect(
            (
              await getSql()`SELECT learning_id FROM learning_pushes WHERE learning_id = ${record.newer.id} AND team_id = ${a.teamId}`
            ).length,
          ).toBe(1);
        expect(
          (await listDecisions(a, { search: record.older.title }))[0],
        ).toMatchObject({
          decision: "reversed",
          reason: "The evidence needs a correction.",
        });
        await expect(reverseDecision(a, record.id, "Again.")).rejects.toThrow(
          "already reversed",
        );
        await expect(reverseDecision(b, reversed.id)).rejects.toThrow("not found");
        await expect(reverseDecision(member, reversed.id)).rejects.toThrow("admin");
        const undone = await reverseDecision(a, reversed.id);
        expect(undone.decision).toBe(decision);
        expect((await getLearning(a, old.id))?.lifecycle).toBe(oldCell?.lifecycle);
        expect((await getLearning(a, old.id))?.pushCount).toBe(oldCell?.pushCount);
        expect((await getLearning(a, record.newer.id))?.lifecycle).toBe(newCell?.lifecycle);
        const edges = await getSql()`SELECT status FROM learning_supersessions WHERE id = (SELECT edge_id FROM conflict_decisions WHERE id = ${record.id}) AND team_id = ${a.teamId}`;
        expect(edges[0].status).toBe(decision === "supersede" ? "accepted" : "rejected");
        if (decision === "keep_old") {
          const moved = await getSql()`SELECT learning_id, merged FROM learning_pushes WHERE id = ANY((SELECT moved_push_ids FROM conflict_decisions WHERE id = ${record.id})::text[]) AND team_id = ${a.teamId}`;
          expect(moved).toHaveLength(1);
          expect(moved[0]).toMatchObject({ learning_id: old.id, merged: true });
        }
        await expect(reverseDecision(a, reversed.id)).rejects.toThrow("already reversed");
      });
    it("retries an undecided candidate on a related push without a member vote", async () => {
      const { old, record } = await pair("undecided", "Retry setting");
      expect((await getLearning(a, old.id))?.lifecycle).toBe("fresh");
      await getSql()`UPDATE learning_supersessions SET created_at = now() - interval '2 minutes' WHERE id = (SELECT edge_id FROM conflict_decisions WHERE id = ${record.id}) AND team_id = ${a.teamId}`;
      vi.mocked(judgeConflict).mockResolvedValue({
        decision: "supersede",
        reason: "Fresh evidence supports replacement.",
        confidence: 0.95,
        model: "claude-sonnet-5-5",
        jev: null,
        latencyMs: 20,
      });
      vi.mocked(judgeMemory).mockResolvedValue({ relations: [], tags: [] });
      await push(a, "Retry setting", "The setting accepts writes.");
      expect((await getLearning(a, old.id))?.supersededBy).toBe(
        record.newer.id,
      );
      expect(await listDecisions(b, { search: "Retry setting" })).toEqual([]);
    });
    it("reads only visible automatic changes touching the requested cell", async () => {
      const { old, record } = await pair("supersede", "Cell scoped history");
      await pair("keep_old", "Another cell history");
      expect((await listDecisions(a, { cellId: old.id })).map((item) => item.id)).toEqual([record.id]);
      const response = await GET(new Request(`https://hive.test/api/app/conflicts?cellId=${record.newer.id}`));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.decisions).toHaveLength(1);
      expect(body.decisions[0]).toMatchObject({ id: record.id, older: { lifecycle: "superseded" }, canReverse: true });
      auth.ctx = member;
      expect((await (await GET(new Request(`https://hive.test/api/app/conflicts?cellId=${old.id}`))).json()).decisions[0].canReverse).toBe(false);
      auth.ctx = b;
      expect((await (await GET(new Request(`https://hive.test/api/app/conflicts?cellId=${old.id}`))).json()).decisions).toEqual([]);
      expect((await GET(new Request("https://hive.test/api/app/conflicts"))).status).toBe(400);
      auth.ctx = null;
      expect((await GET(new Request(`https://hive.test/api/app/conflicts?cellId=${old.id}`))).status).toBe(401);
    });
    it("does not expose a cell change when either cell is private to another member", async () => {
      const { old } = await pair("supersede", "Private cell history");
      await getSql()`UPDATE learnings SET capture_flagged = true WHERE id = ${old.id} AND team_id = ${a.teamId}`;
      auth.ctx = member;
      const response = await GET(new Request(`https://hive.test/api/app/conflicts?cellId=${old.id}`));
      expect(response.status).toBe(200);
      expect((await response.json()).decisions).toEqual([]);
    });
    it("uses the default audit reason for a blank reason without changing the Slack or MCP default", async () => {
      const { record } = await pair("supersede", "Blank reason");
      const response = await POST(new Request("https://hive.test/api/app/conflicts", { method: "POST", body: JSON.stringify({ id: record.id, action: "reverse", reason: "  " }) }));
      expect(response.status).toBe(200);
      expect((await response.json()).reason).toBe("Admin requested reversal");
    });
    it("rejects reversal after a cell changes", async () => {
      const { old, record } = await pair("keep_both", "Edited decision");
      await editLearning(a, old.id, {
        revision: 1,
        body: "Evidence now changes.",
      });
      await expect(
        reverseDecision(a, record.id, "Unsafe reversal."),
      ).rejects.toThrow("changed");
      expect((await POST(new Request("https://hive.test/api/app/conflicts", { method: "POST", body: JSON.stringify({ id: record.id, action: "reverse" }) }))).status).toBe(409);
    });
    it("records Slack reversal and its inverse atomically without replaying the mutation", async () => {
      const { old, record } = await pair("supersede", "Slack reverse receipt");
      const context = { ...a, isAdmin: true, channelId: "CDECISIONS", threadTs: "1800000000.10", messageTs: "1800000000.11" };
      const result = await runReversibleAction(context, "hive_reverse_decision", async (tx) => {
        const reversed = await reverseDecision(a, record.id, undefined, tx, "from Slack");
        return { inverse: { kind: "decision_reversed", id: reversed.id }, text: "Cell change reversed.", undo: "restore the decision" };
      });
      expect(result.text).toBe("Cell change reversed.");
      expect((await getLearning(a, old.id))?.lifecycle).toBe("fresh");
      expect(await runReversibleAction(context, "hive_reverse_decision", async () => { throw new Error("A replay must not mutate"); })).toEqual(result);
      expect(await undoLastAction(context)).toEqual({ react: "white_check_mark", text: "Decision reapplied." });
      expect((await getLearning(a, old.id))?.lifecycle).toBe("superseded");
      expect((await undoLastAction(context)).text).toContain("already undone");
    });
    it("reverses without a reason and allows an optional audit correction", async () => {
      const { record } = await pair("keep_both", "Default audit reason");
      const response = await POST(new Request("https://hive.test/api/app/conflicts", { method: "POST", body: JSON.stringify({ id: record.id, action: "reverse" }) }));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.record).toMatchObject({ decision: "reversed", reason: "Admin requested reversal", canReverse: true, canEditReason: true });
      await updateDecisionReason(a, result.id, "Corrected audit note.");
      expect((await listDecisions(a, { id: result.id }))[0].reason).toBe("Corrected audit note.");
      await expect(updateDecisionReason(b, result.id, "Other team.")).rejects.toThrow("not found");
      await expect(updateDecisionReason(member, result.id, "Member note.")).rejects.toThrow("not found");
    });
    it("rejects undo after the reversed cell changes", async () => {
      const { old, record } = await pair("keep_both", "Stale undo");
      const reversed = await reverseDecision(a, record.id);
      await editLearning(a, old.id, { revision: 1, body: "Changed after reversal." });
      await expect(reverseDecision(a, reversed.id)).rejects.toMatchObject({ status: 409 });
    });
    it("lists legacy decisions without snapshots as not reversible", async () => {
      const { record } = await pair("keep_both", "Legacy snapshots");
      await getSql()`UPDATE conflict_decisions SET model = 'legacy', before_state = '[]'::jsonb, after_state = '[]'::jsonb WHERE id = ${record.id} AND team_id = ${a.teamId}`;
      expect((await listDecisions(a, { id: record.id }))[0].canReverse).toBe(false);
      await expect(reverseDecision(a, record.id)).rejects.toMatchObject({ status: 404 });
    });
    it("rejects the old vote API, cross-team reversals and missing sessions", async () => {
      const { record } = await pair("keep_both", "API reversal");
      const request = (action: string) => new Request("https://hive.test/api/app/conflicts", {
        method: "POST",
        body: JSON.stringify({ id: record.id, action }),
      });
      expect((await POST(request("confirm"))).status).toBe(400);
      auth.ctx = b;
      expect((await POST(request("reverse"))).status).toBe(404);
      auth.ctx = null;
      expect((await POST(request("reverse"))).status).toBe(401);
    });
  },
);

it("recognizes missing or mismatched legacy snapshots without throwing", () => {
  expect(hasDecisionSnapshots({})).toBe(false);
  expect(hasDecisionSnapshots({ before_state: [], after_state: [] })).toBe(false);
  expect(hasDecisionSnapshots({ before_state: null, after_state: {} })).toBe(false);
  const cells = [{ id: "a", revision: 1, lifecycle: "fresh" }, { id: "b", revision: 1, lifecycle: "fresh" }];
  expect(hasDecisionSnapshots({ before_state: cells, after_state: cells })).toBe(true);
  expect(hasDecisionSnapshots({ before_state: cells, after_state: cells.toReversed() })).toBe(false);
});

async function pushLearning(ctx: HiveContext, input: Parameters<typeof pushOrganisationFixture>[1]) {
  return withOrigin(originFor(ctx, "slack"), () => pushOrganisationFixture(ctx, input));
}
