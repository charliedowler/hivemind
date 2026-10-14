import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { decisivenessDecision, decideDecisiveness } from "./decisiveness";
const { sql, systemOne } = vi.hoisted(() => ({
  sql: vi.fn(),
  systemOne: vi.fn(),
}));
vi.mock("../db/client", () => ({ getSql: () => sql }));
vi.mock("../classify", () => ({ jevModel: "jev-test" }));
vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: class {
    systemOne = systemOne;
  },
  noul: (instructions: string) => ({ type: "noul", instructions }),
}));
const clear = { instruction: 0.98, specific: 0.97, allowed: 0.99 };
describe("Admin instruction decisiveness", () => {
  it("acts on a clear and specific allowed request", () =>
    expect(decisivenessDecision(true, clear).act).toBe(true));
  it("does not act on questions or musings", () =>
    expect(decisivenessDecision(true, { ...clear, instruction: 0.4 }).act).toBe(
      false,
    ));
  it("does not invent missing details", () =>
    expect(decisivenessDecision(true, { ...clear, specific: 0.6 }).act).toBe(
      false,
    ));
  it("cannot let model scores grant admin rights", () =>
    expect(decisivenessDecision(false, clear).act).toBe(false));
  it("fails closed without Jev", () =>
    expect(decisivenessDecision(true, null).act).toBe(false));
  it("vetoes an instruction outside the stated permission", () =>
    expect(decisivenessDecision(true, { ...clear, allowed: 0.2 }).act).toBe(
      false,
    ));
  it.each([
    { instruction: 0.9, specific: 0.98, allowed: 0.97 },
    { instruction: 0.81, specific: 0.97, allowed: 0.96 },
    { instruction: 0.95, specific: 0.74, allowed: 0.97 },
  ])(
    "accepts verified clear schedule, capture and thread undo judgments",
    (signals) => {
      expect(decisivenessDecision(true, signals).act).toBe(true);
    },
  );
  it.each([
    { instruction: 0.28, specific: 0.98, allowed: 0.97 },
    { instruction: 0.94, specific: 0.04, allowed: 0.97 },
    { instruction: 0.63, specific: 0.92, allowed: 0.96 },
  ])(
    "refuses verified musing, incomplete schedule and informational question judgments",
    (signals) => {
      expect(decisivenessDecision(true, signals).act).toBe(false);
    },
  );
});

describe("Clarifying lines", () => {
  it("asks one short line per action when a detail is missing", () => {
    const vague = { ...clear, specific: 0.2 };
    expect(decisivenessDecision(true, vague, "join_request").reason).toBe(
      "Who should I approve or decline? Include their name or email.",
    );
    expect(decisivenessDecision(true, vague, "digest").reason).toBe(
      "When should I post the weekly update?",
    );
    expect(decisivenessDecision(true, vague, "decision_reverse").reason).toBe(
      "Which cell change should Hive reverse? Include its decision ID.",
    );
    expect(decisivenessDecision(true, vague, "undo").reason).toBe(
      "Which change should I undo?",
    );
  });
  it("asks for the decision on a join request reply that is not one, and looks at musings elsewhere", () => {
    const musing = { ...clear, instruction: 0.2 };
    expect(decisivenessDecision(true, musing, "join_request")).toEqual({
      act: false,
      reason: "Should I approve or decline this request?",
    });
    expect(decisivenessDecision(true, musing, "undo").reason).toBe(
      "Should I undo the last change here?",
    );
    expect(decisivenessDecision(true, musing, "digest")).toEqual({
      act: false,
      reason: "",
      react: "eyes",
    });
  });
});

describe("Jev decisiveness gate", () => {
  const ctx = {
    teamId: "team_fixture",
    memberId: "member_fixture",
    isAdmin: true,
    channelId: "DADMIN",
    threadTs: "1800000000.1",
    threadContext: {
      notices: [
        {
          kind: "join_request" as const,
          requestId: "jrq_fixture",
          person: { name: "Rephus", email: "rephus@example.test" },
          team: "Fixture team",
          status: "pending" as const,
          noticeIsThisThread: true,
        },
      ],
      lastReversibleAction: null,
    },
  };
  const answers = (instruction: number, specific: number, allowed = 0.99) => ({
    answers: {
      instruction: { type: "noul", noul: instruction },
      specific: { type: "noul", noul: specific },
      allowed: { type: "noul", noul: allowed },
    },
  });
  beforeEach(() => vi.stubEnv("TYPESAFE_API_KEY", "synthetic"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });
  it("judges a bare reply with the pending notice it answers", async () => {
    sql.mockResolvedValue([{ role: "admin" }]);
    systemOne.mockResolvedValue(answers(0.95, 0.9));
    expect(
      await decideDecisiveness("approved", { ...ctx, actionType: "join_request" }),
    ).toMatchObject({ act: true });
    const call = systemOne.mock.calls[0][0];
    expect(call.state.request).toBe("approved");
    expect(call.state.context.notices).toEqual(ctx.threadContext.notices);
    expect(call.questions.specific.instructions).toContain("context.notices");
  });
  it("refuses a non-admin join decision without asking Jev", async () => {
    sql.mockResolvedValue([{ role: "member" }]);
    expect(
      await decideDecisiveness("approved", {
        ...ctx,
        isAdmin: false,
        actionType: "join_request",
      }),
    ).toEqual({
      act: false,
      reason: "A team admin is needed to change Hive from Slack.",
    });
    expect(systemOne).not.toHaveBeenCalled();
  });
  it("lets a member ask to undo their own change; the undo service checks authorship", async () => {
    sql.mockResolvedValue([{ role: "member" }]);
    systemOne.mockResolvedValue(answers(0.97, 0.95));
    expect(
      await decideDecisiveness("undo that", {
        ...ctx,
        isAdmin: false,
        actionType: "undo",
      }),
    ).toMatchObject({ act: true });
    expect(systemOne.mock.calls[0][0].state.speaker).toEqual({
      allowed: true,
      role: "member",
    });
  });
  it("fails closed when Jev is unavailable", async () => {
    sql.mockResolvedValue([{ role: "admin" }]);
    systemOne.mockRejectedValue(new Error("timeout"));
    expect(
      await decideDecisiveness("approved", { ...ctx, actionType: "join_request" }),
    ).toEqual({
      act: false,
      reason: "Hive could not judge this instruction. Try again shortly.",
    });
  });
});
