import { beforeEach, expect, it, vi } from "vitest";
import { decisionTools } from "./decisions";
import { decideDecisiveness } from "@/server/slack/decisiveness";
import { reverseDecision } from "@/server/conflict-decisions";
import { runReversibleAction } from "@/server/slack/actions";
import { HiveError } from "@/server/errors";

vi.mock("@/server/slack/decisiveness", () => ({ decideDecisiveness: vi.fn() }));
vi.mock("@/server/conflict-decisions", () => ({ reverseDecision: vi.fn() }));
vi.mock("@/server/knowledge-tree", () => ({ scheduleKnowledge: vi.fn() }));
vi.mock("./context", () => ({
  toolActor: async () => ({
    teamId: "team",
    memberId: "admin",
    memberName: "Admin",
    teamName: "Team",
  }),
}));
vi.mock("@/server/slack/actions", () => ({ runReversibleAction: vi.fn() }));
const context = {
  teamId: "team",
  memberId: "admin",
  isAdmin: true,
  channelId: "C123",
  threadTs: "1.1",
  messageTs: "1.2",
  instructionText: "Reverse dec_abcdefghijkl",
};
beforeEach(() => vi.resetAllMocks());
it("acts immediately through the shared decisiveness helper and saves its inverse", async () => {
  vi.mocked(decideDecisiveness).mockResolvedValue({
    act: true,
    reason: "Clear instruction",
  });
  vi.mocked(reverseDecision).mockResolvedValue({
    id: "dec_inverse",
    decision: "reversed",
    reason: "Audit",
  });
  const transaction = {};
  vi.mocked(runReversibleAction).mockImplementation(
    async (_ctx, _name, change) => {
      const result = await change(transaction as never);
      expect(result.inverse).toEqual({
        kind: "decision_reversed",
        id: "dec_inverse",
      });
      return { text: result.text };
    },
  );
  expect(
    await decisionTools[0].handler(context, {
      decision_id: "dec_abcdefghijkl",
    }),
  ).toEqual({ text: "dec_inverse: Cell change reversed." });
  expect(decideDecisiveness).toHaveBeenCalledWith(context.instructionText, {
    ...context,
    actionType: "decision_reverse",
  });
  expect(reverseDecision).toHaveBeenCalledWith(
    expect.objectContaining({ memberId: "admin" }),
    "dec_abcdefghijkl",
    undefined,
    transaction,
    "from Slack",
  );
});
it("does not mutate on a musing and reports a guarded stale-cell refusal", async () => {
  vi.mocked(decideDecisiveness).mockResolvedValue({
    act: false,
    reason: "No current instruction.",
  });
  expect(
    await decisionTools[0].handler(context, { decision_id: "dec_target" }),
  ).toEqual({ text: "No current instruction." });
  expect(runReversibleAction).not.toHaveBeenCalled();
  vi.mocked(decideDecisiveness).mockResolvedValue({
    act: true,
    reason: "Clear",
  });
  vi.mocked(runReversibleAction).mockRejectedValue(
    new HiveError("A cell changes after this decision.", 409),
  );
  expect(
    await decisionTools[0].handler(context, { decision_id: "dec_target" }),
  ).toEqual({ text: "A cell changes after this decision." });
});
