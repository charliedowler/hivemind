import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomBytes } from "node:crypto";
import { hivePushInput, type HiveContext } from "@hivemind/core";
import { createTeam } from "../auth";
import { getSql } from "../db/client";
import { originFor, withOrigin, type EventRow } from "../analytics/events";
import { encryptBotToken } from "./security";
import { saveSlackMessage, logDecision } from "./events";
vi.mock("../llm/embeddings", () => ({ embedText: vi.fn(async () => null) }));
afterEach(() => vi.unstubAllGlobals());
describe.skipIf(!process.env.DATABASE_URL)(
  "Slack saves and concurrent reply reservations",
  () => {
    let ctx: HiveContext;
    const channel = "CSLACKTEST";
    const token = "synthetic-token";
    beforeAll(async () => {
      vi.stubEnv(
        "SLACK_TOKEN_ENCRYPTION_KEY",
        randomBytes(32).toString("base64"),
      );
      ctx = (
        await createTeam({
          teamName: "Slack event fixture",
          memberName: "Reacting member",
        })
      ).ctx;
      const workspace = "T" + Date.now();
      await getSql()`INSERT INTO slack_installations(team_id,workspace_id,workspace_name,bot_user_id,token_ciphertext,installed_by,scopes) VALUES(${ctx.teamId},${workspace},'Fixture','UBOT',${encryptBotToken(token, ctx.teamId, workspace)},${ctx.memberId},'{}')`;
    });
    afterAll(async () => {
      const sql = getSql();
      await sql`DELETE FROM slack_jobs WHERE team_id=${ctx.teamId}`;
      await sql`DELETE FROM slack_decisions WHERE team_id=${ctx.teamId}`;
      await sql`DELETE FROM slack_installations WHERE team_id=${ctx.teamId}`;
      for (const table of [
        "feedback",
        "learning_pushes",
        "ask_log",
        "learnings",
        "api_keys",
        "web_sessions",
        "members",
      ])
        await sql`DELETE FROM ${sql(table)} WHERE ${table === "members" ? sql`id IN (SELECT member_id FROM hive_memberships WHERE team_id=${ctx.teamId})` : sql`team_id=${ctx.teamId}`}`;
      await sql`DELETE FROM teams WHERE id=${ctx.teamId}`;
      vi.unstubAllEnvs();
      await sql.end();
    });
    it("saves the exact bee-selected message once for the reacting member with a permalink", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const method = new URL(url).pathname;
          if (method.endsWith("conversations.info"))
            return Response.json({
              ok: true,
              channel: {
                id: channel,
                name: "fixture",
                is_member: true,
                is_private: false,
              },
            });
          if (method.endsWith("reactions.get"))
            return Response.json({
              ok: true,
              message: {
                ts: "1800000000.000001",
                user: "UAUTHOR",
                text: "A failed green CI run may skip useful jobs. Check individual job conclusions.",
              },
            });
          if (method.endsWith("chat.getPermalink"))
            return Response.json({
              ok: true,
              permalink: `https://example.slack.com/archives/${channel}/p1800000000000001`,
            });
          throw new Error("Unexpected request");
        }),
      );
      const result = await saveSlackMessage(
        ctx,
        token,
        channel,
        "1800000000.000001",
      );
      if (!result || result.dropped) throw new Error("Expected an accepted fixture capture");
      expect(result.learning.author.id).toBe(ctx.memberId);
      expect(result?.learning.source).toBe("slack");
      expect(result?.learning.permalink).toContain("/archives/");
      expect(result?.learning.body).toContain(
        "Check individual job conclusions",
      );
      expect(
        await saveSlackMessage(ctx, token, channel, "1800000000.000001"),
      ).toBeNull();
      const rows =
        await getSql()`SELECT count(*)::int AS count FROM learning_pushes WHERE team_id=${ctx.teamId} AND source='slack'`;
      expect(rows[0].count).toBe(1);
    });
    it("reserves one unsolicited post per thread and two per channel even under concurrency", async () => {
      const events: EventRow[] = [];
      const judgment = {
        signals: { answerable: 0.98 },
        model: "jev-1.13.0",
        latencyMs: 12,
      };
      const decide = (thread: string) =>
        withOrigin(
          originFor(ctx, "slack", "system"),
          () =>
            logDecision(
              ctx.teamId,
              channel,
              thread,
              thread,
              false,
              { decision: "reply_now", reason: "Confirmed evidence." },
              judgment,
              [],
            ),
          async (row) => {
            events.push(row);
          },
        );
      const same = await Promise.all(
        Array.from({ length: 5 }, () => decide("1800000000.000002")),
      );
      expect(same.filter((d) => d.decision === "reply_now")).toHaveLength(1);
      const separate = await Promise.all(
        ["1800000000.000003", "1800000000.000004", "1800000000.000005"].map(
          decide,
        ),
      );
      expect(separate.filter((d) => d.decision === "reply_now")).toHaveLength(
        1,
      );
      expect(events).toHaveLength(8);
      expect(
        events.every(
          (e) =>
            e.event_name === "slack.reply_decided" &&
            e.team_id === ctx.teamId &&
            e.properties.channelId === channel,
        ),
      ).toBe(true);
      expect(JSON.stringify(events)).not.toContain("Confirmed evidence.");
    });
    it("does not let a caller supply another team’s bot credential", async () => {
      await expect(
        saveSlackMessage(ctx, "other-token", channel, "1800000000.000006"),
      ).rejects.toThrow("SlackTeamTokenMismatch");
      expect(
        hivePushInput.parse({ title: "A", body: "B", source: "slack" }).source,
      ).toBe("slack");
    });
  },
);
