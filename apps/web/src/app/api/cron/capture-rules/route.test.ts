import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runPending } = vi.hoisted(() => ({ runPending: vi.fn() }));
vi.mock("@/server/capture-rule-instructions", () => ({
  runPendingCaptureRuleInstructions: runPending,
}));
import { GET } from "./route";

describe("capture rule job recovery", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "capture-cron-fixture");
    runPending.mockReset().mockResolvedValue([]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "Bearer wrong", "capture-cron-fixture"])(
    "refuses an unauthorised request without starting jobs: %s",
    async (authorization) => {
      const response = await GET(new Request("https://example.test/api/cron/capture-rules", {
        headers: authorization ? { authorization } : {},
      }));
      expect(response.status).toBe(401);
      expect(runPending).not.toHaveBeenCalled();
    },
  );

  it("refuses requests when the cron credential is absent", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(new Request("https://example.test/api/cron/capture-rules"));
    expect(response.status).toBe(401);
    expect(runPending).not.toHaveBeenCalled();
  });

  it("resumes at most ten pending jobs with the cron credential", async () => {
    const counts = { instructions: 2, scanned: 8, matched: 3, applied: 2, skipped: 1, restored: 0, retained: 0, pending: 1, failed: 0 };
    runPending.mockResolvedValue(counts);
    const response = await GET(new Request("https://example.test/api/cron/capture-rules", {
      headers: { authorization: "Bearer capture-cron-fixture" },
    }));
    expect(response.status).toBe(200);
    expect(runPending).toHaveBeenCalledExactlyOnceWith(10);
    expect(await response.json()).toEqual({ results: counts });
  });
});
