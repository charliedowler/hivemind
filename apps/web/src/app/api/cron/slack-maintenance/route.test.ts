import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  sync: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ getSql: () => mocks.query }));
vi.mock("@/server/slack/install", () => ({ syncChannels: mocks.sync }));
vi.mock("@/server/slack/queue", () => ({ retryPendingSlack: mocks.retry }));
vi.mock("@/server/digests/runner", () => ({ tickDigests: vi.fn() }));
vi.mock("@/server/digests/connection", () => ({ digestTransport: {} }));
import { GET } from "./route";
const team = {
  team_id: "team_a",
  team_name: "Team A",
  member_id: "admin_a",
  member_name: "Admin A",
};
const request = (authorization = "Bearer cron-fixture") =>
  new Request("http://localhost/api/cron/slack-maintenance", {
    headers: { authorization },
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-fixture");
  mocks.query.mockResolvedValue([team]);
  mocks.sync.mockResolvedValue(undefined);
  mocks.retry.mockResolvedValue(2);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each(["", "Bearer wrong", "cron-fixture"])(
  "rejects an unauthorised cron before reading teams (%s)",
  async (auth) => {
    expect((await GET(request(auth))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.retry).not.toHaveBeenCalled();
  },
);
it("refuses a request without a configured secret", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await GET(request())).status).toBe(401);
  expect(mocks.query).not.toHaveBeenCalled();
});
it("runs every 15 minutes and refreshes and retries with a current admin", async () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../../../../../vercel.json", import.meta.url),
      "utf8",
    ),
  );
  expect(config.crons).toContainEqual({
    path: "/api/cron/slack-maintenance",
    schedule: "*/15 * * * *",
  });
  const response = await GET(request());
  expect(mocks.sync).toHaveBeenCalledExactlyOnceWith({
    teamId: "team_a",
    teamName: "Team A",
    memberId: "admin_a",
    memberName: "Admin A",
  });
  expect(mocks.retry).toHaveBeenCalledWith(mocks.sync.mock.calls[0][0]);
  expect(await response.json()).toEqual({
    results: [
      {
        teamId: "team_a",
        channels: "fulfilled",
        pending: "fulfilled",
        retried: 2,
      },
    ],
    remaining: 0,
  });
});
it("isolates failures so a channel error does not block retries or another team", async () => {
  mocks.query.mockResolvedValue([team, { ...team, team_id: "team_b" }]);
  mocks.sync.mockRejectedValueOnce(new Error("private diagnostic"));
  mocks.retry.mockRejectedValueOnce(new Error("private diagnostic"));
  const response = await GET(request());
  const data = await response.json();
  expect(mocks.sync).toHaveBeenCalledTimes(2);
  expect(mocks.retry).toHaveBeenCalledTimes(2);
  expect(data.results.map((r: { pending: string }) => r.pending)).toEqual([
    "rejected",
    "fulfilled",
  ]);
  expect(JSON.stringify(data)).not.toContain("private diagnostic");
});
it("reports work left when the invocation budget expires", async () => {
  vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(231_000);
  const response = await GET(request());
  expect(await response.json()).toEqual({ results: [], remaining: 1 });
  expect(mocks.sync).not.toHaveBeenCalled();
});
