import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({useRouter: () => ({refresh: vi.fn()})}));
import { ShareOnJoin } from "./share-on-join";
it("shows project counts without preselecting publication", () => {
  const html = renderToStaticMarkup(<ShareOnJoin teamId="team_fixture" teamName="Example team" projects={[{pattern:"github.com/example/widget",cells:12},{pattern:"github.com/example/private",cells:0}]} />);
  expect(html).toContain("Share your learnings with Example team?");
  expect(html).toContain("Anything you don&#x27;t pick stays personal.");
  expect(html).toContain("12");
  expect(html).not.toContain("checked=");
  expect(html).toContain("Choose projects");
  expect(html).toContain("Not now");
  expect(html).toContain(">Yes<");
  expect(html).toContain("now and in future");
});
it("keeps Yes available with no selection and points to Account", () => {
  const html = renderToStaticMarkup(<ShareOnJoin teamId="team_fixture" teamName="Example team" projects={[]} />);
  expect(html).toContain("Nothing selected yet");
  expect(html).toContain("/app/account#projects");
  expect(html).toContain(">Yes<");
  expect(html).not.toContain('disabled=""');
});
it.each(["yes", "chosen", "not_now"] as const)("shows a saved %s decision with Change instead of repeating the question", decision => {
  const html = renderToStaticMarkup(<ShareOnJoin teamId="team_fixture" teamName="Example team" projects={[]} decision={decision} />);
  expect(html).not.toContain("Share your learnings with");
  expect(html).toContain("Change");
  expect(html).toContain(decision === "yes" ? "everything from your selected projects" : decision === "chosen" ? "chosen projects" : "Not sharing with Example team");
});
