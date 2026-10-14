import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessEvent,
  analyticsTransaction,
  beginCall,
  eventRow,
  originFor,
  propertiesSchema,
  recordEvent,
  recordMutation,
  STARTED_AFTER_MS,
  withOperation,
  withOrigin,
  type EventRow,
} from "./events";

const ctx = {
  teamId: "team_aaaaaaaaaaaa",
  memberId: "mem_aaaaaaaaaaaa",
  teamName: "Fixture",
  memberName: "Fixture",
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("analytics envelope", () => {
  it("keeps key creation and revocation distinct while deduplicating each outcome", async () => {
    const rows: EventRow[] = [];
    await withOrigin(
      originFor(ctx),
      async () => {
        await accessEvent(ctx, "key_created", {}, "key_aaaaaaaaaaaa");
        await accessEvent(ctx, "key_revoked", {}, "key_aaaaaaaaaaaa");
        await accessEvent(ctx, "key_revoked", {}, "key_aaaaaaaaaaaa");
      },
      async (row) => {
        rows.push(row);
      },
    );
    expect(rows[0].event_key).not.toBe(rows[1].event_key);
    expect(rows[1].event_key).toBe(rows[2].event_key);
  });
  it("hashes operation identity and fills every unknown property with null", () => {
    const input = {
      name: "search.performed" as const,
      key: "query text never stored",
      properties: { resultCount: 2, query: "private" },
    };
    const row = eventRow(input);
    expect(row.event_key).toMatch(/^[a-f0-9]{64}$/);
    expect(row.event_key).toBe(eventRow(input).event_key);
    expect(row.learning_id).toBeNull();
    expect(row.properties.model).toBeNull();
    expect(row.properties.resultCount).toBe(2);
    expect(JSON.stringify(row)).not.toContain("private");
    expect(JSON.stringify(row)).not.toContain("query text");
    expect(Object.values(row.properties)).not.toContain(undefined);
  });
  it("does not accept arbitrary strings in allowlisted values or reason codes", () => {
    expect(() =>
      eventRow({
        name: "ask.performed",
        properties: { model: "secret" as never },
      }),
    ).toThrow();
    expect(() =>
      eventRow({ name: "ask.performed", reasonCode: "customer text" as never }),
    ).toThrow();
    expect(() =>
      eventRow({ name: "search.performed", properties: { resultCount: -1 } }),
    ).toThrow();
  });
  it("keeps unknown traffic distinct from real and synthetic in every environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("HIVE_ANALYTICS_TRAFFIC", "");
    expect(originFor(ctx)).toMatchObject({
      isTest: null,
      testBasis: "unclassified",
      environment: "production",
    });
    vi.stubEnv("HIVE_ANALYTICS_TRAFFIC", "real");
    expect(originFor(ctx).isTest).toBe(false);
    vi.stubEnv("HIVE_ANALYTICS_TRAFFIC", "synthetic");
    expect(originFor(ctx).isTest).toBe(true);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("HIVE_ANALYTICS_TRAFFIC", "real");
    expect(originFor(ctx)).toMatchObject({
      isTest: true,
      testBasis: "unit_test",
    });
  });
  it("keeps concurrent request and team envelopes separate", async () => {
    const rows: EventRow[] = [];
    const writer = async (row: EventRow) => {
      rows.push(row);
    };
    await Promise.all(
      ["a", "b"].map((id) =>
        withOrigin(
          { ...originFor(ctx, "mcp"), teamId: id, requestId: id },
          async () => {
            await new Promise((resolve) =>
              setTimeout(resolve, id === "a" ? 10 : 1),
            );
            await recordEvent({ name: "recent.performed" });
          },
          writer,
        ),
      ),
    );
    expect(rows.map((row) => [row.team_id, row.request_id])).toEqual([
      ["b", "b"],
      ["a", "a"],
    ]);
  });
  it("flushes mutation events only after commit and drops rolled-back events", async () => {
    const rows: EventRow[] = [];
    await withOrigin(
      originFor(ctx),
      async () => {
        await expect(
          analyticsTransaction(async () => {
            await recordMutation({ name: "learning.superseded" });
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");
        expect(rows).toEqual([]);
        await analyticsTransaction(async () => {
          await recordMutation({ name: "learning.superseded" });
          expect(rows).toEqual([]);
        });
        expect(rows).toHaveLength(1);
      },
      async (row) => {
        rows.push(row);
      },
    );
  });
  it("bounds delivery, aborts a stalled writer and preserves the business result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let aborted = false;
    const start = performance.now();
    const result = await withOrigin(
      originFor(ctx),
      () => recordEvent({ name: "recent.performed" }).then(() => "accepted"),
      async (_, signal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          }),
        );
      },
    );
    expect(result).toBe("accepted");
    expect(aborted).toBe(true);
    expect(performance.now() - start).toBeLessThan(900);
  });
  it("records failed operations without recording input or exception text", async () => {
    const rows: EventRow[] = [];
    await withOrigin(
      originFor(ctx, "mcp"),
      async () => {
        await expect(
          withOperation(ctx, "ask", async () => {
            throw new Error("private question");
          }),
        ).rejects.toThrow("private question");
      },
      async (row) => {
        rows.push(row);
      },
    );
    expect(rows.map((row) => row.event_name)).toEqual(["operation.finished"]);
    expect(rows[0].outcome).toBe("failed");
    expect(rows[0].latency_ms).not.toBeNull();
    expect(JSON.stringify(rows)).not.toContain("private");
  });
  it("writes a start row only for calls still running after the stall threshold", async () => {
    vi.useFakeTimers();
    const rows: EventRow[] = [];
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const startedAt = Date.now();
    const done = withOrigin(
      originFor(ctx, "mcp"),
      async () => {
        await withOperation(ctx, "search", async () => "fast");
        const finish = await beginCall("model", "synthesis", "claude-sonnet-5-5");
        await finish();
        await withOperation(ctx, "ask", () => slow);
      },
      async (row) => {
        rows.push(row);
      },
    );
    await vi.advanceTimersByTimeAsync(STARTED_AFTER_MS - 1);
    expect(rows.map((row) => row.event_name)).toEqual(["operation.finished", "model.completed"]);
    await vi.advanceTimersByTimeAsync(1);
    release();
    await done;
    expect(rows.map((row) => [row.event_name, row.properties.operation])).toEqual([
      ["operation.finished", "search"],
      ["model.completed", null],
      ["operation.started", "ask"],
      ["operation.finished", "ask"],
    ]);
    expect(rows[2].occurred_at.getTime()).toBe(startedAt);
    expect(rows[2].request_id).toBe(rows[3].request_id);
    expect(rows[2].properties.operationId).toBe(rows[3].properties.operationId);
  });
});

it("keeps conflict analytics bounded and excludes reasons and bodies", () => {
  const properties = {
    decision: "supersede" as const,
    decisionConfidence: 0.9,
    model: "claude-sonnet-5-5" as const,
    body: "private body",
    reason: "private reason",
  };
  const row = eventRow({ name: "conflict.decided", latencyMs: 20, properties });
  expect(row.properties.decision).toBe("supersede");
  expect(row.properties.decisionConfidence).toBe(0.9);
  expect(JSON.stringify(row)).not.toContain("private");
  expect(() =>
    eventRow({
      name: "conflict.decided",
      properties: { decisionConfidence: 2 },
    }),
  ).toThrow();
});


describe("capture instruction analytics", () => {
  it("stores only typed decision facts and joins, with no instruction content", () => {
    const properties = {captureInstructionId: "cinstr_aaaaaaaaaaaa", ruleId: "crule_aaaaaaaaaaaa", instructionSource: "slack", instructionDecision: "save", instructionClear: true, instructionSpecific: true, instructionScopeAllowed: false, request: "private original", pattern: "private match", restatement: "private summary"} as const;
    const row = eventRow({name: "capture.rule_instruction_decided", key: "cinstr_aaaaaaaaaaaa", outcome: "completed", properties});
    expect(row.properties).toMatchObject({captureInstructionId: "cinstr_aaaaaaaaaaaa", ruleId: "crule_aaaaaaaaaaaa", instructionSource: "slack", instructionDecision: "save", instructionClear: true, instructionSpecific: true, instructionScopeAllowed: false});
    expect(JSON.stringify(row)).not.toMatch(/private|C_PRIVATE|123\.456/);
  });

  it("stores bounded undo counts without snapshots or titles", () => {
    const properties = {captureInstructionId: "cinstr_aaaaaaaaaaaa", ruleId: "crule_aaaaaaaaaaaa", instructionSource: "web", instructionDecision: "undo", scannedCount: 500, appliedCount: 2, restoredCount: 1, retainedCount: 1, pending: false, beforeSnapshot: "private", title: "private"} as const;
    const row = eventRow({name: "capture.rule_instruction_undone", key: "cinstr_aaaaaaaaaaaa", properties});
    expect(row.properties).toMatchObject({scannedCount: 500, appliedCount: 2, restoredCount: 1, retainedCount: 1, pending: false});
    expect(JSON.stringify(row)).not.toContain("private");
  });

  it.each([{captureInstructionId: "freeform private text"}, {instructionClear: "yes"}, {instructionSpecific: 0.9}, {instructionScopeAllowed: "admin"}, {instructionSource: "provider"}, {instructionDecision: "confirm"}, {restoredCount: -1}, {appliedCount: 1.5}])("rejects untyped instruction facts", properties => {
    expect(() => propertiesSchema.parse(properties)).toThrow();
  });
});
