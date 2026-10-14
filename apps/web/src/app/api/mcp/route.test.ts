import { afterEach, describe, expect, it, vi } from "vitest";

const context = { teamId: "team_fixture", memberId: "mem_fixture", teamName: "Fixture", memberName: "Owner" };
const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/server/bearer-auth", () => ({ withHiveBearerAuth: mocks.auth }));
vi.mock("@/server/identity/agent-enrollment", () => ({ isAgentMember: vi.fn(async () => false) }));
vi.mock("@/server/identity/enrollment", () => ({ memberContext: vi.fn(), listHiveContexts: vi.fn() }));
vi.mock("@/server/db/client", () => ({ getSql: vi.fn() }));

const { GET, POST, DELETE } = await import("./route");
const signedIn = { authorization: "Bearer hm_fixture" };
const modern = (method: string, params: Record<string, unknown>) => new Request("https://gohive.dev/api/mcp", {
  method: "POST",
  headers: { ...signedIn, "content-type": "application/json", accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "fixture", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } }),
});
const messages = (body: string) => body.trimStart().startsWith("{") ? [JSON.parse(body)] : body.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));

afterEach(() => vi.resetAllMocks());

describe("MCP route", () => {
  it.each([["GET", GET], ["DELETE", DELETE]] as const)("answers a signed-in %s with 405 before resolving credentials", async (method, handler) => {
    const response = await handler(new Request("https://gohive.dev/api/mcp", { method, headers: { ...signedIn, accept: "text/event-stream" } }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("still sends a GET without credentials to the OAuth challenge", async () => {
    mocks.auth.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(new Request("https://gohive.dev/api/mcp"))).status).toBe(401);
    expect(mocks.auth).toHaveBeenCalledOnce();
  });

  it("advertises no list changes, so a listen request closes at once instead of holding the function open", async () => {
    mocks.auth.mockImplementation(async (request: Request, action: (request: Request, ctx: typeof context) => Promise<Response>) => action(request, context));
    const discovered = messages(await (await POST(modern("server/discover", {}))).text())[0];
    expect(discovered.result.capabilities).toMatchObject({ tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } });
    const listen = await POST(modern("subscriptions/listen", { notifications: { toolsListChanged: true, promptsListChanged: true, resourcesListChanged: true } }));
    const body = await Promise.race([listen.text(), new Promise<string>((_, reject) => setTimeout(() => reject(new Error("listen stream stayed open")), 2000))]);
    const [ack, complete] = messages(body);
    expect(ack.params.notifications).toEqual({});
    expect(complete.result.resultType).toBe("complete");
  });
});
