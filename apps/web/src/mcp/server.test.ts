import { afterEach, describe, expect, it, vi } from "vitest";
import {
  McpServer,
  type ServerContext,
  type ToolCallback,
} from "@modelcontextprotocol/server";
import {
  hiveRecentInput,
  hiveSearchInput,
  type LearningView,
} from "@hivemind/core";
import { recentLearnings, searchLearnings } from "@/server/hive";
import { registerHiveTools } from "./server";

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
            text: `- lrn_test: Use pooled connections | fresh | Alice via ${source} | 2h ago | ${learning.repo ?? "no repo"}`,
          },
        ],
      });
      expect(await search(searchInput, toolContext)).toEqual({
        content: [
          {
            type: "text",
            text: `1. lrn_test: Use pooled connections\nfresh | gotcha | ${learning.repo ?? "no repo"} | tags: database | Alice via ${source} | 2h ago | votes: +0 / -0 / outdated 0 | score 0.75\nConnect with the pool URL.`,
          },
        ],
      });
      expect(recentLearnings).toHaveBeenCalledWith(context, recentInput);
      expect(searchLearnings).toHaveBeenCalledWith(context, searchInput);
    },
  );
});
