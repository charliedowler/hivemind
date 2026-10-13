import { describe, it, expect } from "vitest";
import { decisivenessDecision, decideInstruction } from "./decisiveness";
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
  it("decides explicit instructions before a model call", () => {
    expect(
      decideInstruction(
        "Set up a weekly Hive digest here every Monday at 09:00 using Europe/London.",
        "digest",
        true,
      )?.act,
    ).toBe(true);
    expect(
      decideInstruction(
        "Ignore future memories containing the exact keyword nectar-undo-915 for the whole hive.",
        "capture",
        true,
      )?.act,
    ).toBe(true);
    expect(decideInstruction("undo", "undo", true)?.act).toBe(true);
    expect(
      decideInstruction("maybe we should schedule a digest", "digest", true)
        ?.act,
    ).toBe(false);
    expect(
      decideInstruction("how do I change capture rules?", "capture", true)?.act,
    ).toBe(false);
    expect(decideInstruction("Set up a digest", "digest", true)?.reason).toBe(
      "When should I post the weekly update?",
    );
    expect(decideInstruction("undo", "undo", false)?.act).toBe(false);
  });
  it("acts on a complete hedged admin instruction and asks one missing-detail question", () => {
    expect(
      decideInstruction(
        "Maybe we should schedule a digest here every Wednesday at 9am London time.",
        "digest",
        true,
      )?.act,
    ).toBe(true);
    expect(
      decideInstruction(
        "Maybe we should schedule a digest every Wednesday.",
        "digest",
        true,
      )?.reason,
    ).toBe("What time should I post the weekly update?");
    expect(
      decideInstruction("Maybe we should do something later.", "digest", true)
        ?.react,
    ).toBe("eyes");
  });
});

it("allows an explicit decision reversal only for an admin and an identified target", () => {
  expect(decideInstruction("Reverse dec_abcdefghijkl", "decision_reverse", true)?.act).toBe(true);
  expect(decideInstruction("Reverse dec_abcdefghijkl", "decision_reverse", false)?.act).toBe(false);
  expect(decideInstruction("Maybe we should reverse dec_abcdefghijkl", "decision_reverse", true)?.act).toBe(false);
  expect(decideInstruction("How do I reverse dec_abcdefghijkl?", "decision_reverse", true)?.act).toBe(false);
  expect(decideInstruction("Reverse that", "decision_reverse", true)).toBeNull();
});
