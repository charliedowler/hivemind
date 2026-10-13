import { afterEach, describe, expect, it, vi } from "vitest";
import { respondToSlack } from "./respond";
import { dispatchSlackAction, slackTools } from "./tools";
const { create, latest } = vi.hoisted(() => ({ create: vi.fn(), latest: vi.fn(async () => null) }));
vi.mock("./tools/undo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tools/undo")>()),
  latestThreadAction: latest,
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function () {
    return { messages: { create } };
  }),
}));
vi.mock("@/server/digests/connection", () => ({
  slackMemberTimezone: async () => "Europe/London",
}));
const ctx = {
  teamId: "team_test",
  memberId: "member_test",
  isAdmin: false,
  channelId: "C123",
  threadTs: "1800000000.001",
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  create.mockReset();
});
describe("Slack tool routing", () => {
  it("makes one routing call and posts the tool result, including blocks", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic");
    const tool = slackTools.find((tool) => tool.name === "hive_recent")!;
    const handler = vi.spyOn(tool, "handler").mockResolvedValue({
      text: "Tool result",
      blocks: [
        { type: "section", text: { type: "plain_text", text: "Confirmed" } },
      ],
    });
    create.mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "hive_recent", input: {} }],
    });
    expect(
      (await respondToSlack(ctx, "Show recent cells", ctx.threadTs, [])).text,
    ).toBe("Tool result");
    expect(create).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      {
        ...ctx,
        messageTs: ctx.threadTs,
        timeZone: "Europe/London",
        instructionText: "Show recent cells",
        requestText: "Show recent cells",
        history: [],
      },
      {},
    );
    expect(create.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
  });
  it("does not execute ambiguous parallel mutations", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic");
    const handler = vi.spyOn(slackTools[0], "handler");
    create.mockResolvedValue({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", name: "hive_ask", input: {} },
        { type: "tool_use", name: "hive_save", input: {} },
      ],
    });
    await respondToSlack(ctx, "Do two things", ctx.threadTs, []);
    expect(handler).not.toHaveBeenCalled();
  });
  it("refuses to save a DM without asking Slack for extra scopes", async () => {
    const tool = slackTools.find((tool) => tool.name === "hive_save")!;
    expect(
      (
        await tool.handler(
          { ...ctx, channelId: "D123" },
          { messageTs: "1800000000.001", wholeThread: false },
        )
      ).text,
    ).toContain("never saves direct messages");
  });
  it("routes a confirmation to the named tool with the clicking member context", async () => {
    const handleAction = vi.fn().mockResolvedValue({ text: "Done" });
    slackTools.push({
      name: "fixture_tool",
      description: "Fixture",
      input_schema: { type: "object" },
      handler: vi.fn(),
      handleAction,
    });
    try {
      expect(
        await dispatchSlackAction(
          ctx,
          "tool:fixture_tool:confirm",
          "opaque-reference",
        ),
      ).toEqual({ text: "Done" });
      expect(handleAction).toHaveBeenCalledWith(
        ctx,
        "confirm",
        "opaque-reference",
      );
    } finally {
      slackTools.pop();
    }
    await expect(
      dispatchSlackAction(ctx, "tool:hive_save:confirm", "forged"),
    ).rejects.toThrow("unavailable");
  });
});

it("dispatches explicit undo even when the model selects another mutation", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic");
  const undo = slackTools.find((tool) => tool.name === "undo_last_action")!;
  const schedule = slackTools.find((tool) => tool.name === "hive_schedule_digest")!;
  const handler = vi.spyOn(undo, "handler").mockResolvedValue({ react: "white_check_mark" });
  const mutation = vi.spyOn(schedule, "handler");
  create.mockResolvedValue({
    stop_reason: "tool_use",
    content: [{ type: "tool_use", name: "hive_schedule_digest", input: { text: "set Mondays" } }],
  });
  expect(await respondToSlack(ctx, "undo", "1800000000.002", [])).toEqual({
    text: "",
    react: "white_check_mark",
  });
  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ instructionText: "undo" }), {});
  expect(mutation).not.toHaveBeenCalled();
});
