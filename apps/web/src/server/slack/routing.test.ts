import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleMessage, handleCommand } from "./events";
const { query, post, root, respond, ask, page, judge } = vi.hoisted(() => ({
  query: vi.fn(),
  post: vi.fn(),
  root: vi.fn(),
  respond: vi.fn(),
  ask: vi.fn(),
  page: vi.fn(),
  judge: vi.fn(),
}));
vi.mock("../db/client", () => ({
  getSql: () =>
    Object.assign(query, {
      begin: async (action: (tx: unknown) => unknown) =>
        action(Object.assign(query, { json: (value: unknown) => value })),
      json: (value: unknown) => value,
    }),
}));
vi.mock("./install", () => ({
  installation: async () => ({ token: "synthetic", bot_user_id: "UHIVE" }),
  resolveActor: async () => ({
    teamId: "team_fixture",
    memberId: "member_fixture",
    memberName: "Fixture",
    teamName: "Fixture",
  }),
}));
vi.mock("./client", async (original) => ({
  ...(await original<typeof import("./client")>()),
  postMessage: post,
  messagePage: page,
  startSlackCommandThread: root,
  channelInfo: async () => ({
    id: "C123",
    is_member: true,
    is_private: false,
    is_im: false,
    is_mpim: false,
    is_archived: false,
  }),
}));
vi.mock("./store", () => ({
  storeMessage: async () => false,
  channelPermission: async () => null,
}));
vi.mock("@/slack/respond", () => ({ respondToSlack: respond }));
vi.mock("@/slack/tools", () => ({
  slackToolContext: async (
    actor: unknown,
    channelId: string,
    threadTs: string,
  ) => ({ channelId, threadTs }),
  dispatchSlackAction: vi.fn(),
}));
vi.mock("../hive", () => ({
  askHive: ask,
  pushLearning: vi.fn(),
  searchLearnings: async () => [],
  recentLearnings: async () => [],
}));
vi.mock("../analytics/events", () => ({
  originFor: () => ({}),
  withOrigin: async (_origin: unknown, action: () => unknown) => action(),
  recordEvent: async () => {},
}));
vi.mock("./gate", async (original) => ({
  ...(await original<typeof import("./gate")>()),
  judgeSlack: judge,
}));
beforeEach(() => {
  vi.clearAllMocks();
  page.mockResolvedValue({ messages: [], cursor: null, more: false });
  judge.mockResolvedValue({ signals: null, model: null, latencyMs: 0 });
  post.mockResolvedValue("1800000000.009");
  root.mockResolvedValue("1800000000.008");
  respond.mockResolvedValue({
    text: "No. Hive never indexes direct messages.",
  });
  ask.mockResolvedValue({
    answer: "No.",
    citations: [],
    confidence: "high",
    gaps: null,
    synthesized: true,
  });
  query.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    if (text.includes("INSERT INTO slack_jobs"))
      return [{ id: "job_fixture", payload: null }];
    if (text.includes("SELECT delivery")) return [{ delivery: "reserved" }];
    return [];
  });
});
describe("Slack reply placement", () => {
  it.each([
    {
      name: "top-level mention",
      event: {
        type: "app_mention",
        channel: "C123",
        user: "UCHARLIE",
        ts: "1800000000.001",
        text: "<@UHIVE> Does Hive index direct messages?",
      },
      parent: "1800000000.001",
    },
    {
      name: "thread follow-up",
      event: {
        type: "app_mention",
        channel: "C123",
        user: "UCHARLIE",
        ts: "1800000000.002",
        thread_ts: "1800000000.001",
        text: "<@UHIVE> What about channels?",
      },
      parent: "1800000000.001",
    },
    {
      name: "top-level DM",
      event: {
        type: "message",
        channel: "D123",
        channel_type: "im",
        user: "UCHARLIE",
        ts: "1800000000.003",
        text: "Does Hive index direct messages?",
      },
      parent: "1800000000.003",
    },
  ])(
    "replies only in the parent thread for a $name",
    async ({ event, parent }) => {
      await handleMessage("team_fixture", event);
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][3]).toBe(parent);
      expect(root).not.toHaveBeenCalled();
    },
  );
  it("reads human thread answers for the gate without indexing the context", async () => {
    page.mockResolvedValue({
      messages: [
        {
          ts: "1800000000.001",
          user: "UOTHER",
          text: "A human already answered this question.",
        },
      ],
      cursor: null,
      more: false,
    });
    await handleMessage("team_fixture", {
      type: "message",
      channel: "C123",
      user: "UCHARLIE",
      ts: "1800000000.002",
      thread_ts: "1800000000.001",
      text: "Does Hive index direct messages?",
    });
    expect(judge.mock.calls[0][3]).toEqual([
      { speaker: "Teammate", text: "A human already answered this question." },
    ]);
    expect(post).not.toHaveBeenCalled();
  });
  it("stays silent when the bounded thread context has more pages", async () => {
    page.mockResolvedValue({ messages: [], cursor: "more", more: true });
    await handleMessage("team_fixture", {
      type: "message",
      channel: "C123",
      user: "UCHARLIE",
      ts: "1800000000.002",
      thread_ts: "1800000000.001",
      text: "Does Hive index direct messages?",
    });
    expect(judge).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(
      query.mock.calls.some((call) =>
        call.includes("The thread context is incomplete."),
      ),
    ).toBe(true);
  });
  it("puts slash answers in a thread under a question root, never in the main channel", async () => {
    await handleCommand("team_fixture", {
      channel_id: "C123",
      user_id: "UCHARLIE",
      text: "ask Does Hive index direct messages?",
    });
    expect(root).toHaveBeenCalledWith(
      "synthetic",
      "C123",
      "/hive ask Does Hive index direct messages?",
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][3]).toBe("1800000000.008");
  });
  it("persists a slash parent before provider work and reuses it after a failure", async () => {
    const payload: Record<string, unknown> = {
      channel_id: "C123",
      user_id: "UCHARLIE",
      text: "ask Does Hive index direct messages?",
    };
    query.mockImplementation(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join(" ").includes("jsonb_build_object('thread_ts'"))
          payload.thread_ts = values[0];
        return [];
      },
    );
    ask.mockRejectedValueOnce(new Error("Provider failed"));
    await expect(
      handleCommand("team_fixture", payload, "job_fixture"),
    ).rejects.toThrow("Provider failed");
    await handleCommand("team_fixture", payload, "job_fixture");
    expect(root).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][3]).toBe("1800000000.008");
  });
  it("reuses the existing parent when a slash payload supplies one", async () => {
    await handleCommand("team_fixture", {
      channel_id: "C123",
      user_id: "UCHARLIE",
      text: "ask Does Hive index direct messages?",
      thread_ts: "1800000000.001",
    });
    expect(root).not.toHaveBeenCalled();
    expect(post.mock.calls[0][3]).toBe("1800000000.001");
  });
});
