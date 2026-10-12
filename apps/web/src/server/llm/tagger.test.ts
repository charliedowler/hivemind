import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { suggestTags } from "./tagger";

const { parse, createClient } = vi.hoisted(() => ({
  parse: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function (options) {
    createClient(options);
    return { messages: { parse } };
  }),
}));

const learning = {
  title: "Use pooled connections",
  body: "Connect with the pool URL.",
  kind: "gotcha" as const,
  repo: "team/service",
};

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  parse.mockReset();
  createClient.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("suggestTags", () => {
  it("deduplicates, lowercases, validates and limits tags", async () => {
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        tags: [
          "Postgres",
          " postgres ",
          "connection-pool",
          "x",
          "a".repeat(31),
          "invalid space",
          "-leading",
          "trailing-",
          "two--hyphens",
          "node-24",
          "devex",
          "database",
          "sixth",
        ],
      },
    });
    expect(await suggestTags(learning)).toEqual([
      "postgres",
      "connection-pool",
      "node-24",
      "devex",
      "database",
    ]);
    expect(createClient).toHaveBeenCalledWith({
      timeout: 15_000,
      maxRetries: 0,
    });
    const request = parse.mock.calls[0][0];
    expect(request).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 1024,
      output_config: { effort: "low", format: { type: "json_schema" } },
    });
    expect(request).not.toHaveProperty("temperature");
  });

  it("truncates the body to 3000 characters", async () => {
    parse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { tags: [] },
    });
    await suggestTags({ ...learning, body: "x".repeat(4000) });
    expect(
      JSON.parse(parse.mock.calls[0][0].messages[0].content).body,
    ).toHaveLength(3000);
  });

  it.each(["refusal", "max_tokens"])(
    "returns no tags on %s before reading output",
    async (stop_reason) => {
      parse.mockResolvedValue({
        stop_reason,
        get parsed_output() {
          throw new Error("Must not read");
        },
      });
      expect(await suggestTags(learning)).toEqual([]);
    },
  );

  it.each([null, { tags: [1] }])(
    "returns no tags on invalid output",
    async (parsed_output) => {
      parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output });
      expect(await suggestTags(learning)).toEqual([]);
    },
  );

  it("returns no tags on a network error", async () => {
    parse.mockRejectedValue(new Error("Connection failed"));
    expect(await suggestTags(learning)).toEqual([]);
  });

  it("does not create a client when the key is absent", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await suggestTags(learning)).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });
});
