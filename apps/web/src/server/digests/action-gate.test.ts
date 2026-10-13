import { expect, it, vi } from "vitest";
import { decide, judgeDigest } from "./action-gate";
it("acts on decisive signals and uses model judgement only when unavailable", () => {
  const facts = { isAdmin: true, enough: true, clear: true };
  expect(decide(facts, { instruction: 0.95, enough: 0.95, allowed: 1 })).toBe(
    "act",
  );
  expect(decide(facts, null)).toBe("act");
  expect(decide({ ...facts, clear: false }, null)).toBe("clarify");
  expect(decide({ ...facts, clear: false, suggestion: true }, null)).toBe(
    "act",
  );
  expect(decide(facts, { instruction: 0.3, enough: 1, allowed: 1 })).toBe(
    "clarify",
  );
  expect(
    decide(
      { ...facts, enough: false },
      { instruction: 1, enough: 1, allowed: 1 },
    ),
  ).toBe("clarify");
  expect(
    decide(
      { ...facts, isAdmin: false },
      { instruction: 1, enough: 1, allowed: 1 },
    ),
  ).toBe("refuse");
});
it("returns a model fallback when Jev is unconfigured", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "");
  expect((await judgeDigest("set", true, {})).signals).toBeNull();
  vi.unstubAllEnvs();
});
