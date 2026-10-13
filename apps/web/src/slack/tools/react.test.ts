import { beforeEach, it, expect, vi } from "vitest";
import { HiveError } from "@/server/errors";
import { reactToSlack } from "./react";
const { call, event, install } = vi.hoisted(() => ({
  call: vi.fn(),
  event: vi.fn(),
  install: vi.fn(),
}));
vi.mock("@/server/slack/install", () => ({ installation: install }));
vi.mock("@/server/slack/client", () => ({ slackCall: call }));
vi.mock("@/server/analytics/events", () => ({ recordEvent: event }));
const ctx = {
  teamId: "team_fixture",
  channelId: "C123",
  messageTs: "1800000000.1",
};
beforeEach(() => {
  vi.clearAllMocks();
  install.mockResolvedValue({ token: "synthetic" });
  call.mockResolvedValue({ ok: true });
  event.mockResolvedValue(undefined);
});
it("uses the team's bot and logs metadata without message text", async () => {
  await reactToSlack(ctx, "white_check_mark");
  expect(install).toHaveBeenCalledWith(ctx.teamId);
  expect(call).toHaveBeenCalledWith("synthetic", "reactions.add", {
    channel: ctx.channelId,
    timestamp: ctx.messageTs,
    name: "white_check_mark",
  });
  expect(event.mock.calls[0][0]).toMatchObject({
    name: "slack.reaction_added",
    properties: { channelId: ctx.channelId, gateDecision: "react_only" },
  });
  expect(event.mock.calls[0][0]).not.toHaveProperty("messageText");
});
it("treats already_reacted as an idempotent success with the same analytics key", async () => {
  call.mockRejectedValue(
    new HiveError(
      "Slack could not complete reactions.add: already_reacted.",
      502,
    ),
  );
  await expect(reactToSlack(ctx, "+1")).resolves.toBeUndefined();
  expect(event).toHaveBeenCalledTimes(1);
});
it("propagates failures and never claims a reaction happened", async () => {
  call.mockRejectedValue(
    new HiveError(
      "Slack could not complete reactions.add: not_in_channel.",
      502,
    ),
  );
  await expect(reactToSlack(ctx, "eyes")).rejects.toThrow("not_in_channel");
  expect(event).not.toHaveBeenCalled();
});
