import { randomBytes } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import { memberContext } from "./enrollment";
import {
  generateJoinPhrase,
  pauseJoinPhrase,
  rotateJoinPhrase,
} from "./join-phrases";
import {
  joinOrRequest,
  joinRequestLanding,
  listJoinRequests,
  decideJoinRequest,
  maintainJoinRequests,
} from "./join-requests";
import { mcpJoin } from "./mcp-join";
import { notifyJoinRequestAdmins } from "../slack/join-request-notifications";
import {
  respondToJoinRequest,
  joinRequestTools,
} from "@/slack/tools/join-requests";
import { undoThreadAction } from "@/slack/tools/undo";
import { createTeam } from "../auth";
import { followOwnerMemberships, bindVerifiedOwner } from "./owner-bindings";

const transport = vi.hoisted(() => ({ slack: vi.fn(), email: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../slack/install", () => ({
  installation: async () => ({ token: "test-token", bot_user_id: "UBOT" }),
}));
vi.mock("../slack/client", async (original) => ({
  ...(await original<typeof import("../slack/client")>()),
  slackCall: transport.slack,
}));
vi.mock("./email", () => ({ deliverEmail: transport.email }));
vi.mock("../llm/embeddings", () => ({ embedText: async () => null }));
vi.mock("../llm/tagger", () => ({ suggestTags: async () => [] }));

describe.skipIf(!process.env.DATABASE_URL)(
  "join requests",
  { timeout: 30000 },
  () => {
    const sql = getSql();
    const suffix = randomBytes(6).toString("hex");
    const domain = `${suffix}.work.example.test`;
    const members: string[] = [];
    const teams: string[] = [];
    let admin: HiveContext, second: HiveContext, phrase: string;
    let counter = 0;
    const options = { trustedProxyIp: "198.18.90.1" };
    async function human(name = "Request Person", emailDomain = "gmail.com") {
      const id = newId("mem");
      members.push(id);
      await sql`INSERT INTO members(id,name,email,email_verified) VALUES (${id},${name},${`${id}-${suffix}@${emailDomain}`},true)`;
      const personal = (
        await sql`SELECT hive_ensure_personal_hive(${id}) AS id`
      )[0].id;
      return (await memberContext(id, personal))!;
    }
    async function request(name?: string) {
      const person = await human(name);
      const result = await joinOrRequest(
        person,
        phrase,
        options.trustedProxyIp,
      );
      expect(result.status).toBe("requested");
      return { person, id: "requestId" in result ? result.requestId! : "" };
    }
    const slackContext = (thread = "10.0001") => ({
      ...admin,
      isAdmin: true,
      channelId: "DADMIN",
      threadTs: thread,
      messageTs: `${++counter}.0001`,
      instructionText: "approve",
    });
    beforeAll(async () => {
      vi.stubEnv("TYPESAFE_API_KEY", "");
      admin = (
        await createTeam({
          teamName: `Join requests ${suffix}`,
          memberName: "Admin",
        })
      ).ctx;
      members.push(admin.memberId);
      teams.push(admin.teamId);
      await sql`UPDATE members SET email=${`admin-${suffix}@${domain}`},email_verified=true WHERE id=${admin.memberId}`;
      second = await human("Second admin", domain);
      await sql`INSERT INTO hive_memberships(member_id,team_id,role) VALUES (${second.memberId},${admin.teamId},'admin')`;
      await sql`INSERT INTO team_domains(team_id,domain,created_by) VALUES (${admin.teamId},${domain},${admin.memberId})`;
      phrase = (await generateJoinPhrase(admin)).phrase;
    });
    beforeEach(async () => {
      await sql`DELETE FROM rate_limits WHERE bucket LIKE 'join-phrase-%'`;
      transport.slack.mockReset();
      transport.email.mockReset();
      transport.email.mockResolvedValue(true);
      transport.slack.mockImplementation(
        async (
          methodToken: string,
          method: string,
          args: Record<string, string>,
        ) => {
          if (method === "users.lookupByEmail")
            return {
              user: {
                id: args.email.startsWith("admin-") ? "UADMIN" : "USECOND",
              },
            };
          if (method === "chat.postMessage")
            return {
              channel: args.channel === "UADMIN" ? "DADMIN" : "DSECOND",
              ts: `${++counter}.0001`,
            };
          return {};
        },
      );
    });
    afterAll(async () => {
      await sql`DELETE FROM hive_join_requests WHERE team_id=ANY(${teams}::text[])`;
      await sql`DELETE FROM slack_tool_actions WHERE team_id=ANY(${teams}::text[])`;
      await sql`DELETE FROM learning_pushes WHERE member_id=ANY(${members}::text[])`;
      await sql`DELETE FROM learnings WHERE member_id=ANY(${members}::text[])`;
      await sql`DELETE FROM capture_rules WHERE created_by=ANY(${members}::text[])`;
      await sql`DELETE FROM api_keys WHERE member_id=ANY(${members}::text[])`;
      await sql`DELETE FROM hive_join_capabilities WHERE team_id=ANY(${teams}::text[])`;
      await sql`DELETE FROM hive_join_phrases WHERE team_id=ANY(${teams}::text[])`;
      await sql`DELETE FROM team_domains WHERE team_id=ANY(${teams}::text[])`;
      await sql`DELETE FROM teams WHERE id=ANY(${teams}::text[])`;
      await sql`DELETE FROM members WHERE id=ANY(${members}::text[])`;
      vi.unstubAllEnvs();
      await sql.end();
    });
    it("shows outside-domain eligibility without creating a request or membership on GET", async () => {
      const person = await human();
      const landing = await joinRequestLanding(
        person,
        phrase,
        options.trustedProxyIp,
      );
      expect(landing).toMatchObject({
        automatic: false,
        joined: false,
        domains: [domain],
        requestStatus: null,
      });
      expect(
        await sql`SELECT id FROM hive_join_requests WHERE member_id=${person.memberId}`,
      ).toHaveLength(0);
      expect(
        await sql`SELECT member_id FROM hive_memberships WHERE team_id=${admin.teamId} AND member_id=${person.memberId}`,
      ).toHaveLength(0);
    });
    it("creates only a request and returns informative pending state on revisit", async () => {
      const { person, id } = await request();
      expect(
        await sql`SELECT member_id FROM hive_memberships WHERE team_id=${admin.teamId} AND member_id=${person.memberId}`,
      ).toHaveLength(0);
      expect(
        (await joinRequestLanding(person, phrase, options.trustedProxyIp))
          .requestStatus,
      ).toBe("pending");
      expect((await listJoinRequests(admin)).some((row) => row.id === id)).toBe(
        true,
      );
    });
    it("keeps allowed-domain joins automatic", async () => {
      const person = await human("Domain Person", domain);
      expect(
        await joinOrRequest(person, phrase, options.trustedProxyIp),
      ).toMatchObject({ status: "joined", teamId: admin.teamId });
      expect(
        await sql`SELECT id FROM hive_join_requests WHERE member_id=${person.memberId}`,
      ).toHaveLength(0);
      expect((await memberContext(person.memberId, admin.teamId))?.teamId).toBe(
        admin.teamId,
      );
    });
    it("collapses concurrent duplicate requests and sends exactly one DM to each admin", async () => {
      const person = await human("Duplicate");
      const results = await Promise.all([
        joinOrRequest(person, phrase, options.trustedProxyIp),
        joinOrRequest(person, phrase, options.trustedProxyIp),
      ]);
      expect(results[0]).toEqual(results[1]);
      const rows =
        await sql`SELECT id FROM hive_join_requests WHERE member_id=${person.memberId} AND status='pending'`;
      expect(rows).toHaveLength(1);
      expect(
        transport.slack.mock.calls.filter(
          (call) => call[1] === "chat.postMessage",
        ),
      ).toHaveLength(2);
      await notifyJoinRequestAdmins(String(rows[0].id));
      expect(
        transport.slack.mock.calls.filter(
          (call) => call[1] === "chat.postMessage",
        ),
      ).toHaveLength(2);
    });
    it("approves the human and follows their owned agents without publishing", async () => {
      const { person, id } = await request("Agent Owner");
      await sql.begin((tx) =>
        bindVerifiedOwner(
          tx,
          {
            sub: `join-${person.memberId}`,
            email: `${person.memberId}-${suffix}@gmail.com`,
          },
          true,
        ),
      );
      const agentId = newId("mem");
      members.push(agentId);
      await sql`INSERT INTO members(id,name,email,email_verified,actor_type) VALUES (${agentId},'Owned agent',${`${agentId}@agentmail.to`},true,'agent')`;
      await sql`INSERT INTO auth_accounts(id,user_id,account_id,provider_id,owner_sub,owner_email_verified) VALUES (${newId("auth")},${agentId},${agentId},'agentid',${`join-${person.memberId}`},true)`;
      await sql.begin((tx) => followOwnerMemberships(tx, person.memberId));
      await decideJoinRequest(admin, id, "approve");
      expect((await memberContext(person.memberId, admin.teamId))?.teamId).toBe(
        admin.teamId,
      );
      expect(
        await sql`SELECT role,owner_member_id FROM hive_memberships WHERE member_id=${agentId} AND team_id=${admin.teamId} AND removed_at IS NULL`,
      ).toMatchObject([{ role: "member", owner_member_id: person.memberId }]);
      expect(
        (await joinRequestLanding(person, phrase, options.trustedProxyIp))
          .joined,
      ).toBe(true);
      expect(
        await sql`SELECT learning_id FROM learning_shares WHERE owner_member_id=${person.memberId}`,
      ).toHaveLength(0);
    });
    it("declines without granting access and emails only one line once", async () => {
      const { person, id } = await request();
      await decideJoinRequest(admin, id, "decline");
      expect(await memberContext(person.memberId, admin.teamId)).toBeNull();
      expect(transport.email).toHaveBeenCalledTimes(1);
      expect(transport.email.mock.calls[0][2]).not.toContain("\n");
      await maintainJoinRequests();
      expect(transport.email).toHaveBeenCalledTimes(1);
      expect(
        (await joinRequestLanding(person, phrase, options.trustedProxyIp))
          .requestStatus,
      ).toBe("declined");
      await expect(
        joinOrRequest(person, phrase, options.trustedProxyIp),
      ).rejects.toMatchObject({ status: 429 });
      await sql`UPDATE hive_join_requests SET decided_at=now()-interval '7 days 1 second' WHERE id=${id}`;
      const again = await joinOrRequest(person, phrase, options.trustedProxyIp);
      expect(again.status).toBe("requested");
      expect("requestId" in again && again.requestId).not.toBe(id);
    });
    it("expires after fourteen days and permits another request", async () => {
      const { person, id } = await request();
      await sql`UPDATE hive_join_requests SET created_at=now()-interval '15 days',expires_at=now()-interval '1 second' WHERE id=${id}`;
      expect(
        (await joinRequestLanding(person, phrase, options.trustedProxyIp))
          .requestStatus,
      ).toBe("expired");
      await expect(
        decideJoinRequest(admin, id, "approve"),
      ).rejects.toMatchObject({ status: 409 });
      await maintainJoinRequests();
      expect(
        (await sql`SELECT status FROM hive_join_requests WHERE id=${id}`)[0]
          .status,
      ).toBe("expired");
      expect(
        (await joinOrRequest(person, phrase, options.trustedProxyIp)).status,
      ).toBe("requested");
    });
    it("rejects non-admin decisions and unverified requesters", async () => {
      const { person, id } = await request();
      await expect(
        decideJoinRequest({ ...person, teamId: admin.teamId }, id, "approve"),
      ).rejects.toMatchObject({ status: 403 });
      await sql`UPDATE members SET email_verified=false WHERE id=${person.memberId}`;
      await expect(
        joinOrRequest(person, phrase, options.trustedProxyIp),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        decideJoinRequest(admin, id, "approve"),
      ).rejects.toMatchObject({ status: 409 });
    });
    it("returns requested through human OAuth and needs_human for a key", async () => {
      const person = await human();
      expect(
        await mcpJoin(person, phrase, { ...options, sessionKind: "api_key" }),
      ).toMatchObject({ status: "needs_human" });
      expect(
        await sql`SELECT id FROM hive_join_requests WHERE member_id=${person.memberId}`,
      ).toHaveLength(0);
      expect(
        await mcpJoin(person, phrase, { ...options, sessionKind: "oauth" }),
      ).toEqual({ status: "requested" });
    });
    it("acts on a bare decisive DM reply and undoes it without a model call", async () => {
      const { person, id } = await request("DM Person");
      const notice = (
        await sql`SELECT thread_ts FROM hive_join_request_notifications WHERE request_id=${id} AND admin_member_id=${admin.memberId}`
      )[0];
      const ctx = slackContext(String(notice.thread_ts));
      expect(
        await respondToJoinRequest(ctx, "approve", ctx.messageTs),
      ).toMatchObject({ react: "white_check_mark" });
      expect(await memberContext(person.memberId, admin.teamId)).not.toBeNull();
      const action = (
        await sql`SELECT id,inverse FROM slack_tool_actions WHERE channel_id='DADMIN' AND message_ts=${ctx.messageTs}`
      )[0];
      expect(action.inverse.kind).toBe("join_request_decided");
      expect(
        (
          await sql`SELECT undo_action_id FROM hive_join_requests WHERE id=${id}`
        )[0].undo_action_id,
      ).toBe(action.id);
      const undoTs = `${++counter}.0001`;
      expect(
        await respondToJoinRequest(
          { ...ctx, threadTs: undoTs },
          "undo",
          undoTs,
        ),
      ).toMatchObject({ react: "white_check_mark" });
      expect(await memberContext(person.memberId, admin.teamId)).toBeNull();
      expect(
        (await sql`SELECT status FROM hive_join_requests WHERE id=${id}`)[0]
          .status,
      ).toBe("pending");
      await decideJoinRequest(admin, id, "approve");
      expect(await memberContext(person.memberId, admin.teamId)).not.toBeNull();
    });
    it("replays a Slack delivery without deciding or emailing twice", async () => {
      const { id } = await request("Replay Person");
      const ctx = {
        ...slackContext("104.001"),
        instructionText: `decline ${id}`,
      };
      const first = await joinRequestTools[0].handler(ctx, {
        decision: "decline",
        person: id,
      });
      const again = await joinRequestTools[0].handler(ctx, {
        decision: "decline",
        person: id,
      });
      expect(first).toMatchObject({ react: "white_check_mark" });
      expect(again).toEqual(first);
      expect(transport.email).toHaveBeenCalledTimes(1);
      expect(
        await sql`SELECT id FROM slack_tool_actions WHERE team_id=${admin.teamId} AND message_ts=${ctx.messageTs}`,
      ).toHaveLength(1);
    });
    it("blocks a different admin from undoing and protects a later role change", async () => {
      const { person, id } = await request("Changed Person");
      const ctx = {
        ...slackContext("105.001"),
        instructionText: `approve ${id}`,
      };
      await joinRequestTools[0].handler(ctx, {
        decision: "approve",
        person: id,
      });
      expect(
        await undoThreadAction({
          ...ctx,
          memberId: second.memberId,
          instructionText: "undo",
        }),
      ).toMatchObject({
        text: "Only the person who made this change can undo it here.",
      });
      await sql`UPDATE hive_memberships SET role='admin' WHERE member_id=${person.memberId} AND team_id=${admin.teamId}`;
      expect(
        await undoThreadAction({ ...ctx, instructionText: "undo" }),
      ).toMatchObject({ text: "This membership changed after your approval." });
    });
    it("requires an email for ambiguous names", async () => {
      await request("Same Person");
      await request("Same Name");
      const ctx = {
        ...slackContext("106.001"),
        instructionText: "approve Same",
      };
      expect(
        await joinRequestTools[0].handler(ctx, {
          decision: "approve",
          person: "Same",
        }),
      ).toMatchObject({
        text: "More than one person matches. Use their email.",
      });
    });
    it("acts on an explicit named channel approval and ignores an informational question", async () => {
      const { person } = await request(`Unique${suffix}`);
      const ctx = { ...slackContext("100.001"), channelId: "CAPP" };
      expect(
        await respondToJoinRequest(
          ctx,
          `approve Unique${suffix}`,
          ctx.messageTs,
        ),
      ).toMatchObject({ react: "white_check_mark" });
      expect(await memberContext(person.memberId, admin.teamId)).not.toBeNull();
      expect(
        await respondToJoinRequest(
          ctx,
          "how does approval work?",
          `${++counter}.0001`,
        ),
      ).toBeNull();
    });
    it("undoes a decline and blocks undo after an hour", async () => {
      const { id } = await request("Decline Person");
      const ctx = {
        ...slackContext("101.001"),
        instructionText: `decline ${id}`,
      };
      expect(
        await joinRequestTools[0].handler(ctx, {
          decision: "decline",
          person: id,
        }),
      ).toMatchObject({ react: "white_check_mark" });
      expect(
        await undoThreadAction({ ...ctx, instructionText: "undo" }),
      ).toMatchObject({ react: "white_check_mark" });
      const next = {
        ...ctx,
        messageTs: `${++counter}.0001`,
        instructionText: `approve ${id}`,
      };
      await joinRequestTools[0].handler(next, {
        decision: "approve",
        person: id,
      });
      await sql`UPDATE slack_tool_actions SET expires_at=now()-interval '1 second' WHERE team_id=${admin.teamId} AND channel_id='DADMIN' AND message_ts=${next.messageTs}`;
      expect(
        await undoThreadAction({ ...next, instructionText: "undo" }),
      ).toMatchObject({ text: "The one-hour undo window has ended." });
    });
    it("refuses to undo an approval once the person has captured into the organisation", async () => {
      const { person, id } = await request("Captured Person");
      const ctx = {
        ...slackContext("102.001"),
        instructionText: `approve ${id}`,
      };
      await joinRequestTools[0].handler(ctx, {
        decision: "approve",
        person: id,
      });
      await sql`INSERT INTO learnings(id,team_id,member_id,owner_member_id,title,body,kind,source,confidence) VALUES (${newId("lrn")},${admin.teamId},${person.memberId},${person.memberId},'Fixture capture','A fixture cell proves approval undo protects captures.','learning','codex',0.8)`;
      expect(
        await undoThreadAction({ ...ctx, instructionText: "undo" }),
      ).toMatchObject({
        text: "They have already captured into this hive, so approval cannot be undone.",
      });
      expect(await memberContext(person.memberId, admin.teamId)).not.toBeNull();
    });
    it("bounds request attempts with the phrase-join rate limits", async () => {
      const person = await human();
      for (let i = 0; i < 5; i++)
        await joinOrRequest(person, phrase, options.trustedProxyIp);
      await expect(
        joinOrRequest(person, phrase, options.trustedProxyIp),
      ).rejects.toMatchObject({ status: 429 });
      expect(
        await sql`SELECT id FROM hive_join_requests WHERE member_id=${person.memberId}`,
      ).toHaveLength(1);
    });
    it("rejects paused and retired phrases without creating requests", async () => {
      const person = await human();
      await pauseJoinPhrase(admin, true);
      await expect(
        joinOrRequest(person, phrase, options.trustedProxyIp),
      ).rejects.toMatchObject({ status: 403 });
      await pauseJoinPhrase(admin, false);
      const retired = phrase;
      phrase = (await rotateJoinPhrase(admin)).phrase;
      await expect(
        joinOrRequest(person, retired, options.trustedProxyIp),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await sql`SELECT id FROM hive_join_requests WHERE member_id=${person.memberId}`,
      ).toHaveLength(0);
    });
  },
);
