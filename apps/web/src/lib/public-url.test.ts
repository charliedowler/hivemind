import { afterEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { publicUrl } from "./public-url";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("public URL", () => {
  it("uses PUBLIC_URL without reading request headers", async () => {
    vi.stubEnv("PUBLIC_URL", "https://gohive.dev///");
    await expect(publicUrl()).resolves.toBe("https://gohive.dev");
    expect(headers).not.toHaveBeenCalled();
  });

  it.each([
    [{ host: "hive.example" }, "https://hive.example"],
    [{ host: "localhost:4340" }, "http://localhost:4340"],
    [{ host: "127.0.0.1:4340" }, "http://127.0.0.1:4340"],
    [
      {
        host: "internal:3000",
        "x-forwarded-host": "hive.example",
        "x-forwarded-proto": "https",
      },
      "https://hive.example",
    ],
    [
      { host: "hive.example", "x-forwarded-proto": "http" },
      "http://hive.example",
    ],
  ])("falls back to the request origin %j", async (values, expected) => {
    vi.stubEnv("PUBLIC_URL", "");
    vi.mocked(headers).mockResolvedValue(
      new Headers(values) as Awaited<ReturnType<typeof headers>>,
    );
    await expect(publicUrl()).resolves.toBe(expected);
  });
});
