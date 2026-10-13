import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerHiveTools } from "./server";
import { hiveInstructions } from "./instructions";

const mocks = vi.hoisted(() => ({
  agent: vi.fn(),
  membership: vi.fn(),
  recent: vi.fn(),
  overview: vi.fn(),
  policy: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("@/server/identity/agent-enrollment", () => ({
  isAgentMember: mocks.agent,
}));
vi.mock("@/server/identity/enrollment", () => ({
  memberContext: mocks.membership,
}));
vi.mock("@/server/db/client", () => ({ getSql: () => mocks.sql }));
vi.mock("@/server/hive", () => ({
  recentLearnings: mocks.recent,
  teamOverview: mocks.overview,
}));
vi.mock("@/server/project-sharing", () => ({
  ownerCapturePolicy: mocks.policy,
}));

const actor = {
  memberId: "mem_test",
  memberName: "Person",
  teamId: "team_test",
  teamName: "Selected hive",
  sessionKind: "oauth",
};

async function rpc(method: string, params = {}, extra = actor, modern = false) {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "hive", version: "0.1.0" });
      registerHiveTools(server);
      return server;
    },
    { legacy: "stateless" },
  );
  const response = await handler.fetch(
    new Request("https://gohive.dev/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(modern
          ? { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method }
          : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: modern
          ? {
              ...params,
              _meta: {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientInfo": {
                  name: "fixture",
                  version: "1",
                },
                "io.modelcontextprotocol/clientCapabilities": {},
              },
            }
          : params,
      }),
    }),
    {
      authInfo: {
        token: "fixture",
        clientId: "fixture",
        scopes: ["hive"],
        extra,
      },
    },
  );
  const body = await response.text();
  return JSON.parse(
    body.startsWith("event:")
      ? body
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6)
      : body,
  );
}

afterEach(() => vi.resetAllMocks());

describe("MCP model-facing wire contract", () => {
  it.each([false, true])(
    "initializes with instructions for agent=%s",
    async (agent) => {
      mocks.agent.mockResolvedValue(agent);
      const response = await rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "fixture", version: "1" },
      });
      expect(response.result.instructions).toBe(hiveInstructions(agent));
      expect(
        response.result.instructions.split(/\s+/).length,
      ).toBeLessThanOrEqual(120);
      expect(response.result.capabilities).toMatchObject({
        tools: {},
        prompts: {},
        resources: {},
      });
      expect(mocks.agent).toHaveBeenCalledWith(actor.memberId);
    },
  );
  it("also returns instructions through modern discovery", async () => {
    mocks.agent.mockResolvedValue(false);
    const result = await rpc("server/discover", {}, actor, true);
    expect(result.error).toBeUndefined();
    expect(result.result.instructions).toBe(hiveInstructions(false));
    expect(result.result.supportedVersions).toContain("2026-07-28");
  });
  it("lists the prompt argument schemas and Markdown resource URIs", async () => {
    const prompts = (await rpc("prompts/list")).result.prompts;
    expect(prompts).toMatchObject([
      { name: "catch-up", arguments: [{ name: "period", required: false }] },
      { name: "ask-hive", arguments: [{ name: "question", required: true }] },
      { name: "save-this" },
    ]);
    const resources = (await rpc("resources/list")).result.resources;
    expect(
      resources.map((resource: { uri: string; mimeType: string }) => ({
        uri: resource.uri,
        mimeType: resource.mimeType,
      })),
    ).toEqual([
      { uri: "hive://overview", mimeType: "text/markdown" },
      { uri: "hive://recent", mimeType: "text/markdown" },
    ]);
  });
  it("renders catch-up from visible recent cells and the last successful read", async () => {
    mocks.membership.mockResolvedValue(actor);
    mocks.sql.mockResolvedValue([
      { occurred_at: new Date("2026-10-01T12:00:00Z") },
    ]);
    mocks.recent.mockResolvedValue([
      {
        id: "lrn_test",
        title: "Neon pooling",
        body: "Use a pool.",
        lastPushedAt: "2026-10-02T12:00:00Z",
      },
    ]);
    const result = await rpc("prompts/get", { name: "catch-up" });
    expect(mocks.recent).toHaveBeenCalledWith(
      expect.objectContaining(actor),
      expect.objectContaining({
        since: "2026-10-01T12:00:00.000Z",
        include_history: false,
      }),
    );
    expect(result.result.messages[0].content.text).toContain("lrn_test");
    expect(result.result.messages[0].content.text).toContain("Neon pooling");
  });
  it("defaults the first catch-up to 24h and honours an explicit period", async () => {
    mocks.membership.mockResolvedValue(actor);
    mocks.sql.mockResolvedValue([]);
    mocks.recent.mockResolvedValue([]);
    await rpc("prompts/get", { name: "catch-up" });
    expect(mocks.recent).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ since: "24h" }),
    );
    await rpc("prompts/get", { name: "catch-up", arguments: { period: "" } });
    expect(mocks.recent).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ since: "24h" }),
    );
    await rpc("prompts/get", { name: "catch-up", arguments: { period: "7d" } });
    expect(mocks.recent).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ since: "7d" }),
    );
    expect(
      (
        await rpc("prompts/get", {
          name: "catch-up",
          arguments: { period: "yesterday maybe" },
        })
      ).error,
    ).toBeDefined();
  });
  it("refuses a resource after membership ends before accessing its data", async () => {
    mocks.membership.mockResolvedValue(null);
    expect(
      (await rpc("resources/read", { uri: "hive://overview" })).error.message,
    ).toContain("no active membership");
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.policy).not.toHaveBeenCalled();
  });
  it("reads only the fixed selected audience and shares its invite with members", async () => {
    mocks.membership.mockResolvedValue(actor);
    mocks.overview.mockResolvedValue({
      teamName: "Selected hive",
      memberCount: 2,
      learningCount: 3,
      role: "member",
    });
    mocks.policy.mockResolvedValue({
      include: ["github.com/team/repo"],
      exclude: [],
    });
    mocks.sql.mockResolvedValue([
      {
        name: "Selected hive",
        personal_owner_member_id: null,
        join_paused: true,
        phrase: "amber-honey-fox",
      },
    ]);
    const result = await rpc("resources/read", { uri: "hive://overview" });
    expect(result.result.contents[0]).toMatchObject({
      mimeType: "text/markdown",
      text: expect.stringContaining("Chat capture: disabled"),
    });
    expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining(actor));
    expect(result.result.contents[0].text).toContain(
      "https://gohive.dev/j/amber-honey-fox",
    );
    expect(result.result.contents[0].text).toContain('"joinPaused": true');
    expect(
      (await rpc("resources/read", { uri: "hive://overview/another-hive" }))
        .error,
    ).toBeDefined();
  });
  it("lists 20 visible recent cells and makes save-this explain capture refusals", async () => {
    mocks.membership.mockResolvedValue(actor);
    mocks.recent.mockResolvedValue([{ id: "lrn_test", title: "Neon pooling" }]);
    const recent = await rpc("resources/read", { uri: "hive://recent" });
    expect(recent.result.contents[0].text).toContain("lrn_test: Neon pooling");
    expect(mocks.recent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 20, include_history: false }),
    );
    const save = await rpc("prompts/get", { name: "save-this" });
    expect(save.result.messages[0].content.text).toContain("call hive_push");
    expect(save.result.messages[0].content.text).toContain(
      "explain its exact reason",
    );
  });
});
