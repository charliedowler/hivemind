import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { createTeam } from "@/server/auth";
import { getSql } from "@/server/db/client";
import { shareProjects, captureOwner } from "@/server/project-sharing";
import { registerHiveTools } from "./server";
import type { HiveContext } from "@hivemind/core";
import { withCredentialScope } from "@/server/identity/credential-scope";
import { newId } from "@/server/db/ids";
import {
  generateJoinPhrase,
  pauseJoinPhrase,
  rotateJoinPhrase,
} from "@/server/identity/join-phrases";
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
    async function rpc(
      actor: HiveContext,
      method: string,
      params: unknown,
      sessionKind: "oauth" | "api_key" = "oauth",
    ) {
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
            extra: { ...actor, sessionKind },
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
      await sql`DELETE FROM hive_join_phrases WHERE team_id IN (${a.teamId}, ${b.teamId})`;
      await sql`DELETE FROM team_domains WHERE team_id IN (${a.teamId}, ${b.teamId})`;
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
    it("returns a personal hive's team-creation hint through the tool and overview", async () => {
      const personal = (await captureOwner(a)).personal;
      const result = await rpc(personal, "tools/call", {
        name: "hive_invite_link",
        arguments: {},
      });
      expect(JSON.parse(result.result.content[0].text)).toEqual({
        joinUrl: null,
        hint: "Create a hive for your team at https://gohive.dev/app/account",
      });
      const overview = await rpc(personal, "resources/read", {
        uri: "hive://overview",
      });
      expect(overview.result.contents[0].text).toContain(
        "Create a hive for your team at https://gohive.dev/app/account",
      );
    });
    it("lists a strict input-free invite tool and rejects non-members", async () => {
      const tools = (await rpc(a, "tools/list", {})).result.tools;
      expect(
        tools.find((tool: { name: string }) => tool.name === "hive_invite_link")
          .inputSchema,
      ).toMatchObject({
        type: "object",
        properties: {},
        additionalProperties: false,
      });
      const refused = await rpc({ ...b, teamId: a.teamId }, "tools/call", {
        name: "hive_invite_link",
        arguments: {},
      });
      expect(refused.result.isError).toBe(true);
      expect(refused.result.content[0].text).toContain("no active membership");
      expect(JSON.stringify(refused)).not.toContain("MCP audience A");
    });
    it("lets members and agents read current links and reflects pause and rotation", async () => {
      await sql`INSERT INTO hive_memberships (member_id, team_id, role) VALUES (${b.memberId}, ${a.teamId}, 'member')`;
      const member = { ...b, teamId: a.teamId, teamName: a.teamName };
      const phrase = await generateJoinPhrase(a);
      const joinUrl = `https://gohive.dev/j/${phrase.phrase}`;
      const read = async () =>
        JSON.parse(
          (
            await rpc(member, "tools/call", {
              name: "hive_invite_link",
              arguments: {},
            })
          ).result.content[0].text,
        );
      expect(await read()).toEqual({
        teamName: a.teamName,
        joinUrl,
        invitePrompt: `Set me up on Hive and join the ${a.teamName} hive: read https://gohive.dev/agent and follow it, then join with ${joinUrl}`,
        joinPaused: true,
      });
      await sql`INSERT INTO team_domains (domain, team_id, created_by) VALUES (${`mcp${a.teamId.replace(/[^a-z0-9]/g, "")}.com`}, ${a.teamId}, ${a.memberId})`;
      await pauseJoinPhrase(a, false);
      expect((await read()).joinPaused).toBe(false);
      await sql`UPDATE members SET actor_type = 'agent' WHERE id = ${b.memberId}`;
      expect((await read()).joinUrl).toBe(joinUrl);
      await sql`UPDATE members SET actor_type = 'human' WHERE id = ${b.memberId}`;
      const rotated = await rotateJoinPhrase(a);
      expect((await read()).joinUrl).toBe(
        `https://gohive.dev/j/${rotated.phrase}`,
      );
      await pauseJoinPhrase(a, true);
      const overview = await rpc(member, "resources/read", {
        uri: "hive://overview",
      });
      expect(overview.result.contents[0].text).toContain(
        `https://gohive.dev/j/${rotated.phrase}`,
      );
      expect(overview.result.contents[0].text).toContain('"joinPaused": true');
    });
    it("returns every valid organisation invitation only for trusted person-wide credentials", async () => {
      const personal = (await captureOwner(b)).personal;
      await generateJoinPhrase(b);
      const invite = async (wide = false, selected = personal) =>
        withCredentialScope(selected.memberId, wide, () =>
          rpc(selected, "tools/call", {
            name: "hive_invite_link",
            arguments: {},
          }),
        );
      const scoped = JSON.parse((await invite()).result.content[0].text);
      expect(scoped).toEqual({
        joinUrl: null,
        hint: "Create a hive for your team at https://gohive.dev/app/account",
      });
      const person = JSON.parse((await invite(true)).result.content[0].text);
      expect(
        person.invitations
          .map((entry: { teamId: string }) => entry.teamId)
          .sort(),
      ).toEqual([a.teamId, b.teamId].sort());
      expect(person).not.toHaveProperty("hint");
      expect(person).not.toHaveProperty("joinUrl");
      for (const entry of person.invitations) {
        expect(entry).toMatchObject({
          teamName: expect.any(String),
          joinUrl: expect.stringContaining("https://gohive.dev/j/"),
          invitePrompt: expect.stringContaining(
            "Set me up on Hive and join the ",
          ),
          joinPaused: true,
        });
      }
      const overview = await withCredentialScope(personal.memberId, true, () =>
        rpc(personal, "resources/read", { uri: "hive://overview" }),
      );
      for (const entry of person.invitations)
        expect(overview.result.contents[0].text).toContain(entry.joinUrl);
      expect(
        JSON.parse((await invite(false, b)).result.content[0].text),
      ).not.toHaveProperty("invitations");
      const singlePersonal = (await captureOwner(a)).personal;
      const single = JSON.parse(
        (
          await withCredentialScope(a.memberId, true, () =>
            rpc(singlePersonal, "tools/call", {
              name: "hive_invite_link",
              arguments: {},
            }),
          )
        ).result.content[0].text,
      );
      expect(single.invitations).toHaveLength(1);
      expect(single).toMatchObject(single.invitations[0]);
      const apiKey = await rpc(
        b,
        "tools/call",
        { name: "hive_invite_link", arguments: {} },
        "api_key",
      );
      expect(JSON.parse(apiKey.result.content[0].text)).toMatchObject({
        teamName: b.teamName,
      });
      expect(JSON.parse(apiKey.result.content[0].text)).not.toHaveProperty(
        "invitations",
      );
      await sql`UPDATE hive_memberships SET removed_at = now() WHERE member_id = ${b.memberId} AND team_id IN (${a.teamId}, ${b.teamId})`;
      const none = JSON.parse((await invite(true)).result.content[0].text);
      expect(none).toEqual({
        invitations: [],
        joinUrl: null,
        hint: "Create a hive for your team at https://gohive.dev/app/account",
      });
      await sql`UPDATE hive_memberships SET removed_at = NULL WHERE member_id = ${b.memberId} AND team_id IN (${a.teamId}, ${b.teamId})`;
    });
    it("does not trust a person-wide flag supplied in MCP auth metadata", async () => {
      const personal = (await captureOwner(a)).personal;
      const forged = await rpc(
        { ...personal, personWide: true } as HiveContext,
        "tools/call",
        { name: "hive_invite_link", arguments: {} },
      );
      expect(JSON.parse(forged.result.content[0].text)).toEqual({
        joinUrl: null,
        hint: "Create a hive for your team at https://gohive.dev/app/account",
      });
    });
    it("filters other audiences, unhelpful votes and history from the recent resource", async () => {
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
