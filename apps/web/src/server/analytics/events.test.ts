import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessEvent,
  analyticsTransaction,
  eventRow,
  originFor,
  recordEvent,
  recordMutation,
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("analytics envelope", () => {
  it("keeps key creation and revocation distinct while deduplicating each outcome", async () => {
    const rows: EventRow[] = [];
    await withOrigin(originFor(ctx), async () => {
      await accessEvent(ctx, "key_created", {}, "key_aaaaaaaaaaaa");
      await accessEvent(ctx, "key_revoked", {}, "key_aaaaaaaaaaaa");
      await accessEvent(ctx, "key_revoked", {}, "key_aaaaaaaaaaaa");
    }, async (row) => { rows.push(row); });
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
    expect(rows.map((row) => row.event_name)).toEqual([
      "operation.started",
      "operation.finished",
    ]);
    expect(rows[1].outcome).toBe("failed");
    expect(rows[0].properties.operationId).toBe(rows[1].properties.operationId);
    expect(JSON.stringify(rows)).not.toContain("private");
  });
});
