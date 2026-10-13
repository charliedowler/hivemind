import { afterEach, describe, expect, it, vi } from "vitest";
import {
  McpServer,
  type ServerContext,
  type ToolCallback,
} from "@modelcontextprotocol/server";
import {
  hiveShareProjectsInput,
  hiveJoinInput,
  hivePushInput,
  hiveReadInput,
  hiveRecentInput,
  hiveSearchInput,
  type LearningView,
} from "@hivemind/core";
import { pushLearning, recentLearnings, searchLearnings, recordFeedback } from "@/server/hive";
import {shareProjects} from "@/server/project-sharing";
import {mcpJoin} from "@/server/identity/mcp-join";
import {readKnowledge} from "@/server/knowledge-tree";
import { reverseDecision } from "@/server/conflict-decisions";
import { HiveError } from "@/server/errors";
import { z } from "zod";
import { registerHiveTools } from "./server";

vi.mock("@/server/project-sharing", () => ({shareProjects: vi.fn()}));
vi.mock("@/server/identity/mcp-join", () => ({mcpJoin: vi.fn()}));

vi.mock("@/server/knowledge-tree", () => ({browseKnowledge: vi.fn(), readKnowledge: vi.fn(), snapshotKnowledge: vi.fn()}));

vi.mock("@/server/conflict-decisions", () => ({ reverseDecision: vi.fn() }));

vi.mock("@/server/hive", () => ({
  askHive: vi.fn(),
  pushLearning: vi.fn(),
  searchLearnings: vi.fn(),
  recentLearnings: vi.fn(),
  recordFeedback: vi.fn(),
}));

const context = {
  teamId: "team_test",
  teamName: "Test team",
  memberId: "mem_test",
  memberName: "Alice",
};
const toolContext: ServerContext = {
  mcpReq: {
    id: 1,
    method: "tools/call",
    requestState: () => undefined,
    signal: new AbortController().signal,
    send: vi.fn(),
    notify: vi.fn(),
    log: vi.fn(),
    elicitInput: vi.fn(),
    requestSampling: vi.fn(),
  },
  http: {
    authInfo: { token: "test", clientId: "test", scopes: [], extra: context },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MCP learning text", () => {
  it("returns a structured, silently accepted capture drop", async () => {
    vi.mocked(pushLearning).mockResolvedValue({dropped: true, rule: "repo_owner"});
    const server = new McpServer({name: "test", version: "1.0.0"});
    const registerTool = vi.spyOn(server, "registerTool");
    registerHiveTools(server);
    const push = registerTool.mock.calls.find(([name]) => name === "hive_push")![2] as ToolCallback<typeof hivePushInput>;
    const result = await push(hivePushInput.parse({title: "Excluded fixture", body: "Private fixture"}), toolContext);
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{type: "text", text: JSON.stringify({dropped: true, rule: "repo_owner"})}]);
  });
  it.each(["codex", "claude-code", "manual"] as const)(
    "shows the author and %s source in recent and search results",
    async (source) => {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-12T12:00:00Z"));
      const learning: LearningView = {
        id: "lrn_test",
        title: "Use pooled connections",
        body: "Connect with the pool URL.",
        kind: "gotcha",
        tags: ["database"],
        repo: source === "manual" ? null : "team/service",
        paths: [],
        confidence: 1,
        captureFlagged: false,
        captureRedacted: false,
        captureRuleIds: [],
        captureCategories: {},
        canConfirmCapture: false,
        source,
        author: { id: context.memberId, name: context.memberName },
        pushCount: 1,
        votes: { up: 0, down: 0, outdated: 0 },
        createdAt: "2026-10-12T10:00:00Z",
        updatedAt: "2026-10-12T10:00:00Z",
        lastPushedAt: "2026-10-12T10:00:00Z",
      };
      vi.mocked(recentLearnings).mockResolvedValue([learning]);
      vi.mocked(searchLearnings).mockResolvedValue([
        {
          ...learning,
          score: 0.75,
          signals: {
            vector: null,
            fts: 1,
            recency: 1,
            votes: 0,
            repoMatch: false,
          },
        },
      ]);
      const server = new McpServer({ name: "test", version: "1.0.0" });
      const registerTool = vi.spyOn(server, "registerTool");
      registerHiveTools(server);
      const recent = registerTool.mock.calls.find(
        ([name]) => name === "hive_recent",
      )![2] as ToolCallback<typeof hiveRecentInput>;
      const search = registerTool.mock.calls.find(
        ([name]) => name === "hive_search",
      )![2] as ToolCallback<typeof hiveSearchInput>;
      const recentInput = hiveRecentInput.parse({ since: "1d" });
      const searchInput = hiveSearchInput.parse({ query: "connections" });

      expect(await recent(recentInput, toolContext)).toEqual({
        content: [
          {
            type: "text",
            text: `- lrn_test: Use pooled connections | Alice via ${source} | 2h ago | ${learning.repo ?? "no repo"}`,
          },
        ],
      });
      expect(await search(searchInput, toolContext)).toEqual({
        content: [
          {
            type: "text",
            text: `1. lrn_test: Use pooled connections\nlearning | ${learning.repo ?? "no repo"} | tags: database | Alice via ${source} | 2h ago | votes: +0 / -0 / outdated 0 | score 0.75\nConnect with the pool URL.`,
          },
        ],
      });
      expect(recentLearnings).toHaveBeenCalledWith(context, recentInput);
      expect(searchLearnings).toHaveBeenCalledWith(context, searchInput);
    },
  );
});


it("exposes decision reversal by ID and returns the guarded inverse receipt", async () => {
  const schema = z.object({ decision_id: z.string() });
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const register = vi.spyOn(server, "registerTool");
  registerHiveTools(server);
  const call = register.mock.calls.find(([name]) => name === "hive_reverse_decision")?.[2] as ToolCallback<typeof schema>;
  expect(call).toBeDefined();
  vi.mocked(reverseDecision).mockResolvedValue({ id: "dec_inverse", decision: "reversed", reason: "Audit" });
  expect(await call({ decision_id: "dec_target" }, toolContext)).toMatchObject({ content: [{ text: "dec_inverse: Cell change reversed." }] });
  expect(reverseDecision).toHaveBeenCalledWith(context, "dec_target", undefined, undefined, "through MCP");
  vi.mocked(reverseDecision).mockRejectedValue(new HiveError("A cell changes after this decision.", 409));
  expect(await call({ decision_id: "dec_inverse" }, toolContext)).toMatchObject({ isError: true, content: [{ text: expect.stringContaining("changes") }] });
});

it("returns the full saved capture and its inferred fields", async () => {
  const server = new McpServer({name: "test", version: "1.0.0"});
  const register = vi.spyOn(server, "registerTool");
  registerHiveTools(server);
  const call = register.mock.calls.find(([name]) => name === "hive_push")![2] as ToolCallback<typeof hivePushInput>;
  const input = hivePushInput.parse({observation: "A fact from a failing build", context: {agent: "codex", repo: "team/widget"}});
  const saved = {id: "lrn_aaaaaaaaaaaa", merged: false, pushCount: 1, redactions: 0, learning: {title: "A fact from a failing build", blocked: null, cost: null}, inferred: {kind: "gotcha"}, correction: {id: "lrn_aaaaaaaaaaaa", revision: 1, tool: "hive_correct"}};
  vi.mocked(pushLearning).mockResolvedValue(saved as unknown as Awaited<ReturnType<typeof pushLearning>>);
  const result = await call(input, toolContext);
  expect(JSON.parse((result as {content: {text: string}[]}).content[0]!.text)).toEqual({...saved, cellUrl: "/app/cells/lrn_aaaaaaaaaaaa"});
  expect(pushLearning).toHaveBeenCalledWith(context, expect.objectContaining({source: "codex", agent: "codex", observation: input.observation}));
  expect(register.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining(["hive_correct", "hive_outcome"]));
});

it("never casts feedback when reading the knowledge tree", async () => {
  const server = new McpServer({name: "test", version: "1.0.0"});
  const register = vi.spyOn(server, "registerTool");
  registerHiveTools(server);
  const call = register.mock.calls.find(([name]) => name === "hive_read")![2] as ToolCallback<typeof hiveReadInput>;
  vi.mocked(readKnowledge).mockResolvedValue({revision: 1, path: "INDEX.md", content: "A saved fact"});
  vi.mocked(recordFeedback).mockClear();
  expect(await call({path: "INDEX.md"}, toolContext)).toMatchObject({content: [{text: "Revision 1: INDEX.md\n\nA saved fact"}]});
  expect(recordFeedback).not.toHaveBeenCalled();
});


it("registers bounded owner-free project selection and returns one line", async () => {
  const server = new McpServer({name: "test", version: "1"});
  const registered = vi.spyOn(server, "registerTool");
  registerHiveTools(server);
  const callback = registered.mock.calls.find(([name]) => name === "hive_share_projects")![2] as ToolCallback<typeof hiveShareProjectsInput>;
  vi.mocked(shareProjects).mockResolvedValue({include: ["github.com/team/repo"], exclude: [], revision: 1});
  const input = hiveShareProjectsInput.parse({include: ["https://github.com/team/repo.git"], revision: 0, humanInstruction: "Only this repository."});
  const result = await callback(input, toolContext);
  expect(result.content).toEqual([{type: "text", text: '{"include":["github.com/team/repo"],"exclude":[],"revision":1}'}]);
  expect(hiveShareProjectsInput.safeParse({ownerId: "another", revision: 0}).success).toBe(false);
  expect(hiveShareProjectsInput.safeParse({include: Array(101).fill("team/repo"), revision: 0}).success).toBe(false);
  expect(hiveShareProjectsInput.safeParse({revision: -1}).success).toBe(false);
});

it("returns the sole human join blocker and passes only the boundary's trusted IP", async () => {
  const server = new McpServer({name: "test", version: "1"});
  const registered = vi.spyOn(server, "registerTool");
  registerHiveTools(server);
  const callback = registered.mock.calls.find(([name]) => name === "hive_join")![2] as ToolCallback<typeof hiveJoinInput>;
  vi.mocked(mcpJoin).mockResolvedValue({status: "needs_human", joinUrl: "https://gohive.dev/j/amber-honey-fox"});
  const requestContext = {...toolContext, http: {...toolContext.http, req: {headers: new Headers({"x-forwarded-for": "203.0.113.1"})}}} as ServerContext;
  const result = await callback({phrase: "amber-honey-fox"}, requestContext);
  expect(result.content).toEqual([{type: "text", text: '{"status":"needs_human","joinUrl":"https://gohive.dev/j/amber-honey-fox"}'}]);
  expect(mcpJoin).toHaveBeenCalledWith(expect.objectContaining(context), "amber-honey-fox", {trustedProxyIp: null, sessionKind: undefined});
  expect(hiveJoinInput.safeParse({phrase: "amber-honey-fox", ownerSaysYes: true}).success).toBe(false);
});
