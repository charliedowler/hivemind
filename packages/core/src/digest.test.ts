import { expect, it } from "vitest";
import { composeDigest, type DigestData } from "./digest";
const data = (): DigestData => ({
  since: "2026-10-06T00:00:00Z",
  until: "2026-10-13T00:00:00Z",
  learnings: [],
  insights: [],
  friction: [],
  decisions: [],
});
const include = {
  learnings: true,
  insights: true,
  friction: true,
  decisions: true,
};
it("renders an empty period as one short line under the period", () => {
  const result = composeDigest(data(), include, "Europe/London");
  expect(result.empty).toBe(true);
  expect(result.blocks).toHaveLength(2);
  expect(result.text).toContain("Tuesday 6 October to Tuesday 13 October");
  expect(result.text).toContain("No changes since");
});
it("limits items, escapes unintended mentions, and links replacements", () => {
  const d = data();
  d.learnings = Array.from({ length: 8 }, (_, i) => ({
    id: `lrn_${i}`,
    title: "<!channel> <bad> & a fact",
    author: { name: "A", slackId: "U1234" },
    state: "superseded",
    replacementId: "lrn_new",
  }));
  const result = composeDigest(d, include, "UTC");
  expect(result.text).toContain("and 3 more");
  expect(result.text).not.toContain("<!channel>");
  expect(result.text).toContain("<@U1234>");
  expect(result.text).toContain("/app/cells/lrn_new");
});
it("counts repeated friction observations and unknown costs separately", () => {
  const d = data();
  d.friction = [10, null, 15].map((minutes) => ({
    id: "lrn_same",
    title: "Setup blocked",
    author: { name: "One" },
    area: "environment",
    minutes,
    blocked: true,
    workaround: "Use the documented setup",
  }));
  const result = composeDigest(d, include, "UTC");
  expect(result.counts).toMatchObject({
    friction: 3,
    minutes: 25,
    unmeasured: 1,
    blocked: 3,
  });
  expect(result.text).toContain("Workaround:");
  expect(result.text).toContain("environment: 3 reports");
});
it("bounds blocks without breaking links and excludes unselected sections", () => {
  const d = data();
  d.friction = Array.from({ length: 80 }, (_, i) => ({
    id: `lrn_${i}`,
    title: "long ".repeat(1000),
    author: { name: "long ".repeat(500) },
    area: String(i % 8),
    minutes: 5,
    blocked: false,
    workaround: "long ".repeat(500),
  }));
  const result = composeDigest(d, include, "UTC");
  expect(result.blocks.length).toBeLessThan(50);
  expect(result.blocks.every((b) => b.text.text.length <= 3000)).toBe(true);
  const hidden = composeDigest(d, { ...include, friction: false }, "UTC");
  expect(hidden.empty).toBe(true);
  expect(hidden.counts.minutes).toBe(0);
});
