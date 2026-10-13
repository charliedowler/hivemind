import { describe, it, expect, vi, afterEach } from "vitest";
import {
  decideSlack,
  judgeSlack,
  type GateFacts,
  type GateSignals,
} from "./gate";
const facts: GateFacts = {
  prompted: false,
  inRoom: false,
  confirmedMatch: true,
  threadUsed: false,
  hourlyCount: 0,
};
const signals: GateSignals = {
  addressed: 0.1,
  answerable: 0.95,
  humans: 0.05,
  answered: 0.01,
  moreComing: 0.01,
  acknowledgement: 0.01,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Hive Slack gate", () => {
  it("always answers an explicit request even during an outage or cooldown", () =>
    expect(
      decideSlack(
        { ...facts, prompted: true, hourlyCount: 9, threadUsed: true },
        null,
      ).decision,
    ).toBe("reply_now"));
  it.each([
    { humans: 0.9 },
    { answered: 0.8 },
    { moreComing: 0.7 },
    { answerable: 0.6 },
  ])("does not intrude when a veto is present: %o", (overrides) =>
    expect(decideSlack(facts, { ...signals, ...overrides }).decision).toBe(
      "stay_silent",
    ),
  );
  it("fails closed on incomplete thread context even with an answerable confirmed cell", () => {
    expect(
      decideSlack({ ...facts, contextComplete: false }, signals).decision,
    ).toBe("stay_silent");
  });
  it("requires confirmed evidence for an unsolicited answer", () => {
    expect(
      decideSlack({ ...facts, confirmedMatch: false }, signals).decision,
    ).toBe("stay_silent");
    expect(decideSlack(facts, signals).decision).toBe("reply_now");
  });
  it.each([{ threadUsed: true }, { hourlyCount: 2 }])(
    "applies an unprompted limit: %o",
    (overrides) =>
      expect(decideSlack({ ...facts, ...overrides }, signals).decision).toBe(
        "stay_silent",
      ),
  );
  it("reacts only to acknowledgements in Hive’s own conversation", () => {
    const ack = {
      ...signals,
      addressed: 0.95,
      answerable: 0,
      acknowledgement: 0.95,
    };
    expect(decideSlack({ ...facts, inRoom: true }, ack).decision).toBe(
      "react_only",
    );
    expect(decideSlack(facts, ack).decision).toBe("stay_silent");
  });
  it("never lets a provider failure authorise an unprompted post", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const result = await judgeSlack("Where is the answer?", [], []);
    expect(result.signals).toBeNull();
    expect(decideSlack(facts, result.signals).decision).toBe("stay_silent");
  });
});
