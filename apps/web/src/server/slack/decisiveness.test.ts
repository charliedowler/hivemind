import { describe, it, expect } from "vitest";
import { decisivenessDecision } from "./decisiveness";
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
});
