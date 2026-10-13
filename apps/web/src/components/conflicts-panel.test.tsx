import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DecisionCard } from "./conflicts-panel";

it("renders a submit action for the optional audit reason after reversal", () => {
  const html = renderToStaticMarkup(<DecisionCard record={{
    id: "dec_fixture", older: { id: "lrn_old", title: "Earlier evidence" }, newer: { id: "lrn_new", title: "Newer evidence" },
    decision: "reversed", reason: "Reversed by Admin on the dashboard", confidence: 1, model: "admin", jev: null,
    latencyMs: 0, author: "Admin", repo: null, canReverse: true, canEditReason: true, createdAt: "2026-10-13T00:00:00Z",
  }} onOpen={() => {}} onDecision={() => {}} />);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save reason<\/button>/);
  expect(html).toContain("Reason for reversal (optional)");
  expect(html).not.toContain("required");
});
