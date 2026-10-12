import { beforeEach, describe, expect, it, vi } from "vitest";
import { retryPendingSlack, runBackfill } from "./queue";
const { send, query, admin, permission, page } = vi.hoisted(() => ({
  send: vi.fn(),
  query: vi.fn(),
  admin: vi.fn(),
  permission: vi.fn(),
  page: vi.fn(),
}));
vi.mock("@vercel/queue", () => ({ send }));
vi.mock("../db/client", () => ({
  getSql: () => Object.assign(query, { json: (value: unknown) => value }),
}));
vi.mock("../identity/access", () => ({ requireAdmin: admin }));
vi.mock("./store", () => ({
  channelPermission: permission,
  storeMessage: vi.fn(),
}));
vi.mock("./install", () => ({
  validateChannel: async () => ({ inst: { token: "synthetic" } }),
}));
vi.mock("./client", () => ({ messagePage: page }));
const ctx = {
  teamId: "team_fixture",
  memberId: "member_fixture",
  teamName: "Fixture",
  memberName: "Fixture",
};
beforeEach(() => {
  vi.clearAllMocks();
  admin.mockResolvedValue(undefined);
  send.mockResolvedValue(undefined);
});
describe("Slack job recovery", () => {
  it("checks admin permission before reading or publishing jobs", async () => {
    admin.mockRejectedValue(new Error("Only a team admin"));
    await expect(retryPendingSlack(ctx)).rejects.toThrow("team admin");
    expect(query).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("publishes only scoped references and observes a publish failure", async () => {
    query.mockResolvedValue([
      { id: "job1", dedupe_key: "event1" },
      { id: "job2", dedupe_key: "event2" },
    ]);
    expect(await retryPendingSlack(ctx)).toBe(2);
    expect(query.mock.calls[0][1]).toBe(ctx.teamId);
    expect(send.mock.calls[0][1]).toEqual({
      teamId: ctx.teamId,
      jobId: "job1",
    });
    send.mockRejectedValue(new Error("publisher unavailable"));
    await expect(retryPendingSlack(ctx)).rejects.toThrow(
      "publisher unavailable",
    );
  });
  it("does not reuse a history cursor when beginning a thread", async () => {
    permission.mockResolvedValue({
      generation: 1,
      backfill_done: false,
      backfill_threads: [{ ts: "1800000000.001" }],
      backfill_cursor: "history-page",
      backfill_history_done: true,
    });
    page.mockResolvedValue({ messages: [], cursor: null });
    query.mockResolvedValue([{ backfill_done: true }]);
    await runBackfill(ctx.teamId, "C123", 1);
    expect(page).toHaveBeenCalledWith(
      "synthetic",
      "C123",
      "1800000000.001",
      undefined,
    );
  });
});
