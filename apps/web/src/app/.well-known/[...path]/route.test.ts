import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(async () => Response.json({ issuer: "https://gohive.dev" })) }));
vi.mock("@/server/auth-handler", () => ({ authHandler: mocks.auth }));
const { GET, HEAD } = await import("./route");

afterEach(() => vi.clearAllMocks());

describe("well-known route", () => {
  it.each(["/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server/api/auth", "/.well-known/openid-configuration"])("serves OAuth discovery at %s", async (path) => {
    expect((await GET(new Request(`https://gohive.dev${path}`))).status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledOnce();
  });

  it.each(["/.well-known/security.txt", "/.well-known/assetlinks.json", "/.well-known/oauth-protected-resourcex"])("answers crawler probes like %s without starting auth", async (path) => {
    expect((await GET(new Request(`https://gohive.dev${path}`))).status).toBe(404);
    expect((await HEAD(new Request(`https://gohive.dev${path}`, { method: "HEAD" }))).status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});
