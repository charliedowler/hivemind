import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/slack/commands/route";
const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("@/server/db/client", () => ({
  getSql: () => async () => [{ team_id: "team_fixture" }],
}));
vi.mock("@/server/slack/queue", () => ({ enqueueSlack: enqueue }));
vi.mock("@/lib/http", () => ({
  httpError: () => new Response(null, { status: 500 }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("returns one ephemeral looking acknowledgement for repeated slash delivery", async () => {
  vi.stubEnv("SLACK_SIGNING_SECRET", "synthetic");
  const body = new URLSearchParams({
    team_id: "T123",
    user_id: "U123",
    channel_id: "C123",
    command: "/hive",
    text: "ask Does Hive index direct messages?",
  }).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const signature =
    "v0=" +
    createHmac("sha256", "synthetic").update(`v0:${ts}:${body}`).digest("hex");
  const request = () =>
    new Request("https://gohive.dev/api/slack/commands", {
      method: "POST",
      body,
      headers: {
        "x-slack-request-timestamp": ts,
        "x-slack-signature": signature,
      },
    });
  enqueue
    .mockResolvedValueOnce({ fresh: true })
    .mockResolvedValueOnce({ fresh: false });
  const first = await POST(request());
  expect(await first.json()).toEqual({
    response_type: "ephemeral",
    text: "The hive is looking.",
  });
  const duplicate = await POST(request());
  expect(duplicate.status).toBe(200);
  expect(await duplicate.text()).toBe("");
});
