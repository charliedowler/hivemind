import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTeam, authenticateApiKey, joinTeam } from "../auth";
import { getSql } from "../db/client";
import { randomBase32, hashToken } from "../db/ids";
import { sendEmailCode, completeEmailCode } from "./email-verification";
import {
  allowDomain,
  requireAdmin,
  removeMember,
  revokeKey,
  rotateInvite,
  moderateLearning,
} from "./access";
import { isPublicDomain } from "./email-domain";
import { deliverCode } from "./email";
import { hivePushInput, type HiveContext } from "@hivemind/core";
import { pushLearning, getLearning } from "../hive";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("../llm/embeddings", () => ({ embedText: async () => null }));
it.each([
  "gmail.com",
  "outlook.com",
  "icloud.com",
  "yahoo.co.uk",
  "proton.me",
  "mail.gmail.com",
  "tenant.onmicrosoft.com",
])("blocks public domain %s", (domain) =>
  expect(isPublicDomain(domain)).toBe(true),
);
it("switches email off without config and hides delivery errors", async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(await deliverCode("fixture@example.test", "123456", "fixture")).toBe(
    false,
  );
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("RESEND_API_KEY", "fixture");
  vi.stubEnv("EMAIL_FROM", "fixture@example.test");
  fetcher.mockResolvedValue(
    new Response("private provider error", { status: 403 }),
  );
  expect(await deliverCode("fixture@example.test", "123456", "fixture")).toBe(
    false,
  );
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe.skipIf(!process.env.DATABASE_URL)(
  "email and access integration",
  () => {
    let a: HiveContext, b: HiveContext, member: HiveContext, memberKey: string;
    const teams: string[] = [],
      emails: string[] = [];
    const suffix = randomBase32(12);
    beforeAll(async () => {
      vi.stubEnv("RESEND_API_KEY", "fixture");
      vi.stubEnv("EMAIL_FROM", "Hive <code@example.test>");
      a = (await createTeam({ teamName: "Access A", memberName: "Admin" })).ctx;
      b = (
        await createTeam({ teamName: "Access B", memberName: "Other admin" })
      ).ctx;
      teams.push(a.teamId, b.teamId);
    });
    afterAll(async () => {
      const sql = getSql();
      await sql`DELETE FROM email_verifications WHERE email IN ${sql(emails)}`;
      for (const table of [
        "feedback",
        "learning_pushes",
        "ask_log",
        "learnings",
        "api_keys",
        "web_sessions",
        "team_domains",
        "members",
      ])
        await sql`DELETE FROM ${sql(table)} WHERE team_id IN ${sql(teams)}`;
      await sql`DELETE FROM teams WHERE id IN ${sql(teams)}`;
      vi.unstubAllEnvs();
      await sql.end();
    });
    async function request(
      name: string,
      intent: string,
      extra: object = {},
      ctx?: HiveContext,
    ) {
      const email = `${name}@${suffix}.example.test`;
      emails.push(email);
      let code = "";
      const sent = await sendEmailCode(
        { email: email.toUpperCase(), memberName: name, intent, ...extra },
        `${suffix}-${name}`,
        ctx,
        async (_, value) => {
          code = value;
          return true;
        },
      );
      return { ...sent, code, email };
    }
    it("verifies a legacy admin and allows only its own verified domain", async () => {
      await expect(allowDomain(a)).rejects.toThrow("Verify your work email");
      const sent = await request("admin", "account", {}, a);
      expect(
        await completeEmailCode(sent.verificationToken, sent.code, suffix, a),
      ).toMatchObject({ ctx: a });
      await allowDomain(a);
      const domains =
        await getSql()`SELECT domain FROM team_domains WHERE team_id = ${a.teamId}`;
      expect(domains[0].domain).toBe(`${suffix}.example.test`);
      await expect(
        completeEmailCode(sent.verificationToken, sent.code, suffix, a),
      ).rejects.toThrow("Code is not correct");
    });
    it("joins by verified domain as a member and stores only hashed credentials", async () => {
      const sent = await request("member", "domain");
      const result = await completeEmailCode(
        sent.verificationToken,
        sent.code,
        suffix,
      );
      member = result.ctx;
      memberKey = result.apiKey!;
      expect(member.teamId).toBe(a.teamId);
      const rows =
        await getSql()`SELECT * FROM email_verifications WHERE email = ${sent.email}`;
      expect(rows[0].code_hash).not.toContain(sent.code);
      expect(rows[0].token_hash).toBe(hashToken(sent.verificationToken));
      const members =
        await getSql()`SELECT email, email_verified, role FROM members WHERE id = ${member.memberId} AND team_id = ${a.teamId}`;
      expect(members[0]).toMatchObject({
        email: sent.email,
        email_verified: true,
        role: "member",
      });
      await expect(requireAdmin(member)).rejects.toThrow("team admin");
    });
    it("counts concurrent wrong attempts and rejects expired codes", async () => {
      const sent = await request("guesses", "domain");
      const wrong = sent.code === "000000" ? "111111" : "000000";
      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          completeEmailCode(sent.verificationToken, wrong, suffix),
        ),
      );
      expect(attempts.every((result) => result.status === "rejected")).toBe(
        true,
      );
      await expect(
        completeEmailCode(sent.verificationToken, sent.code, suffix),
      ).rejects.toThrow("Too many attempts");
      const expired = await request("expired", "domain");
      await getSql()`UPDATE email_verifications SET expires_at = now() - interval '1 second' WHERE token_hash = ${hashToken(expired.verificationToken)}`;
      await expect(
        completeEmailCode(expired.verificationToken, expired.code, suffix),
      ).rejects.toThrow("expired");
    });
    it("invalidates undelivered codes and rate limits sends", async () => {
      const email = `failure@${suffix}.example.test`;
      emails.push(email);
      await expect(
        sendEmailCode(
          { email, memberName: "Failure", intent: "domain" },
          suffix,
          undefined,
          async () => false,
        ),
      ).rejects.toThrow("could not be sent");
      const rows =
        await getSql()`SELECT delivered FROM email_verifications WHERE email = ${email}`;
      expect(rows[0].delivered).toBe(false);
      await expect(
        sendEmailCode(
          { email, memberName: "Failure", intent: "domain" },
          suffix,
          undefined,
          async () => true,
        ),
      ).rejects.toThrow("Wait 30 seconds");
    });
    it("rotates hashed invites without revoking members and expires old joins", async () => {
      const first = await rotateInvite(a),
        second = await rotateInvite(a);
      expect(
        await joinTeam({
          inviteCode: first.inviteCode,
          memberName: "Old invite",
        }),
      ).toBeNull();
      const sent = await request("invited", "join", {
        inviteCode: second.inviteCode,
      });
      const rows =
        await getSql()`SELECT payload FROM email_verifications WHERE email = ${sent.email}`;
      expect(rows[0].payload.inviteCode).toBe(hashToken(second.inviteCode));
      expect(
        (await completeEmailCode(sent.verificationToken, sent.code, suffix)).ctx
          .teamId,
      ).toBe(a.teamId);
      expect(await authenticateApiKey(memberKey)).toEqual(member);
      await getSql()`UPDATE teams SET invite_expires_at = now() - interval '1 second' WHERE id = ${a.teamId}`;
      expect(
        await joinTeam({
          inviteCode: second.inviteCode,
          memberName: "Expired invite",
        }),
      ).toBeNull();
    });
    it("isolates moderation and revocation and removes all access", async () => {
      const learning = await pushLearning(
        a,
        hivePushInput.parse({
          title: "Access fixture",
          body: "Moderation fixture",
        }),
      );
      await expect(moderateLearning(b, learning.id, "delete")).rejects.toThrow(
        "not found",
      );
      await expect(
        moderateLearning(member, learning.id, "delete"),
      ).rejects.toThrow("team admin");
      const keys =
        await getSql()`SELECT id FROM api_keys WHERE member_id = ${member.memberId} AND team_id = ${a.teamId}`;
      await expect(revokeKey(b, keys[0].id)).rejects.toThrow("not found");
      await moderateLearning(a, learning.id, "outdated");
      expect((await getLearning(a, learning.id))!.lifecycle).toBe("outdated");
      await moderateLearning(a, learning.id, "delete");
      expect((await getLearning(a, learning.id))!.lifecycle).toBe("retracted");
      await expect(removeMember(a, b.memberId)).rejects.toThrow("not found");
      await removeMember(a, member.memberId);
      expect(await authenticateApiKey(memberKey)).toBeNull();
    });
  },
);
