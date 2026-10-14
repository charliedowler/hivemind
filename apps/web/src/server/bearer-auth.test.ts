import { afterEach, describe, expect, it, vi } from "vitest";
import type { HiveContext } from "@hivemind/core";
import { apiKeyId, bindApiKey, bindRole, memberRole } from "./analytics/events";
import { forgetCachedAuth } from "./auth-cache";

const mocks = vi.hoisted(() => ({ apiKey: vi.fn(), agent: vi.fn() }));
vi.mock("./better-auth", () => ({ getAuth: vi.fn(), mcpResource: vi.fn() }));
vi.mock("./auth", () => ({ authenticateApiKey: mocks.apiKey }));
vi.mock("./identity/agent-credentials", () => ({ authenticateAgentCredential: mocks.agent }));
vi.mock("./identity/enrollment", () => ({ memberContext: vi.fn(), personalMemberContext: vi.fn() }));
vi.mock("./db/client", () => ({ getSql: vi.fn() }));

const { withHiveBearerAuth } = await import("./bearer-auth");
const apiKey = `hm_${"a".repeat(43)}`;
const agentKey = `ha_${"b".repeat(43)}`;
const request = (token: string) => new Request("https://gohive.dev/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}` } });
const fixture = (): HiveContext => bindApiKey(bindRole({ memberId: "mem_aaaaaaaaaaaa", memberName: "A", teamId: "team_aaaaaaaaaaaa", teamName: "T" }, "admin"), "key_aaaaaaaaaaaa");

afterEach(() => {
  forgetCachedAuth();
  vi.resetAllMocks();
});

describe("bearer auth cache", () => {
  it("resolves an API key once per window and keeps its role and key id on every copy", async () => {
    mocks.apiKey.mockImplementation(async () => fixture());
    const seen: HiveContext[] = [];
    for (let i = 0; i < 3; i++) await withHiveBearerAuth(request(apiKey), async (_req, ctx) => (seen.push(ctx), Response.json({})));
    expect(mocks.apiKey).toHaveBeenCalledTimes(1);
    expect(new Set(seen).size).toBe(3);
    for (const ctx of seen) expect([memberRole(ctx), apiKeyId(ctx)]).toEqual(["admin", "key_aaaaaaaaaaaa"]);
  });

  it("keeps different credentials apart and rechecks after a revocation in this process", async () => {
    mocks.agent.mockImplementation(async () => fixture());
    const ok = async () => Response.json({ ok: true });
    expect((await withHiveBearerAuth(request(agentKey), ok)).status).toBe(200);
    expect((await withHiveBearerAuth(request(agentKey.replace("b", "c")), ok)).status).toBe(200);
    expect((await withHiveBearerAuth(request(agentKey), ok)).status).toBe(200);
    expect(mocks.agent).toHaveBeenCalledTimes(2);
    forgetCachedAuth();
    mocks.agent.mockResolvedValue(null);
    expect((await withHiveBearerAuth(request(agentKey), ok)).status).toBe(401);
  });
});
