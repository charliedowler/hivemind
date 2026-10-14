import { afterEach, describe, expect, it, vi } from "vitest";
import { learningKinds, type SearchHit } from "@hivemind/core";
import {
  capturePreGate,
  classifyAsk,
  classifyCapture,
  classifyPush,
  decide,
  jevModel,
  repoAreas,
  pushQuestions,
  type PushAnswers,
} from "./classify";

export function answers(overrides: Partial<PushAnswers> = {}): PushAnswers {
  return {
    kind: {
      type: "choice",
      choice: "friction",
      confidence: 0.9,
      probabilities: Object.fromEntries(
        learningKinds.map((kind) => [kind, kind === "friction" ? 1 : 0]),
      ) as PushAnswers["kind"]["probabilities"],
    },
    worthSharing: { type: "noul", noul: 0.95 },
    sensitive: { type: "noul", noul: 0.01 },
    repoArea: {
      type: "choice",
      choice: "tooling",
      confidence: 0.9,
      probabilities: Object.fromEntries(
        repoAreas.map((area) => [area, area === "tooling" ? 1 : 0]),
      ) as PushAnswers["repoArea"]["probabilities"],
    },
    severity: {
      type: "score",
      score: 3,
      confidence: 0.9,
      probabilities: { "0": 0, "1": 0, "2": 0, "3": 1, "4": 0 },
      legend: {
        "0": pushQuestions.severity.criteria[0],
        "1": pushQuestions.severity.criteria[1],
        "2": pushQuestions.severity.criteria[2],
        "3": pushQuestions.severity.criteria[3],
        "4": pushQuestions.severity.criteria[4],
      },
    },
    ...overrides,
  };
}

const hit = {
  id: "lrn_fixture",
  title: "Transactional migrations",
  body: "Use the migration runner.",
  kind: "gotcha",
  tags: ["database"],
  repo: "team/repo",
  paths: [],
  confidence: 1,
  captureFlagged: false,
  captureRedacted: false,
  captureRuleIds: [],
  captureCategories: {},
  canConfirmCapture: false,
  source: "manual",
  author: { id: "mem_fixture", name: "Fixture" },
  pushCount: 1,
  votes: { up: 0, down: 0, outdated: 0 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastPushedAt: new Date().toISOString(),
  score: 0.6,
  signals: { vector: 0.7, fts: 0.2, recency: 1, votes: 0, repoMatch: false },
} satisfies SearchHit;
const facts = {
  changes: 1,
  errors: 0,
  observations: 0,
  text: "The migration needs an explicit lock timeout.",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Jev policy eval without network", () => {
  it.each(learningKinds)(
    "keeps the caller's explicit %s kind",
    (callerKind) => {
      expect(
        decide({ point: "push", callerKind, answers: answers() }).kind,
      ).toBe(callerKind);
    },
  );
  it("uses a confident suggested kind only when the caller omits it", () => {
    expect(decide({ point: "push", answers: answers() })).toMatchObject({
      kind: "friction",
      action: "accept",
      tags: ["tooling"],
      severity: 3,
      worthSharing: true,
    });
    const signals = answers();
    const uncertain = {
      ...signals,
      kind: { ...signals.kind, confidence: 0.3 },
    };
    expect(decide({ point: "push", answers: uncertain }).kind).toBe("learning");
  });
  it.each([0.8, 0.99, 1])("refuses high sensitive probability %s", (noul) => {
    expect(
      decide({
        point: "push",
        answers: answers({ sensitive: { type: "noul", noul } }),
      }).action,
    ).toBe("refuse");
  });
  it("records noise without silently discarding an intentional push", () => {
    expect(
      decide({
        point: "push",
        answers: answers({ worthSharing: { type: "noul", noul: 0.02 } }),
      }),
    ).toMatchObject({ action: "accept", worthSharing: false });
  });
  it("falls back to caller kind and no speculative tags", () => {
    expect(
      decide({ point: "push", callerKind: "insight", answers: null }),
    ).toMatchObject({
      action: "accept",
      kind: "insight",
      tags: [],
      severity: null,
    });
    expect(decide({ point: "push", answers: null }).kind).toBe("learning");
  });
  it.each([0, 0.5, 0.64])(
    "skips noisy capture probability %s",
    (probability) => {
      expect(decide({ point: "capture", facts, probability })).toBe("skip");
    },
  );
  it.each([0.65, 0.9, null])(
    "captures useful or unavailable probability %s",
    (probability) => {
      expect(decide({ point: "capture", facts, probability })).toBe("capture");
    },
  );
  it("weights a capture in the person's work areas without letting empty areas block capture", () => {
    const work = { ...facts, text: "Fixed the React hydration warning by moving the date format to the server.", workAreas: "frontend React, dbt models" };
    expect(decide({ point: "capture", facts: work, probability: 0.58 })).toBe("capture");
    expect(decide({ point: "capture", facts: { ...work, workAreas: "dbt models" }, probability: 0.58 })).toBe("skip");
    expect(decide({ point: "capture", facts: { ...work, workAreas: "" }, probability: 0.65 })).toBe("capture");
    expect(decide({ point: "capture", facts: { ...work, workAreas: "dbt models" }, probability: 0.9 })).toBe("capture");
    expect(decide({ point: "capture", facts: { ...work, workAreas: "frontend React" }, probability: 0.5 })).toBe("skip");
  });
  it("skips quiet and blank sessions regardless of a model probability", () => {
    expect(
      decide({
        point: "capture",
        facts: { ...facts, changes: 0 },
        probability: 1,
      }),
    ).toBe("skip");
    expect(capturePreGate({ ...facts, text: "" })).toBe(false);
  });
  it.each([0, 0.5, 0.69])(
    "escalates weak retrieval probability %s",
    (probability) => {
      expect(
        decide({
          point: "ask",
          question: "transactional migrations",
          hits: [hit],
          probability,
        }),
      ).toBe("gap");
    },
  );
  it("answers at the relevant threshold and never synthesizes empty retrievals", () => {
    expect(
      decide({
        point: "ask",
        question: "transactional migrations",
        hits: [hit],
        probability: 0.7,
      }),
    ).toBe("answer");
    expect(
      decide({
        point: "ask",
        question: "transactional migrations",
        hits: [],
        probability: 1,
      }),
    ).toBe("gap");
  });
  it("uses conservative evidence on outage and rejects stale cells", () => {
    expect(
      decide({
        point: "ask",
        question: "transactional migrations",
        hits: [hit],
        probability: null,
      }),
    ).toBe("answer");
    expect(
      decide({
        point: "ask",
        question: "transactional migrations",
        hits: [{ ...hit, signals: { ...hit.signals, vector: 0.31 } }],
        probability: null,
      }),
    ).toBe("gap");
    expect(
      decide({
        point: "ask",
        question: "transactional migrations",
        hits: [{ ...hit, adminOutdated: true }],
        probability: null,
      }),
    ).toBe("gap");
    expect(
      decide({
        point: "ask",
        question: "transactional migrations",
        hits: [{ ...hit, signals: { ...hit.signals, vector: null } }],
        probability: null,
      }),
    ).toBe("answer");
  });
});

describe("Jev request boundary", () => {
  it("makes no network call for quiet sessions or empty retrieval", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "fixture-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await classifyCapture({ ...facts, changes: 0 })).decision).toBe(
      "skip",
    );
    expect((await classifyAsk("unknown", [])).decision).toBe("gap");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("pins one POST with all independent push questions", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "fixture-key");
    const fetch = vi.fn(async () =>
      Response.json({
        model: jevModel,
        answers: answers(),
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await classifyPush({
      title: "Agent limits",
      body: "Usage limits block progress.",
      repo: null,
      workaround: "Switch agents",
      blocked: true,
    });
    expect(result.classification?.answers.kind.choice).toBe("friction");
    expect(result.decision.kind).toBe("friction");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(JSON.parse(String(options.body))).toMatchObject({
      model: jevModel,
      questions: {
        kind: { type: "choice" },
        sensitive: { type: "noul" },
        severity: { type: "score" },
      },
    });
  });
  it("does not retry a provider rate limit", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "fixture-key");
    const fetch = vi.fn(async () => new Response("{}", { status: 429 }));
    vi.stubGlobal("fetch", fetch);
    const result = await classifyPush({
      title: "Useful finding",
      body: "Known fix",
      repo: null,
      workaround: "",
      blocked: false,
      kind: "decision",
    });
    expect(result).toMatchObject({
      classification: null,
      decision: { kind: "decision" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("falls back on malformed probabilities", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "fixture-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          model: jevModel,
          answers: { ...answers(), sensitive: { type: "noul", noul: 9 } },
        }),
      ),
    );
    expect(
      (
        await classifyPush({
          title: "Finding",
          body: "Body",
          repo: null,
          workaround: "",
          blocked: false,
        })
      ).classification,
    ).toBeNull();
  });
});
