import { expect, it } from "vitest";
import { decideOutcome } from "./outcome-judgments";
it.each(["useful", "contradicted", "stale", "inconclusive"] as const)(
  "classifies evidenced %s through a pure policy",
  (choice) => {
    expect(
      decideOutcome({
        result: { type: "choice", choice, confidence: 0.9 },
        supported: { type: "noul", noul: 0.9 },
      }),
    ).toBe(choice);
  },
);
it("keeps uncertain or unsupported results inconclusive", () => {
  expect(decideOutcome(null)).toBe("inconclusive");
  expect(
    decideOutcome({
      result: { type: "choice", choice: "useful", confidence: 0.79 },
      supported: { type: "noul", noul: 0.99 },
    }),
  ).toBe("inconclusive");
  expect(
    decideOutcome({
      result: { type: "choice", choice: "useful", confidence: 0.99 },
      supported: { type: "noul", noul: 0.79 },
    }),
  ).toBe("inconclusive");
});
