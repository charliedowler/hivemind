import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { createTeam } from "@/server/auth";
import { getSql } from "@/server/db/client";
import { shareProjects, captureOwner } from "@/server/project-sharing";
import { registerHiveTools } from "./server";
import type { HiveContext } from "@hivemind/core";
import { newId } from "@/server/db/ids";
import { recordFeedback } from "@/server/feedback";

vi.mock("server-only", () => ({}));

describe.skipIf(!process.env.DATABASE_URL)(
  "MCP resources and capture audiences on PostgreSQL",
  () => {
    let a: HiveContext, b: HiveContext;
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: "hive", version: "0.1.0" });
        registerHiveTools(server);
        return server;
      },
      { legacy: "stateless" },
    );
    const sql = getSql();
    async function rpc(actor: HiveContext, method: string, params: unknown) {
      const response = await handler.fetch(
        new Request("https://gohive.dev/api/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
        {
          authInfo: {
            token: "fixture",
            clientId: "fixture",
            scopes: ["hive"],
            extra: { ...actor, sessionKind: "oauth" },
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
    beforeAll(async () => {
      a = (
        await createTeam({ teamName: "MCP audience A", memberName: "Admin A" })
      ).ctx;
      b = (
        await createTeam({ teamName: "MCP audience B", memberName: "Admin B" })
      ).ctx;
    });
    afterAll(async () => {
      await sql`DELETE FROM feedback WHERE team_id IN (${a.teamId}, ${b.teamId})`;
      await sql`DELETE FROM feedback_receipts WHERE team_id IN (${a.teamId}, ${b.teamId})`;
      await sql`DELETE FROM learnings WHERE team_id IN (${a.teamId}, ${b.teamId})`;
      await sql`DELETE FROM owner_capture_policy_history WHERE owner_member_id IN (${a.memberId}, ${b.memberId})`;
      await sql`DELETE FROM owner_capture_policies WHERE owner_member_id IN (${a.memberId}, ${b.memberId})`;
      await sql`DELETE FROM api_keys WHERE member_id IN (${a.memberId}, ${b.memberId})`;
      await sql`DELETE FROM teams WHERE id IN (${a.teamId}, ${b.teamId}) OR personal_owner_member_id IN (${a.memberId}, ${b.memberId})`;
      await sql`DELETE FROM members WHERE id IN (${a.memberId}, ${b.memberId})`;
      await sql.end();
    });
    it("cannot read another hive's overview even with a forged selected context", async () => {
      expect(
        (await rpc(a, "resources/read", { uri: "hive://overview" })).result
          .contents[0].text,
      ).toContain("MCP audience A");
      const rejected = await rpc(
        { ...a, teamId: b.teamId, teamName: b.teamName },
        "resources/read",
        { uri: "hive://overview" },
      );
      expect(rejected.error.message).toContain("no active membership");
      expect(JSON.stringify(rejected)).not.toContain("MCP audience B");
      expect(
        (
          await rpc(a, "resources/read", {
            uri: `hive://overview?teamId=${b.teamId}`,
          })
        ).error,
      ).toBeDefined();
    });
    it("returns the actual server refusal for a chat push despite a selected project", async () => {
      const personal = (await captureOwner(a)).personal;
      const overview = await rpc(personal, "resources/read", {
        uri: "hive://overview",
      });
      expect(overview.error).toBeUndefined();
      expect(overview.result.contents[0].text).toContain(
        "Chat capture: disabled",
      );
      await shareProjects(personal, {
        revision: 0,
        include: ["github.com/team/selected"],
        humanInstruction: "Select this project.",
      });
      const result = await rpc(personal, "tools/call", {
        name: "hive_push",
        arguments: {
          observation: "Chat fixture must not be stored.",
          evidence: { text: "A person asked to save this." },
        },
      });
      expect(result.result).toMatchObject({
        isError: true,
        content: [
          {
            type: "text",
            text: "Hive has no permission to capture from this project. Supply one selected, consistent repository.",
          },
        ],
      });
      expect(
        (
          await sql`SELECT count(*)::integer AS count FROM learnings WHERE member_id = ${a.memberId}`
        )[0].count,
      ).toBe(0);
    });
    it("filters other audiences, unhelpful votes and history from the recent resource", async () => {
      await sql`INSERT INTO hive_memberships (member_id, team_id) VALUES (${b.memberId}, ${a.teamId})`;
      const visible = newId("lrn"),
        hidden = newId("lrn"),
        historical = newId("lrn"),
        foreign = newId("lrn");
      for (const [id, ctx, lifecycle] of [
        [visible, a, "fresh"],
        [hidden, a, "fresh"],
        [historical, a, "outdated"],
        [foreign, b, "fresh"],
      ] as const) {
        await sql`INSERT INTO learnings (id, team_id, member_id, owner_member_id, title, body, kind, source, confidence, lifecycle) VALUES (${id}, ${ctx.teamId}, ${ctx.memberId}, ${ctx.memberId}, 'Recent fixture', 'Supported fixture memory', 'gotcha', 'manual', 1, ${lifecycle})`;
      }
      await recordFeedback(a, { id: hidden, vote: "down" });
      await recordFeedback(
        { ...b, teamId: a.teamId, teamName: a.teamName },
        { id: hidden, vote: "down" },
      );
      const recent = await rpc(a, "resources/read", { uri: "hive://recent" });
      const text = recent.result.contents[0].text;
      expect(text).toContain(visible);
      for (const id of [hidden, historical, foreign])
        expect(text).not.toContain(id);
    });
    it("persists the person's catch-up cursor without treating resource reads as catch-ups", async () => {
      await rpc(a, "prompts/get", {
        name: "catch-up",
        arguments: { period: "7d" },
      });
      const [last] =
        await sql`SELECT occurred_at FROM analytics_events WHERE member_id = ${a.memberId} AND event_name = 'recent.performed' AND request_id LIKE 'mcp-catch-up:%' ORDER BY occurred_at DESC LIMIT 1`;
      expect(last).toBeDefined();
      await rpc(a, "resources/read", { uri: "hive://recent" });
      const next = await rpc(a, "prompts/get", { name: "catch-up" });
      expect(next.result.description).toBe(
        `Team learnings since ${last.occurred_at.toISOString()}`,
      );
    });
  },
);
