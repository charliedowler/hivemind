import { afterEach, describe, expect, it, vi } from "vitest";
import { embedText } from "./embeddings";

const create = vi.hoisted(() => vi.fn());
const options = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({ default: class { embeddings = { create }; constructor(input: unknown) { options(input); } } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("embedText", () => {
  it("skips without an API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(await embedText("test")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it("truncates input and asks for 1536 dimensions with a six-second timeout and two retries", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    create.mockResolvedValue({ data: [{ embedding: Array(1536).fill(0.1) }] });
    expect(await embedText("a".repeat(9000))).toHaveLength(1536);
    expect(create).toHaveBeenCalledWith({ model: "text-embedding-3-small", dimensions: 1536, input: "a".repeat(8000) });
    expect(options).toHaveBeenCalledWith({ apiKey: "test-only", timeout: 6000, maxRetries: 2 });
  });
  it("returns null on API failures and invalid dimensions", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-only");
    create.mockRejectedValueOnce(new Error("failure"));
    expect(await embedText("test")).toBeNull();
    create.mockResolvedValueOnce({ data: [{ embedding: [1, 2] }] });
    expect(await embedText("test")).toBeNull();
  });
});
