import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "./db/client";
import { newId } from "./db/ids";
import { createTeam } from "./auth";
import {
  createOrganisation,
  joinLanding,
  joinOrganisation,
} from "./identity/onboarding-web";
import { memberContext } from "./identity/enrollment";
import { loadMemberContext } from "./identity/session-context";
import { captureOwner, shareProjects } from "./project-sharing";
import {
  bindVerifiedOwner,
  followOwnerMemberships,
  agentIdIssuer,
} from "./identity/legacy-owner-fixture";
import { adminJoinPhrase } from "./identity/join-phrases";
import { webMemberPage } from "./web-member-page";
import { getLearning } from "./hive";
vi.mock("server-only", () => ({}));
vi.mock("./llm/embeddings", () => ({ embedText: async () => null }));
vi.mock("./llm/tagger", () => ({ suggestTags: async () => [] }));
describe.skipIf(!process.env.DATABASE_URL)(
  "human web onboarding",
  { timeout: 60000 },
  () => {
    const suffix = randomUUID();
    const sql = getSql();
    let owner: HiveContext,
      other: HiveContext,
      agent: HiveContext,
      teamId: string,
      phrase: string;
    const cellId = newId("lrn");
    beforeAll(async () => {
      const fixture = (
        await createTeam({
          teamName: `Web fixture ${suffix}`,
          memberName: "Charlie",
        })
      ).ctx;
      await sql`UPDATE members SET email = ${`charlie@${suffix}.example.test`}, email_verified = true WHERE id = ${fixture.memberId}`;
      owner = (await captureOwner(fixture)).personal;
      const teammate = (
        await createTeam({ teamName: `Teammate ${suffix}`, memberName: "Maya" })
      ).ctx;
      await sql`UPDATE members SET email = ${`maya@${suffix}.example.test`}, email_verified = true WHERE id = ${teammate.memberId}`;
      other = (await captureOwner(teammate)).personal;
      await sql.begin((tx) =>
        bindVerifiedOwner(
          tx,
          { sub: suffix, email: `charlie@${suffix}.example.test` },
          true,
        ),
      );
      const agentId = newId("mem");
      await sql`INSERT INTO members (id, name, email, email_verified, actor_type) VALUES (${agentId}, 'Codex on laptop', ${`agent-${suffix}@agentmail.to`}, true, 'agent')`;
      await sql`INSERT INTO auth_accounts (id, user_id, account_id, provider_id, owner_issuer, owner_sub, owner_email_verified) VALUES (${newId("auth")}, ${agentId}, ${agentId}, 'agentid', ${agentIdIssuer}, ${suffix}, true)`;
      await sql.begin((tx) => followOwnerMemberships(tx, owner.memberId));
      agent = (await memberContext(agentId, owner.teamId))!;
      await shareProjects(owner, {
        include: ["github.com/team/widget"],
        exclude: [],
        revision: 0,
      });
      await sql`INSERT INTO learnings (id, team_id, member_id, owner_member_id, title, body, kind, repo, source, confidence, capture_categories) VALUES (${cellId}, ${owner.teamId}, ${agent.memberId}, ${owner.memberId}, 'Keep the exact worktree stash', 'Linked worktrees share a stash. Use its exact reference.', 'learning', 'github.com/team/widget', 'codex', 0.9, ${sql.json({ credentials: false, personal_data: false, customer_data: false })})`;
    });
    it("refuses agent authority even with a valid owner and request key", async () => {
      const before = (await sql`SELECT count(*)::int AS n FROM teams`)[0].n;
      await expect(
        createOrganisation(agent, randomUUID()),
      ).rejects.toMatchObject({ status: 403 });
      expect((await sql`SELECT count(*)::int AS n FROM teams`)[0].n).toBe(
        before,
      );
    });
    it("creates one hive for concurrent retries and publishes selected grants without moving originals", async () => {
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => createOrganisation(owner, key)),
      );
      teamId = results[0].teamId;
      expect(new Set(results.map((row) => row.teamId)).size).toBe(1);
      expect(results[0].paused).toBe(false);
      for (let retry = 0; retry < 8; retry++)
        expect((await createOrganisation(owner, key)).teamId).toBe(teamId);
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM teams WHERE id = ${teamId}`
        )[0].n,
      ).toBe(1);
      expect(
        (
          await sql`SELECT role FROM hive_memberships WHERE team_id = ${teamId} AND member_id = ${owner.memberId}`
        )[0].role,
      ).toBe("admin");
      expect(
        (
          await sql`SELECT role FROM hive_memberships WHERE team_id = ${teamId} AND member_id = ${agent.memberId}`
        )[0].role,
      ).toBe("member");
      expect(
        (await sql`SELECT team_id FROM learnings WHERE id = ${cellId}`)[0]
          .team_id,
      ).toBe(owner.teamId);
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM project_sharing_grants WHERE team_id = ${teamId} AND owner_member_id = ${owner.memberId}`
        )[0].n,
      ).toBe(1);
      const team = (await memberContext(owner.memberId, teamId))!;
      phrase = (await adminJoinPhrase(team))!.phrase;
      const grouped = await webMemberPage(team);
      expect(
        grouped.members.find((member) => member.id === agent.memberId)?.ownerId,
      ).toBe(owner.memberId);
      const cell = await getLearning(owner, cellId);
      expect(cell?.author).toMatchObject({
        name: "Codex on laptop",
        ownerName: "Charlie",
        actorType: "agent",
      });
    });
    it("selects a newly created hive before domain fallback and announces it once without replaying on retry", async () => {
      const fixture = (
        await createTeam({
          teamName: `Domain destination ${suffix}`,
          memberName: "Creator",
        })
      ).ctx;
      const domain = `creator-${suffix}.example.test`;
      await sql`UPDATE members SET email=${`creator@${domain}`},email_verified=true WHERE id=${fixture.memberId}`;
      const personal = (await captureOwner(fixture)).personal;
      await sql`INSERT INTO team_domains (team_id,domain,created_by) VALUES (${fixture.teamId},${domain},${fixture.memberId})`;
      const sessionId = newId("ses"),
        key = randomUUID();
      await sql`INSERT INTO web_sessions (id,member_id,team_id,token_hash,expires_at) VALUES (${sessionId},${fixture.memberId},${personal.teamId},${randomUUID()},now()+interval '1 day')`;
      const created = await createOrganisation(personal, key);
      expect(created.paused).toBe(true);
      const first = await loadMemberContext(personal.memberId, sessionId);
      expect(first?.selectedHiveId).toBe(created.teamId);
      expect(first?.justJoined).toEqual({
        teamId: created.teamId,
        teamName: created.teamName,
        via: "owner",
      });
      expect(
        (await loadMemberContext(personal.memberId, sessionId))?.justJoined,
      ).toBeNull();
      await sql`UPDATE web_sessions SET team_id=${personal.teamId} WHERE id=${sessionId}`;
      expect((await createOrganisation(personal, key)).teamId).toBe(
        created.teamId,
      );
      const retried = await loadMemberContext(personal.memberId, sessionId);
      expect(retried?.selectedHiveId).toBe(personal.teamId);
      expect(retried?.justJoined).toBeNull();
      expect(
        await memberContext(personal.memberId, personal.teamId),
      ).not.toBeNull();
    });
    it("does not create membership, project grants or cells on join-page reads", async () => {
      const counts = async () =>
        (
          await sql`SELECT (SELECT count(*) FROM teams) AS teams, (SELECT count(*) FROM hive_memberships) AS memberships, (SELECT count(*) FROM learnings) AS cells, (SELECT count(*) FROM project_sharing_grants) AS grants`
        )[0];
      const before = await counts();
      const landing = await joinLanding(other, phrase, null);
      expect(landing.teamId).toBe(teamId);
      expect(landing.sharedProjects).toBe(0);
      expect(await counts()).toEqual(before);
    });
    it("joins once on repeated POST service calls, retains personal access, and publishes nothing", async () => {
      await joinOrganisation(other, phrase, null);
      await joinOrganisation(other, phrase, null);
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM hive_memberships WHERE member_id = ${other.memberId} AND team_id = ${teamId}`
        )[0].n,
      ).toBe(1);
      expect(await memberContext(other.memberId, other.teamId)).not.toBeNull();
      expect(
        (
          await sql`SELECT count(*)::int AS n FROM project_sharing_grants WHERE owner_member_id = ${other.memberId} AND team_id = ${teamId}`
        )[0].n,
      ).toBe(0);
    });
  },
);
