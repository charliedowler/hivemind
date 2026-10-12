import { describe, expect, it } from "vitest";
import {
  hiveAskInput,
  hiveFeedbackInput,
  hivePushInput,
  hiveRecentInput,
  hiveSearchInput,
} from "./schemas";

describe("hive_push", () => {
  it("parses a learning and supplies defaults", () => {
    expect(
      hivePushInput.parse({
        title: "Build the workspace",
        body: "Run the build from the root.",
      }),
    ).toEqual({
      title: "Build the workspace",
      body: "Run the build from the root.",
      blocked: false,
      tags: [],
      paths: [],
      confidence: 0.7,
      source: "manual",
    });
  });
  it("rejects an invalid learning", () => {
    expect(
      hivePushInput.safeParse({ title: "", body: "Details", confidence: 1.1 })
        .success,
    ).toBe(false);
  });
});

describe("hive_search", () => {
  it("parses a search and supplies the result limit", () => {
    expect(hiveSearchInput.parse({ query: "build failure" })).toEqual({
      query: "build failure",
      limit: 8,
    });
  });
  it("rejects an invalid search", () => {
    expect(
      hiveSearchInput.safeParse({ query: "build", limit: 26 }).success,
    ).toBe(false);
  });
});

describe("hive_ask", () => {
  it("parses a repo-scoped question", () => {
    expect(
      hiveAskInput.parse({
        question: "How do we deploy?",
        repo: "team/service",
      }),
    ).toEqual({ question: "How do we deploy?", repo: "team/service" });
  });
  it("rejects an empty question", () => {
    expect(hiveAskInput.safeParse({ question: "" }).success).toBe(false);
  });
});

describe("hive_recent", () => {
  it("supplies defaults for a catch-up", () => {
    expect(hiveRecentInput.parse({})).toEqual({ since: "24h", limit: 20 });
  });
  it.each(["7d", "24h", "2026-10-12T12:00:00Z", "2026-10-12T12:00:00+01:00"])(
    "accepts the time window %s",
    (since) => {
      expect(hiveRecentInput.parse({ since }).since).toBe(since);
    },
  );
  it("rejects an invalid time window", () => {
    expect(hiveRecentInput.safeParse({ since: "yesterday" }).success).toBe(
      false,
    );
  });
});

describe("hive_feedback", () => {
  it("parses feedback on a learning", () => {
    expect(
      hiveFeedbackInput.parse({
        id: "learning-1",
        vote: "outdated",
        note: "The command changed.",
      }),
    ).toEqual({
      id: "learning-1",
      vote: "outdated",
      note: "The command changed.",
    });
  });
  it("rejects an unsupported vote", () => {
    expect(
      hiveFeedbackInput.safeParse({ id: "learning-1", vote: "maybe" }).success,
    ).toBe(false);
  });
});

it.each([
  "learning",
  "gotcha",
  "decision",
  "snippet",
  "incident",
  "insight",
  "friction",
])("accepts the %s kind and filters", (kind) => {
  expect(
    hivePushInput.parse({
      title: "Observation",
      body: "Context",
      kind,
      area: "tool",
      cost: 12,
      blocked: true,
      workaround: "Retry",
    }).kind,
  ).toBe(kind);
  expect(hiveSearchInput.parse({ query: "observation", kind }).kind).toBe(kind);
  expect(hiveRecentInput.parse({ kind }).kind).toBe(kind);
});
it.each([-1, 1.5, 1000001])("rejects an invalid measured cost %s", (cost) =>
  expect(
    hivePushInput.safeParse({
      title: "Observation",
      body: "Context",
      kind: "friction",
      cost,
    }).success,
  ).toBe(false),
);
