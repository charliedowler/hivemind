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
import { pushLearning, getLearning } from "./hive";
import { editLearning } from "./lifecycle";
import {
  listDecisions,
  reverseDecision,
  retryRelatedConflicts,
} from "./conflict-decisions";
import {
  judgeConflict,
  decideConflict,
  decisionKinds,
  type ConflictJev,
} from "./conflict-judgments";
import { judgeMemory } from "./memory-judgments";
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
    const push = (ctx: HiveContext, title: string, body: string) =>
      pushLearning(
        ctx,
        hivePushInput.parse({
          title,
          body,
          repo: "team/conflicts",
          evidence: { session_excerpt: body },
        }),
      );
    beforeAll(async () => {
      a = (await createTeam({ teamName: "Decisions A", memberName: "A" })).ctx;
      b = (await createTeam({ teamName: "Decisions B", memberName: "B" })).ctx;
      teams.push(a.teamId, b.teamId);
      member = { ...a, memberId: newId("mem"), memberName: "Member" };
      await getSql()`INSERT INTO members (id, team_id, name) VALUES (${member.memberId}, ${a.teamId}, 'Member')`;
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
        relations: candidates.map((cell) => ({
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
      const next = await push(member, title, "The setting rejects writes.");
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
            await getSql()`SELECT learning_id, merged FROM learning_pushes WHERE team_id = ${a.teamId} AND member_id = ${member.memberId} AND learning_id = ${old.id}`;
          expect(pushes).toHaveLength(1);
          expect(pushes[0].merged).toBe(true);
        }
        if (decision === "mark_outdated") {
          expect(oldCell?.verifyBeforeUse).toBe(true);
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
        await reverseDecision(a, record.id, "The evidence needs a correction.");
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
    it("rejects reversal after a cell changes", async () => {
      const { old, record } = await pair("keep_both", "Edited decision");
      await editLearning(a, old.id, {
        revision: 1,
        body: "Evidence now changes.",
      });
      await expect(
        reverseDecision(a, record.id, "Unsafe reversal."),
      ).rejects.toThrow("changes");
    });
    it("serves the log with scoped filters and rejects the old vote API", async () => {
      const { record } = await pair("keep_both", "API filter");
      const response = await GET(
        new Request(
          "https://hive.test/api/app/conflicts?decision=keep_both&repo=team/conflicts&search=API",
        ),
      );
      expect(response.status).toBe(200);
      expect(
        (await response.json()).decisions.map(
          (value: { id: string }) => value.id,
        ),
      ).toEqual([record.id]);
      expect(
        (
          await POST(
            new Request("https://hive.test/api/app/conflicts", {
              method: "POST",
              body: JSON.stringify({ id: record.id, action: "confirm" }),
            }),
          )
        ).status,
      ).toBe(400);
      auth.ctx = b;
      expect(
        (
          await (
            await GET(new Request("https://hive.test/api/app/conflicts"))
          ).json()
        ).decisions,
      ).toEqual([]);
      auth.ctx = null;
      expect(
        (await GET(new Request("https://hive.test/api/app/conflicts"))).status,
      ).toBe(401);
    });
  },
);
