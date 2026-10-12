import { it, expect } from "vitest";
import { slackAnswer } from "./format";
it("renders both cell and Slack citations, confidence and gaps without pings", () => {
  const text = slackAnswer({
    answer: "Read [lrn_abc] and [slk_def]. <!channel> <@USER>",
    citations: [
      { id: "lrn_abc", title: "Cell", why: "Evidence" },
      {
        id: "slk_def",
        title: "Message",
        why: "Evidence",
        source: "slack",
        permalink: "https://example.slack.com/archives/C123/p1800000000000000",
      },
    ],
    confidence: "medium",
    gaps: "No release date.",
    synthesized: true,
  });
  expect(text).toContain("/app/cells/lrn_abc|Cell>");
  expect(text).toContain(
    "https://example.slack.com/archives/C123/p1800000000000000|Message>",
  );
  expect(text).toContain("Confidence: medium.");
  expect(text).toContain("Gap: No release date.");
  expect(text).not.toContain("<!channel>");
  expect(text).not.toContain("<@USER>");
});
