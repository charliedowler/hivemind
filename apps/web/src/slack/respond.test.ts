import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { respondToSlack } from "./respond";
import { dispatchSlackAction, slackTools } from "./tools";
const { create, sql, systemOne, decide, decline, undoLast, reversible } =
  vi.hoisted(() => ({
    create: vi.fn(),
    sql: vi.fn(),
    systemOne: vi.fn(),
    decide: vi.fn(),
    decline: vi.fn(),
    undoLast: vi.fn(),
    reversible: vi.fn(),
  }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function () {
    return { messages: { create } };
  }),
}));
vi.mock("@/server/digests/connection", () => ({
  slackMemberTimezone: async () => "Europe/London",
}));
vi.mock("@/server/db/client", () => ({ getSql: () => sql }));
vi.mock("@typesafe-ai/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@typesafe-ai/sdk")>()),
  TypeSafeClient: class {
    systemOne = systemOne;
  },
}));
vi.mock("@/server/identity/join-requests", () => ({
  decideJoinRequestInTransaction: decide,
  deliverJoinDecline: decline,
}));
vi.mock("@/server/slack/actions", () => ({
  runReversibleAction: reversible,
  undoLastAction: undoLast,
}));
const ctx = {
  teamId: "team_test",
  memberId: "member_test",
  isAdmin: false,
  channelId: "C123",
  threadTs: "1800000000.001",
};
// Answer each query by the first fragment it contains; anything else returns no rows.
function db(rows: Array<[string, unknown[]]>) {
  sql.mockImplementation(async (strings: TemplateStringsArray) => {
    const text = strings.join("?");
    return rows.find(([fragment]) => text.includes(fragment))?.[1] ?? [];
  });
}
beforeEach(() => {
  db([]);
  reversible.mockImplementation(async (_ctx, _name, change) => {
    const result = await change(sql);
    return { text: result.text, react: result.react };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const mock of [create, sql, systemOne, decide, decline, undoLast, reversible])
    mock.mockReset();
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
        threadContext: { notices: [], lastReversibleAction: null },
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

describe("Agentic routing of join decisions and undo", () => {
  const admin = {
    teamId: "team_test",
    memberId: "admin_test",
    isAdmin: true,
    channelId: "DADMIN",
    threadTs: "1800000000.100",
  };
  const notice = {
    id: "jrq_fixture",
    email: "rephus@example.test",
    status: "pending",
    live: true,
    name: "Rephus Example",
    team_name: "Fixture hive",
    thread_ts: admin.threadTs,
  };
  const role = (value: string): [string, unknown[]] => [
    "SELECT h.role FROM hive_memberships",
    [{ role: value }],
  ];
  const actor: [string, unknown[]] = [
    "SELECT m.name,t.name AS team_name FROM members m",
    [{ name: "Admin", team_name: "Fixture hive" }],
  ];
  const notices: [string, unknown[]] = [
    "ORDER BY n.sent_at DESC",
    [notice],
  ];
  const routed = (name: string, input: Record<string, unknown>) =>
    create.mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name, input }],
    });
  const jev = (instruction: number, specific: number) =>
    systemOne.mockResolvedValue({
      answers: {
        instruction: { type: "noul", noul: instruction },
        specific: { type: "noul", noul: specific },
        allowed: { type: "noul", noul: 0.99 },
      },
    });
  const routingInput = () =>
    JSON.parse(create.mock.calls[0][0].messages[0].content);
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic");
    vi.stubEnv("TYPESAFE_API_KEY", "synthetic");
    decide.mockResolvedValue({ version: "v1" });
  });

  it("approves on a bare 'approved' in a join-request thread, with the notice in the routing input", async () => {
    db([
      notices,
      role("admin"),
      actor,
      ["FROM hive_join_requests r LEFT JOIN", [{ id: notice.id, thread_ts: admin.threadTs }]],
    ]);
    routed("hive_decide_join_request", {
      decision: "approve",
      requestId: notice.id,
    });
    jev(0.95, 0.92);
    expect(
      await respondToSlack(admin, "approved", "1800000000.200", []),
    ).toEqual({ text: "Join request approved.", react: "white_check_mark" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(routingInput().message).toBe("approved");
    expect(routingInput().threadContext.notices).toEqual([
      {
        kind: "join_request",
        requestId: notice.id,
        person: { name: "Rephus Example", email: notice.email },
        team: "Fixture hive",
        status: "pending",
        noticeIsThisThread: true,
      },
    ]);
    expect(systemOne.mock.calls[0][0].state).toMatchObject({
      request: "approved",
      action: "join_request",
      context: { notices: routingInput().threadContext.notices },
    });
    expect(decide).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ memberId: admin.memberId }),
      notice.id,
      "approve",
    );
  });

  it("reads the address out of Slack mailto markup", async () => {
    const channel = { ...admin, channelId: "C123" };
    db([role("admin"), actor, ["lower(split_part(m.name", [{ id: notice.id }]]]);
    routed("hive_decide_join_request", {
      decision: "approve",
      person: "<mailto:rephus@example.test|rephus@example.test>",
    });
    jev(0.97, 0.95);
    expect(
      await respondToSlack(
        channel,
        "approve <mailto:rephus@example.test|rephus@example.test>",
        "1800000000.200",
        [],
      ),
    ).toMatchObject({ react: "white_check_mark" });
    expect(routingInput().message).toBe("approve rephus@example.test");
    expect(systemOne.mock.calls[0][0].state.request).toBe(
      "approve rephus@example.test",
    );
    const lookup = sql.mock.calls.find(([strings]) =>
      strings.join("?").includes("lower(split_part(m.name"),
    )!;
    expect(lookup.slice(1)).toContain("rephus@example.test");
    expect(lookup.slice(1)).not.toContain(
      "<mailto:rephus@example.test|rephus@example.test>",
    );
    expect(decide).toHaveBeenCalledWith(sql, expect.anything(), notice.id, "approve");
  });

  it("asks who on a bare 'decline' with no notice in context", async () => {
    const channel = { ...admin, channelId: "C123" };
    db([role("admin"), actor]);
    routed("hive_decide_join_request", { decision: "decline" });
    jev(0.93, 0.4);
    expect(
      await respondToSlack(channel, "decline", "1800000000.200", []),
    ).toEqual({
      text: "Who should I approve or decline? Include their name or email.",
    });
    expect(routingInput().threadContext.notices).toEqual([]);
    expect(reversible).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(decline).not.toHaveBeenCalled();
  });

  it("asks who when the model routes a bare 'decline' and Jev lets it through", async () => {
    const channel = { ...admin, channelId: "C123" };
    db([role("admin"), actor]);
    routed("hive_decide_join_request", { decision: "decline" });
    jev(0.93, 0.9);
    expect(
      (await respondToSlack(channel, "decline", "1800000000.200", [])).text,
    ).toBe("Who should I approve or decline? Include their name or email.");
    expect(decide).not.toHaveBeenCalled();
  });

  it("refuses a non-admin approval without a Jev call or a mutation", async () => {
    const member = { ...admin, memberId: "member_test", isAdmin: false };
    db([notices, role("member"), actor]);
    routed("hive_decide_join_request", {
      decision: "approve",
      person: "rephus",
    });
    expect(
      await respondToSlack(member, "approve rephus", "1800000000.200", []),
    ).toEqual({ text: "A team admin is needed to change Hive from Slack." });
    expect(routingInput().threadContext.notices).toEqual([]);
    expect(systemOne).not.toHaveBeenCalled();
    expect(reversible).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it("undoes on 'undo that' in a thread with a reversible action", async () => {
    const channel = {
      ...admin,
      channelId: "C123",
      threadTs: "1800000000.300",
    };
    const action = {
      source: "shared",
      id: "sact_fixture",
      member_id: admin.memberId,
      tool_name: "hive_decide_join_request",
      inverse: { kind: "join_request_decided" },
      expires_at: new Date(Date.now() + 600000),
      undone_at: null,
    };
    db([["UNION ALL", [action]], role("admin")]);
    routed("undo_last_action", {});
    jev(0.96, 0.94);
    undoLast.mockResolvedValue({ react: "white_check_mark" });
    expect(
      await respondToSlack(channel, "undo that", "1800000000.400", []),
    ).toEqual({ text: "", react: "white_check_mark" });
    expect(routingInput().threadContext.lastReversibleAction).toEqual({
      tool: "hive_decide_join_request",
      authorIsSpeaker: true,
      alreadyUndone: false,
      withinUndoWindow: true,
    });
    expect(systemOne.mock.calls[0][0].state).toMatchObject({
      request: "undo that",
      action: "undo",
    });
    expect(undoLast).toHaveBeenCalledWith(
      expect.objectContaining({ threadTs: channel.threadTs }),
      "sact_fixture",
    );
  });

  it("answers a plain question in a join-request thread without approving anything", async () => {
    db([notices, role("admin"), actor]);
    const ask = slackTools.find((tool) => tool.name === "hive_ask")!;
    const answer = vi
      .spyOn(ask, "handler")
      .mockResolvedValue({ text: "Rephus works on the billing service." });
    routed("hive_ask", { question: "Who is Rephus and what do they work on?" });
    expect(
      await respondToSlack(
        admin,
        "who is this person and what do they work on?",
        "1800000000.200",
        [],
      ),
    ).toEqual({ text: "Rephus works on the billing service." });
    expect(answer).toHaveBeenCalledTimes(1);
    expect(routingInput().threadContext.notices).toHaveLength(1);
    expect(systemOne).not.toHaveBeenCalled();
    expect(reversible).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });

  it("asks for the decision when a question is misrouted to the join tool", async () => {
    db([notices, role("admin"), actor]);
    routed("hive_decide_join_request", {
      decision: "approve",
      requestId: notice.id,
    });
    jev(0.15, 0.9);
    expect(
      await respondToSlack(
        admin,
        "how does approval work here?",
        "1800000000.200",
        [],
      ),
    ).toEqual({ text: "Should I approve or decline this request?" });
    expect(reversible).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
  });
});
