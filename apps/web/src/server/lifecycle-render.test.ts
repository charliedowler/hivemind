import { describe, expect, it } from "vitest";
import { appendLifecycleContext } from "./lifecycle";
const result = {
  answer: "Channel indexing needs consent [lrn_permission].",
  citations: [
    { id: "lrn_permission", title: "Channel permission", why: "Evidence" },
  ],
  confidence: "high" as const,
  gaps: null,
  synthesized: true,
};
const context = {
  prompt: "{}",
  text: "As of 2026-10-12.\n\nReplaced [lrn_old] with [lrn_new] on 2026-10-12.",
  citations: [
    { id: "lrn_old", title: "Old port", why: "History" },
    { id: "lrn_new", title: "New port", why: "History" },
  ],
};
describe("Relevant lifecycle notes", () => {
  it("does not append an unrelated replacement or its citations", () => {
    const output = appendLifecycleContext(result, context);
    expect(output.answer).not.toContain("Replaced");
    expect(output.citations).toEqual(result.citations);
  });
  it("drops same-title supersession notes even when the current cell is relevant", () => {
    const output = appendLifecycleContext(
      { ...result, citations: [context.citations[1]] },
      {
        ...context,
        citations: context.citations.map((citation) => ({
          ...citation,
          title: "Same title",
        })),
      },
    );
    expect(output.answer).not.toContain("Replaced");
    expect(output.citations.map((citation) => citation.id)).toEqual([
      "lrn_new",
    ]);
  });
  it("keeps distinct old and new cells when the answer cites that change", () => {
    const output = appendLifecycleContext(
      {
        ...result,
        answer: "Use the new port [lrn_new].",
        citations: [context.citations[1]],
      },
      context,
    );
    expect(output.answer).toContain("Replaced [lrn_old] with [lrn_new]");
    expect(output.citations.map((citation) => citation.title)).toEqual([
      "New port",
      "Old port",
    ]);
  });
});
