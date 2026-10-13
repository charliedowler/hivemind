import { describe, it, expect } from "vitest";
import type { AskResult } from "@hivemind/core";
import { slackAnswer, shortCitationTitle, slackCaptureReply, slackDecisionSignals } from "./format";
const result: AskResult = {
  answer:
    "No. Hive never indexes direct messages [lrn_abc]. Channel indexing needs an admin selection [lrn_abc] and the bot being invited [slk_def].\n\nAs of 2026-10-12.",
  citations: [
    {
      id: "lrn_abc",
      title: "Hive never indexes direct messages",
      why: "Evidence",
      date: "2026-10-12",
      permalink: "https://example.slack.com/archives/C123/p1800000000000000",
      source: "slack",
    },
    {
      id: "slk_def",
      title: "Same evidence",
      why: "Evidence",
      permalink: "https://example.slack.com/archives/C123/p1800000000000000",
      source: "slack",
    },
    { id: "lrn_abc", title: "Duplicate", why: "Duplicate" },
  ],
  confidence: "high",
  gaps: null,
  synthesized: true,
};
describe("Slack answer presentation", () => {
  it("renders prose, one short marker and one source for repeated cells and duplicate Slack evidence", () => {
    const text = slackAnswer(result);
    expect(text).toBe(
      "No. Hive never indexes direct messages. Channel indexing needs an admin selection and the bot being invited [1].\n\nSources\n1. <https://gohive.dev/app/cells/lrn_abc|Hive never indexes direct messages> (Monday 12 October)",
    );
    expect(text.match(/\[1\]/g)).toHaveLength(1);
    expect(text).not.toContain("Confidence");
    expect(text).not.toContain("Gap");
    expect(text).not.toContain("As of");
  });
  it("collects multiple sources into at most one marker per sentence and lists each cell once", () => {
    const text = slackAnswer({
      ...result,
      answer: "Use [lrn_a] and [lrn_b] [lrn_a].",
      citations: [
        { id: "lrn_a", title: "Alpha", why: "A" },
        { id: "lrn_b", title: "Beta", why: "B" },
      ],
    });
    expect(text).toContain("Use and [1, 2].");
    expect(text.match(/app\/cells\/lrn_a/g)).toHaveLength(1);
    expect(text.match(/app\/cells\/lrn_b/g)).toHaveLength(1);
  });
  it("shortens long titles at a word boundary within 80 characters", () => {
    const title =
      "Hive never indexes direct messages. Channel indexing requires an admin selection and the bot being invited";
    const short = shortCitationTitle(title);
    expect(short.length).toBeLessThanOrEqual(80);
    expect(short).toMatch(/…$/);
    expect(title).toContain(short.slice(0, -1) + " ");
  });
  it.each(["medium", "low"] as const)(
    "shows %s confidence and only a real gap, without Slack pings",
    (confidence) => {
      const text = slackAnswer({
        ...result,
        answer: "Read [lrn_abc]. <!channel> <@USER>",
        confidence,
        gaps: "No release date.",
      });
      expect(text).toContain(
        confidence === "medium" ? "moderately confident" : "confidence is low",
      );
      expect(text).toContain("Gap: No release date.");
      expect(text).not.toContain("<!channel>");
      expect(text).not.toContain("<@USER>");
    },
  );
});

it("never quotes a dropped or owner-private capture", () => {
  expect(slackCaptureReply({ dropped: true, rule: "content_category" })).toBe(
    "This capture was excluded by a capture rule.",
  );
  const result = {
    id: "lrn_fixture",
    merged: false,
    pushCount: 1,
    redactions: 0,
    learning: {
      title: "private-marker",
      body: "private-body",
      captureFlagged: true,
    },
  } as import("@hivemind/core").PushResult;
  const reply = slackCaptureReply(result);
  expect(reply).toContain("Kept privately");
  expect(reply).not.toContain("private-marker");
  expect(reply).not.toContain("private-body");
});

it("projects nested gate signals without sending metadata to the numeric renderer", () => {
  expect(slackDecisionSignals({memberId: "member_fixture", source: "jev", signals: {instruction: 0.95, enough: 0.9, allowed: 1}, modelClear: true})).toEqual({instruction: 0.95, enough: 0.9, allowed: 1});
  expect(slackDecisionSignals({addressed: 0.95, humans: 0.05, label: "model", invalid: NaN, high: 3, nested: {noul: 1}})).toEqual({addressed: 0.95, humans: 0.05});
});
it.each([null, [], "model", {signals: null, modelClear: false}, {signals: {instruction: "0.9"}}])("omits gate details when no finite probabilities exist", value => {
  expect(slackDecisionSignals(value)).toBeNull();
});
