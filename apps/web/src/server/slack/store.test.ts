import {
  beforeAll,
  afterAll,
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "vitest";
import { randomBytes } from "node:crypto";
import type { HiveContext } from "@hivemind/core";
import { createTeam } from "../auth";
import { getSql } from "../db/client";
import { encryptBotToken } from "./security";
import { storeMessage, changeChannel, channelPermission } from "./store";
import { searchSlack, getSlackMessage } from "./search";
import { resolveActor } from "./install";

vi.mock("../llm/embeddings", () => ({ embedText: vi.fn(async () => null) }));
afterEach(() => vi.unstubAllGlobals());
describe.skipIf(!process.env.DATABASE_URL)(
  "Slack database isolation and consent",
  () => {
    let a: HiveContext, b: HiveContext;
    const workspace = "T" + Date.now();
    function slack() {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const path = new URL(url);
          if (path.pathname.endsWith("conversations.info"))
            return Response.json({
              ok: true,
              channel: {
                id: path.searchParams.get("channel"),
                name: "test",
                is_member: true,
                is_private: path.searchParams.get("channel") === "GPRIVATE",
                is_im: false,
                is_mpim: false,
                is_archived: false,
              },
            });
          if (path.pathname.endsWith("users.info"))
            return Response.json({
              ok: true,
              user: {
                profile: {
                  email: `slack-${workspace.toLowerCase()}@example.test`,
                },
              },
            });
          if (path.pathname.endsWith("chat.getPermalink"))
            return Response.json({
              ok: true,
              permalink:
                "https://example.slack.com/archives/CSELECTED/p1800000000000000",
            });
          throw new Error("Unexpected Slack method");
        }),
      );
    }
    beforeAll(async () => {
      vi.stubEnv(
        "SLACK_TOKEN_ENCRYPTION_KEY",
        randomBytes(32).toString("base64"),
      );
      a = (
        await createTeam({
          teamName: "Slack integration A",
          memberName: "Selected member",
        })
      ).ctx;
      b = (
        await createTeam({
          teamName: "Slack integration B",
          memberName: "Other member",
        })
      ).ctx;
      const sql = getSql();
      await sql`UPDATE members SET email=${`slack-${workspace.toLowerCase()}@example.test`},email_verified=true WHERE id=${a.memberId} AND team_id=${a.teamId}`;
      await sql`INSERT INTO slack_installations(team_id,workspace_id,workspace_name,bot_user_id,token_ciphertext,installed_by,scopes) VALUES(${a.teamId},${workspace},'Fixture','UBOT',${encryptBotToken("synthetic-token", a.teamId, workspace)},${a.memberId},'{}')`;
      for (const [id, priv, state] of [
        ["CSELECTED", false, "enabled"],
        ["GPRIVATE", true, "enabled"],
        ["COFF", false, "purged"],
      ] as const)
        await sql`INSERT INTO slack_channels(team_id,channel_id,name,private,state)VALUES(${a.teamId},${id},${id},${priv},${state})`;
    });
    afterAll(async () => {
      const sql = getSql();
      await sql`DELETE FROM slack_installations WHERE team_id=${a.teamId}`;
      await sql`DELETE FROM slack_actor_links WHERE team_id=${a.teamId}`;
      for (const table of ["api_keys", "web_sessions", "members", "teams"]) {
        if (table === "teams")
          await sql`DELETE FROM teams WHERE id=ANY(${[a.teamId, b.teamId]}::text[])`;
        else
          await sql`DELETE FROM ${sql(table)} WHERE team_id=ANY(${[a.teamId, b.teamId]}::text[])`;
      }
      vi.unstubAllEnvs();
      await sql.end();
    });
    it("does not store messages from unselected channels and never uses another team consent", async () => {
      slack();
      const message = {
        user: "UACTOR",
        ts: "1800000000.000001",
        text: "Aardvark channel evidence",
      };
      expect(await storeMessage(a.teamId, "COFF", message)).toBe(false);
      expect(await storeMessage(b.teamId, "CSELECTED", message)).toBe(false);
      expect(await storeMessage(a.teamId, "CSELECTED", message)).toBe(true);
      expect(await searchSlack(b, { query: "aardvark", limit: 8 })).toEqual([]);
      const hits = await searchSlack(a, { query: "aardvark", limit: 8 });
      expect(hits).toHaveLength(1);
      expect(hits[0].source).toBe("slack");
      expect(hits[0].permalink).toContain(".slack.com/archives/");
      expect(await getSlackMessage(b, hits[0].id)).toBeNull();
      await expect(
        changeChannel(b, "CSELECTED", "purge"),
      ).rejects.toMatchObject({ status: 404 });
    });
    it("excludes private evidence from replies in public channels", async () => {
      slack();
      await storeMessage(a.teamId, "GPRIVATE", {
        user: "UACTOR",
        ts: "1800000000.000002",
        text: "Private platypus deployment evidence",
      });
      expect(
        await searchSlack(a, { query: "platypus", limit: 8 }, true),
      ).toEqual([]);
      expect(
        await searchSlack(a, { query: "platypus", limit: 8 }),
      ).toHaveLength(1);
    });
    it("links a verified same-team email and refuses an email from another team", async () => {
      slack();
      expect(
        (await resolveActor(a.teamId, "UACTOR", "synthetic-token"))?.memberId,
      ).toBe(a.memberId);
      expect(
        await resolveActor(b.teamId, "UACTOR", "synthetic-token"),
      ).toBeNull();
    });
    it("keeps paused history searchable, but purge prevents a stale worker from restoring it", async () => {
      slack();
      const original = await channelPermission(a.teamId, "CSELECTED", true);
      await changeChannel(a, "CSELECTED", "stop");
      expect(
        await storeMessage(a.teamId, "CSELECTED", {
          user: "UACTOR",
          ts: "1800000000.000003",
          text: "Aardvark update",
        }),
      ).toBe(false);
      expect(
        await searchSlack(a, { query: "aardvark", limit: 8 }),
      ).toHaveLength(1);
      await changeChannel(a, "CSELECTED", "purge");
      await changeChannel(a, "CSELECTED", "enable");
      expect(
        await storeMessage(
          a.teamId,
          "CSELECTED",
          {
            user: "UACTOR",
            ts: "1800000000.000004",
            text: "Aardvark stale job",
          },
          Number(original!.generation),
        ),
      ).toBe(false);
      expect(await searchSlack(a, { query: "aardvark", limit: 8 })).toEqual([]);
    });
  },
);
