import {originFor, withOrigin} from "./analytics/events";
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
import {frictionSummary} from "./friction";
import { createTeam } from "./auth";
import { getSql } from "./db/client";
import { newId } from "./db/ids";
import {
  pushLearning as pushOrganisationFixture,
  getLearning,
  searchLearnings,
  recentLearnings,
} from "./hive";
import { correctLearning, learningVersions } from "./lifecycle";
import { reportOutcome, recordFeedback, feedbackHistory } from "./feedback";
import {
  createCaptureRule,
  deleteCaptureRule,
  scanInstructionCells,
  applyInstructionCells,
} from "./capture-rules";
import { deriveCaptureDetails } from "./llm/capture";
import { classifyPush } from "./classify";
import { classifyOutcome } from "./outcome-judgments";

vi.mock("./llm/embeddings", () => ({ embedText: vi.fn(async () => null) }));
vi.mock("./llm/capture", async (original) => ({
  ...(await original<typeof import("./llm/capture")>()),
  deriveCaptureDetails: vi.fn(),
}));
vi.mock("./classify", async (original) => ({
  ...(await original<typeof import("./classify")>()),
  classifyPush: vi.fn(),
}));
vi.mock("./outcome-judgments", () => ({ classifyOutcome: vi.fn() }));
vi.mock("./memory-judgments", () => ({
  judgeMemory: vi.fn(async () => ({ relations: [], tags: [] })),
  rerankMemory: async (_: string, hits: unknown[]) => hits,
}));

describe.skipIf(!process.env.DATABASE_URL)(
  "capture and outcome contract",
  () => {
    let a: HiveContext, b: HiveContext, teammate: HiveContext;
    const push = async (
      ctx: HiveContext,
      input: Parameters<typeof hivePushInput.parse>[0],
    ) => {
      const result = await pushLearning(ctx, hivePushInput.parse(input));
      if (result.dropped) throw new Error("Unexpected excluded fixture");
      return result;
    };
    beforeAll(async () => {
      a = (
        await createTeam({
          teamName: "Capture contract A",
          memberName: "Alice",
        })
      ).ctx;
      b = (
        await createTeam({ teamName: "Capture contract B", memberName: "Bob" })
      ).ctx;
      teammate = { ...a, memberId: newId("mem"), memberName: "Colleague" };
      await getSql()`INSERT INTO members (id, name) VALUES (${teammate.memberId}, ${teammate.memberName})`;
      await getSql()`INSERT INTO hive_memberships (member_id,team_id) VALUES (${teammate.memberId},${a.teamId})`;
    });
    beforeEach(() => {
      vi.mocked(classifyPush)
        .mockReset()
        .mockResolvedValue({
          classification: null,
          decision: {
            action: "accept",
            kind: "friction",
            tags: ["tooling"],
            worthSharing: true,
            severity: null,
          },
        });
      vi.mocked(deriveCaptureDetails)
        .mockReset()
        .mockResolvedValue({
          title: "Regenerate the client after a schema change",
          blocked: null,
          workaround: null,
          cost: null,
        });
      vi.mocked(classifyOutcome)
        .mockReset()
        .mockResolvedValue({
          classification: "useful",
          judgment: { model: "fixture" },
        });
    });
    afterAll(async () => {
      const sql = getSql();
      const ids = [a.teamId, b.teamId];
      for (const table of [
        "feedback",
        "capture_rule_applications",
        "capture_rule_instructions",
        "capture_rules",
        "learning_pushes",
        "ask_log",
        "learnings",
        "api_keys",
        "web_sessions",
        "members",
        "teams",
      ])
        if (table === "members") await sql`DELETE FROM members WHERE id IN (SELECT member_id FROM hive_memberships WHERE team_id = ANY(${ids}::text[]))`;
        else await sql`DELETE FROM ${sql(table)} WHERE ${sql(table === "teams" ? "id" : "team_id")} = ANY(${ids}::text[])`;
      await sql.end();
    });
    it("derives equivalent metadata from observation, evidence and runtime context", async () => {
      const observation =
        "The generated client becomes stale after schema changes, so typecheck fails until it is regenerated.";
      const minimal = await push(a, {
        observation,
        evidence: { command_output: "pnpm typecheck passed after generation" },
        context: {
          remote: "git@github.com:Team/Widget.git",
          agent: "codex",
          sessionRef: "contract-equivalent",
          paths: ["schema.ts"],
          branch: "feature/client",
        },
      });
      expect(minimal.learning).toMatchObject({
        title: "Regenerate the client after a schema change",
        body: observation,
        kind: "friction",
        tags: ["tooling"],
        area: "tool",
        source: "codex",
        repo: "team/widget",
        sessionRef: "contract-equivalent",
        paths: ["schema.ts"],
        blocked: null,
        cost: null,
      });
      const explicit = await push(a, {
        title: minimal.learning.title,
        body: observation,
        kind: "friction",
        tags: ["tooling"],
        area: "tool",
        source: "codex",
        repo: "team/widget",
        paths: ["schema.ts"],
        blocked: null,
        cost: null,
      });
      expect(explicit.id).toBe(minimal.id);
      expect(explicit.learning).toMatchObject({
        kind: minimal.learning.kind,
        tags: minimal.learning.tags,
        area: minimal.learning.area,
        blocked: null,
        cost: null,
      });
      expect(minimal.inferred).toMatchObject({
        title: minimal.learning.title,
        repo: "team/widget",
        context: { branch: "feature/client" },
      });
      expect(minimal.correction).toEqual({
        tool: "hive_correct",
        id: minimal.id,
        revision: minimal.learning.revision,
      });
    });
    it("keeps overrides and measured friction, and makes concurrent session retries idempotent", async () => {
      vi.mocked(deriveCaptureDetails).mockResolvedValue({
        title: "Model title",
        blocked: true,
        workaround: "Model workaround",
        cost: 99,
      });
      const input = {
        observation: "A specific measured retry fixture",
        title: "Explicit title",
        body: "Explicit body",
        kind: "friction",
        tags: ["explicit"],
        area: "environment",
        blocked: false,
        cost: 12,
        workaround: "Explicit workaround",
        confidence: 0.95,
        source: "manual",
        repo: "explicit/repo",
        paths: ["explicit.ts"],
        verify_after: "2027-01-01T00:00:00Z",
        context: {
          repo: "wrong/repo",
          paths: ["wrong.ts"],
          agent: "codex",
          sessionRef: "retry-fixture",
        },
      };
      const results = await Promise.all([
        push(a, input),
        push(a, input),
        push(a, input),
      ]);
      expect(new Set(results.map((result) => result.id)).size).toBe(1);
      const learning = await getLearning(a, results[0].id);
      expect(learning).toMatchObject({
        title: "Explicit title",
        body: "Explicit body",
        tags: ["explicit"],
        area: "environment",
        blocked: false,
        cost: 12,
        workaround: "Explicit workaround",
        confidence: 0.95,
        source: "manual",
        repo: "explicit/repo",
        paths: ["explicit.ts"],
        pushCount: 1,
        lifecycle: "fresh",
        verifyAfter: "2027-01-01T00:00:00.000Z",
      });
      expect(
        await getSql()`SELECT id FROM learning_pushes WHERE learning_id = ${results[0].id} AND team_id = ${a.teamId}`,
      ).toHaveLength(1);
    });
    it("drops context or evidence matches before either classifier or title model", async () => {
      const rule = await createCaptureRule(a, {
        name: "Drop private marker",
        kind: "keyword",
        pattern: "private-marker",
        regex: false,
        caseSensitive: false,
        source: "web",
        scope: "member",
        action: "drop",
        enabled: true,
      });
      for (const extra of [
        { evidence: { diff: "private-marker" } },
        { context: { branch: "private-marker" } },
      ]) {
        expect(
          await pushLearning(
            a,
            hivePushInput.parse({
              observation: "Safe observed fact",
              ...extra,
            }),
          ),
        ).toMatchObject({ dropped: true });
        expect(classifyPush).not.toHaveBeenCalled();
        expect(deriveCaptureDetails).not.toHaveBeenCalled();
      }
      await deleteCaptureRule(a, rule.id);
    });
    it("redacts evidence and context before inference and evidence storage", async () => {
      const rule = await createCaptureRule(a, {
        name: "Redact private marker",
        kind: "keyword",
        pattern: "private-marker",
        regex: false,
        caseSensitive: false,
        source: "web",
        scope: "member",
        action: "redact",
        enabled: true,
      });
      const cell = await push(a, {
        observation: "Safe observed redaction fixture",
        evidence: { diff: "private-marker" },
        context: { repo: "team/widget", sessionRef: "private-marker" },
      });
      expect(classifyPush).toHaveBeenCalledWith(
        expect.objectContaining({ evidence: "", repo: null }),
      );
      expect(deriveCaptureDetails).toHaveBeenCalledWith(
        "Safe observed redaction fixture",
        "",
      );
      const stored =
        await getSql()`SELECT payload FROM learning_evidence WHERE learning_id = ${cell.id} AND team_id = ${a.teamId}`;
      expect(JSON.stringify(stored)).not.toContain("private-marker");
      expect(cell.learning).toMatchObject({
        repo: null,
        sessionRef: null,
        captureRedacted: true,
      });
      await deleteCaptureRule(a, rule.id);
    });
    it("creates audited corrections and rejects stale, unauthorised or cross-team handles", async () => {
      const cell = await push(a, {
        observation: "Correction fixture observation",
        context: { repo: "team/correction" },
      });
      const handle = {
        id: cell.id,
        revision: cell.learning.revision!,
        observation: "The corrected fixture observation",
        evidence: "Verified by pnpm typecheck",
      };
      await expect(correctLearning(b, handle)).rejects.toMatchObject({
        status: 404,
      });
      await expect(correctLearning(teammate, handle)).rejects.toMatchObject({
        status: 403,
      });
      const countBefore = (await frictionSummary(a, "team/correction")).count;
    const corrected = await correctLearning(a, handle);
    expect((await frictionSummary(a, "team/correction")).count).toBe(countBefore);
    expect(await getLearning(a, cell.id)).toMatchObject({blocked: null, cost: null, tags: ["tooling"]});
      expect(corrected.revision).toBeGreaterThan(handle.revision);
      await expect(correctLearning(a, handle)).rejects.toMatchObject({
        status: 409,
      });
      expect((await learningVersions(a, cell.id))[0].content.body).toBe(
        handle.observation,
      );
      await correctLearning(a, {
        id: cell.id,
        revision: corrected.revision,
        retract: true,
      });
      expect((await getLearning(a, cell.id))?.lifecycle).toBe("retracted");
    });
    it("retrieves without voting and replaces one actor's feedback across agents", async () => {
      const cell = await push(a, {
        observation: "Retrieval outcome fixture",
        context: { repo: "team/outcome" },
      });
      await getLearning(a, cell.id);
      await searchLearnings(
        a,
        { query: "Retrieval outcome fixture", limit: 8 },
        { cellsOnly: true },
      );
      await recentLearnings(a, { since: "24h", limit: 20 });
      expect(await feedbackHistory(a, cell.id)).toEqual([]);
      expect((await getLearning(a, cell.id))?.votes).toEqual({
        up: 0,
        down: 0,
        outdated: 0,
      });
      const first = await reportOutcome(a, {
        id: cell.id,
        outcome: "Regenerating the client fixed pnpm typecheck",
        evidence: "pnpm typecheck passed",
      });
      const second = await reportOutcome(
        { ...a },
        {
          id: cell.id,
          outcome: "The second agent verified pnpm typecheck passed",
          evidence: "pnpm typecheck passed",
        },
      );
      expect(second.votes.up).toBe(1);
      expect((await getLearning(a, cell.id))?.lifecycle).toBe("confirmed");
      await expect(
        recordFeedback(a, {
          id: cell.id,
          withdraw: true,
          receipt: first.receipt,
        }),
      ).rejects.toMatchObject({ status: 409 });
      const withdrawn = await recordFeedback(a, {
        id: cell.id,
        withdraw: true,
        receipt: second.receipt,
      });
      expect(withdrawn.votes.up).toBe(1);
      const originalWithdrawn = await recordFeedback(a, {
        id: cell.id,
        withdraw: true,
        receipt: first.receipt,
      });
      expect(originalWithdrawn.votes.up).toBe(0);
      expect((await getLearning(a, cell.id))?.lifecycle).toBe("fresh");
      await expect(
        recordFeedback(a, {
          id: cell.id,
          withdraw: true,
          receipt: first.receipt,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("distinguishes contradiction from stale, restores standing, and retains outcome history", async () => {
      const cell = await push(a, {
        observation: "Lifecycle outcome fixture",
        context: { repo: "team/feedback" },
      });
      vi.mocked(classifyOutcome).mockResolvedValueOnce({
        classification: "contradicted",
        judgment: { model: "fixture" },
      });
      const wrong = await reportOutcome(a, {
        id: cell.id,
        outcome: "The same failing build remains after using this advice",
        evidence: "pnpm build exited 1 with the same error",
      });
      expect(wrong).toMatchObject({
        classification: "contradicted",
        vote: "down",
        votes: { down: 1, outdated: 0 },
      });
      expect((await getLearning(a, cell.id))?.lifecycle).toBe("fresh");
      vi.mocked(classifyOutcome).mockResolvedValueOnce({
        classification: "stale",
        judgment: { model: "fixture" },
      });
      const stale = await reportOutcome(a, {
        id: cell.id,
        outcome: "The option was removed in Node 24",
        evidence: "Node 24: bad option --old-flag",
      });
      expect(stale).toMatchObject({
        classification: "stale",
        vote: "outdated",
        votes: { down: 0, outdated: 1 },
      });
      expect((await getLearning(a, cell.id))?.lifecycle).toBe("outdated");
      await recordFeedback(a, {
        id: cell.id,
        withdraw: true,
        receipt: stale.receipt,
      });
      expect((await getLearning(a, cell.id))?.votes).toEqual({
        up: 0,
        down: 1,
        outdated: 0,
      });
      expect((await getLearning(a, cell.id))?.lifecycle).toBe("fresh");
      expect(await feedbackHistory(a, cell.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            outcome: "The option was removed in Node 24",
            evidence: "Node 24: bad option --old-flag",
          }),
        ]),
      );
    });
    it("keeps inconclusive, private and redacted outcomes from changing standing", async () => {
      const cell = await push(a, {
        observation: "Inconclusive outcome fixture",
        context: { repo: "team/inconclusive" },
      });
      await recordFeedback(a, { id: cell.id, vote: "up" });
      vi.mocked(classifyOutcome).mockResolvedValueOnce({
        classification: "inconclusive",
        judgment: { model: "fixture" },
      });
      const result = await reportOutcome(a, {
        id: cell.id,
        outcome: "I retrieved this cell but have not tried it",
      });
      expect(result).toMatchObject({
        classification: "inconclusive",
        votes: { up: 1 },
      });
      const rule = await createCaptureRule(a, {
        name: "Private outcome",
        kind: "keyword",
        pattern: "private-outcome",
        regex: false,
        caseSensitive: false,
        source: "web",
        scope: "member",
        action: "flag",
        enabled: true,
      });
      const privateResult = await reportOutcome(a, {
        id: cell.id,
        outcome: "private-outcome build passed",
        evidence: "pnpm build passed",
      });
      expect(privateResult).toMatchObject({
        classification: "inconclusive",
        votes: { up: 1 },
      });
      expect(
        (await feedbackHistory(teammate, cell.id)).some((entry) =>
          entry.outcome?.includes("private-outcome"),
        ),
      ).toBe(false);
      await deleteCaptureRule(a, rule.id);
      const redact = await createCaptureRule(a, {
        name: "Redact outcome",
        kind: "keyword",
        pattern: "private-outcome",
        regex: false,
        caseSensitive: false,
        source: "web",
        scope: "member",
        action: "redact",
        enabled: true,
      });
      const instructionId = newId("cinstr");
      await getSql()`INSERT INTO capture_rule_instructions (id, team_id, member_id, source, decision, outcome, rule_id, rule_revision, rule_snapshot, restatement, natural_text, job_status, undo_until) VALUES (${instructionId}, ${a.teamId}, ${a.memberId}, 'web', '{}', 'saved', ${redact.id}, 1, ${getSql().json(redact)}, 'Remove private outcome content.', 'Remove private-outcome from existing cells.', 'pending', now() + interval '1 hour')`;
      const batch = await scanInstructionCells(a, redact.id, instructionId);
      await applyInstructionCells(a, redact.id, batch, instructionId);
      expect(JSON.stringify(await feedbackHistory(a, cell.id))).not.toContain(
        "private-outcome",
      );
      await deleteCaptureRule(a, redact.id);
    });
    it("denies other teams before models, receipts and history", async () => {
      const cell = await push(a, {
        observation: "Cross team outcome fixture",
        context: { repo: "team/scope" },
      });
      await expect(
        reportOutcome(b, { id: cell.id, outcome: "pnpm build passed" }),
      ).rejects.toMatchObject({ status: 404 });
      expect(classifyOutcome).not.toHaveBeenCalled();
      const feedback = await reportOutcome(a, {
        id: cell.id,
        outcome: "pnpm build passed",
      });
      await expect(
        recordFeedback(b, {
          id: cell.id,
          withdraw: true,
          receipt: feedback.receipt,
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        recordFeedback(teammate, {
          id: cell.id,
          withdraw: true,
          receipt: feedback.receipt,
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(feedbackHistory(b, cell.id)).rejects.toMatchObject({
        status: 404,
      });
    });
  },
);

async function pushLearning(ctx: HiveContext, input: Parameters<typeof pushOrganisationFixture>[1]) {
  return withOrigin(originFor(ctx, "slack"), () => pushOrganisationFixture(ctx, input));
}
