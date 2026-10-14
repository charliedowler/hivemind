import { beforeEach, expect, it, vi } from "vitest";
import { undoThreadAction } from "./undo";
const { sql, shared, digest, capture, digestPointer } = vi.hoisted(() => ({
  sql: vi.fn(),
  shared: vi.fn(),
  digest: vi.fn(),
  capture: vi.fn(),
  digestPointer: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ getSql: () => sql }));
vi.mock("@/server/slack/actions", () => ({ undoLastAction: shared }));
vi.mock("@/server/digests/instructions", () => ({
  applyDigestInstruction: digest,
}));
vi.mock("./digests", () => ({
  digestUndoHandlers: {
    hive_schedule_digest: digestPointer,
    hive_list_digest_schedules: digestPointer,
  },
}));
vi.mock("./capture-rules", () => ({
  captureUndoHandlers: { hive_set_capture_rule: capture },
}));
const ctx = {
  teamId: "team_fixture",
  memberId: "member_fixture",
  isAdmin: true,
  channelId: "C123",
  threadTs: "1800000000.1",
  messageTs: "1800000000.2",
  instructionText: "undo",
};
const pointer = {
  id: "action_fixture",
  member_id: ctx.memberId,
  expires_at: new Date(Date.now() + 3600000),
  undone_at: null,
  source: "shared",
  tool_name: "hive_reverse_decision",
  inverse: {},
};
beforeEach(() => {
  vi.clearAllMocks();
  sql.mockResolvedValue([pointer]);
  shared.mockResolvedValue({ react: "white_check_mark" });
  digest.mockResolvedValue({ react: "+1" });
  capture.mockResolvedValue({ react: "white_check_mark" });
  digestPointer.mockResolvedValue({ react: "white_check_mark" });
});
it("undoes the globally latest shared action by its exact receipt", async () => {
  expect(await undoThreadAction(ctx)).toEqual({ react: "white_check_mark" });
  expect(shared).toHaveBeenCalledWith(ctx, pointer.id);
  expect(digest).not.toHaveBeenCalled();
});
it("routes a later digest change instead of an older capture change", async () => {
  sql.mockResolvedValue([{ ...pointer, source: "digest" }]);
  expect(await undoThreadAction(ctx)).toEqual({ react: "white_check_mark" });
  expect(digest).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ action: "undo" }),
    pointer.id,
  );
  expect(capture).not.toHaveBeenCalled();
  expect(shared).not.toHaveBeenCalled();
});
it("routes a later capture change instead of an older digest change", async () => {
  sql.mockResolvedValue([
    {
      ...pointer,
      tool_name: "hive_set_capture_rule",
      inverse: { kind: "capture_instruction" },
    },
  ]);
  expect(await undoThreadAction(ctx)).toEqual({ react: "white_check_mark" });
  expect(capture).toHaveBeenCalledWith(
    ctx,
    expect.objectContaining({ member_id: ctx.memberId }),
  );
  expect(digest).not.toHaveBeenCalled();
});
it.each([
  { member_id: "another_member", expected: "Only the person" },
  { undone_at: new Date(), expected: "already undone" },
  { expires_at: new Date(0), expected: "one-hour" },
])(
  "does not fall back to an older action when the latest is unavailable: $expected",
  async ({ expected, ...change }) => {
    sql.mockResolvedValue([{ ...pointer, ...change }]);
    expect((await undoThreadAction(ctx)).text).toContain(expected);
    expect(shared).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  },
);
it("reports no reversible action without trying another conversation", async () => {
  sql.mockResolvedValue([]);
  expect((await undoThreadAction(ctx)).text).toContain("no reversible action");
  expect(shared).not.toHaveBeenCalled();
});

it("undoes a top-level DM reply against the latest change recorded under its notice thread", async () => {
  const dm = { ...ctx, channelId: "DADMIN", threadTs: "1800000000.9", messageTs: "1800000000.9" };
  sql
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ thread_ts: "1800000000.5" }])
    .mockResolvedValueOnce([pointer]);
  expect(await undoThreadAction(dm)).toEqual({ react: "white_check_mark" });
  expect(shared).toHaveBeenCalledWith(
    { ...dm, threadTs: "1800000000.5" },
    pointer.id,
  );
});
it("does not look outside the thread for a threaded reply", async () => {
  sql.mockResolvedValueOnce([]);
  expect(
    (await undoThreadAction({ ...ctx, channelId: "DADMIN" })).text,
  ).toContain("no reversible action");
  expect(sql).toHaveBeenCalledTimes(1);
});

it.each(["hive_schedule_digest", "hive_list_digest_schedules"])(
  "dispatches %s through its digest instruction pointer",
  async (toolName) => {
    const inverse = {
      kind: "digest_instruction",
      reversible: true,
      payload: { instructionId: "dgi_fixture" },
    };
    sql.mockResolvedValue([{ ...pointer, tool_name: toolName, inverse }]);
    expect(await undoThreadAction(ctx)).toEqual({ react: "white_check_mark" });
    expect(digestPointer).toHaveBeenCalledWith(ctx, {
      member_id: ctx.memberId,
      inverse,
    });
    expect(shared).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
  },
);
