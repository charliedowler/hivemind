import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
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
