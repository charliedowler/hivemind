import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({useRouter: () => ({refresh: vi.fn()})}));
import { ShareOnJoin } from "./share-on-join";
it("explains what Yes shares and shows project counts without preselecting publication", () => {
  const html = renderToStaticMarkup(<ShareOnJoin teamId="team_fixture" teamName="Example team" projects={[{pattern:"github.com/example/widget",cells:12},{pattern:"github.com/example/private",cells:0}]} />);
  expect(html).toContain("Share your learnings with Example team?");
  expect(html).toContain("Yes shares the cells Hive captures from your repos with Example team, now and in future. Your originals stay in your personal hive, and you can change this later on the Team page.");
  expect(html).toContain("12");
  expect(html).not.toContain("checked=");
  expect(html).toContain("Choose projects");
  expect(html).toContain("Not now");
  expect(html.indexOf(">Yes<")).toBeLessThan(html.indexOf("Choose projects"));
});
it("suggests sharing by the person's work areas", () => {
  const html = renderToStaticMarkup(<ShareOnJoin teamId="team_fixture" teamName="Lightdash" workAreas="frontend React, dbt models, infra" projects={[]} />);
  expect(html).toContain("Share your learnings about frontend React, dbt models and infra with Lightdash?");
});
it("keeps Yes available before anything is captured", () => {
  const html = renderToStaticMarkup(<ShareOnJoin teamId="team_fixture" teamName="Example team" projects={[]} />);
  expect(html).toContain("Hive has not captured anything yet.");
  expect(html).toContain(">Yes<");
  expect(html).not.toContain('disabled=""');
  expect(html).not.toContain("Choose projects");
});
it("points a selected-only owner with no projects to Account", () => {
  const html = renderToStaticMarkup(<ShareOnJoin teamId="team_fixture" teamName="Example team" mode="selected" projects={[]} />);
  expect(html).toContain("Hive is set to selected projects only and none are listed");
  expect(html).toContain("/app/account#projects");
});
it.each(["yes", "chosen", "not_now"] as const)("shows a saved %s decision with Change instead of repeating the question", decision => {
  const html = renderToStaticMarkup(<ShareOnJoin teamId="team_fixture" teamName="Example team" projects={[]} decision={decision} />);
  expect(html).not.toContain("Share your learnings with");
  expect(html).toContain("Change");
  expect(html).toContain(decision === "yes" ? "everything Hive captures for you" : decision === "chosen" ? "chosen projects" : "Not sharing with Example team");
});
it("pre-ticks sharing for a person who just joined and explains what the tick shares", () => {
  const html = renderToStaticMarkup(<ShareOnJoin teamId="team_fixture" teamName="Lightdash" projects={[{pattern:"github.com/example/widget",cells:2}]} preselect />);
  expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
  expect(html).toContain("Share what Hive learns with Lightdash");
  expect(html).toContain("With this ticked, Lightdash sees the cells Hive captures from your repos, now and in future. Your originals stay in your personal hive, and you can change this later on the Team page.");
  expect(html).toContain("Share with Lightdash");
  expect(html).toContain("Choose projects");
});
