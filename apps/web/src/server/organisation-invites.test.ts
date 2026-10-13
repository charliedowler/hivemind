import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { HiveContext } from "@hivemind/core";
import { createTeam } from "./auth";
import { getSql } from "./db/client";
import { personalMemberContext, memberContext } from "./identity/enrollment";
import { createOrganisation } from "./identity/onboarding-web";
import {
  readOrganisationInvite,
  deliverOrganisationCreated,
} from "./organisation-invites";
const mocks = vi.hoisted(() => ({
  email: vi.fn(
    async (
      _email: string,
      _subject: string,
      _text: string,
      _key: string,
      _html?: string,
    ) => true,
  ),
}));
vi.mock("server-only", () => ({}));
vi.mock("./identity/email", () => ({
  emailConfigured: () => true,
  deliverEmail: mocks.email,
}));

describe.skipIf(!process.env.DATABASE_URL)(
  "organisation invitation delivery",
  { timeout: 60000 },
  () => {
    const suffix = randomUUID();
    const sql = getSql();
    let owner: HiveContext, member: HiveContext;
    beforeAll(async () => {
      const fixture = (
        await createTeam({
          teamName: `Invite fixture ${suffix}`,
          memberName: "Owner",
        })
      ).ctx;
      await sql`UPDATE members SET email=${`owner@${suffix}.example.test`},email_verified=true WHERE id=${fixture.memberId}`;
      const personal = (await personalMemberContext(fixture.memberId))!;
      const created = await createOrganisation(personal, randomUUID());
      owner = (await memberContext(fixture.memberId, created.teamId))!;
      const other = (
        await createTeam({
          teamName: `Member fixture ${suffix}`,
          memberName: "Member",
        })
      ).ctx;
      await sql`INSERT INTO hive_memberships (member_id,team_id,role) VALUES (${other.memberId},${owner.teamId},'member')`;
      member = (await memberContext(other.memberId, owner.teamId))!;
    });
    it("lets an active member read the exact domain-gated invitation", async () => {
      const invite = (await readOrganisationInvite(
        member,
        "https://gohive.dev",
      ))!;
      expect(Object.keys(invite).sort()).toEqual(
        ["teamId", "teamName", "joinUrl", "invitePrompt", "joinPaused"].sort(),
      );
      expect(invite.invitePrompt).toBe(
        `Set me up on Hive and join the ${owner.teamName} hive: read https://gohive.dev/agent and follow it, then join with ${invite.joinUrl}`,
      );
      expect(invite.joinPaused).toBe(false);
      expect(
        await readOrganisationInvite(
          { ...member, teamId: `missing_${suffix}` },
          "https://gohive.dev",
        ),
      ).toBeNull();
    });
    it("keeps the link stable when paused and denies a removed member", async () => {
      const before = (await readOrganisationInvite(
        member,
        "https://gohive.dev",
      ))!;
      await sql`UPDATE teams SET join_paused=true WHERE id=${owner.teamId}`;
      expect(
        await readOrganisationInvite(member, "https://gohive.dev"),
      ).toEqual({ ...before, joinPaused: true });
      await sql`UPDATE hive_memberships SET removed_at=now() WHERE member_id=${member.memberId} AND team_id=${owner.teamId}`;
      expect(
        await readOrganisationInvite(member, "https://gohive.dev"),
      ).toBeNull();
    });
    it("sends one creation email for concurrent attempts and retries", async () => {
      mocks.email.mockClear();
      const invite = (await readOrganisationInvite(
        owner,
        "https://gohive.dev",
      ))!;
      expect(
        await Promise.all(
          Array.from({ length: 8 }, () =>
            deliverOrganisationCreated(owner, invite),
          ),
        ),
      ).toEqual(Array(8).fill(true));
      expect(mocks.email).toHaveBeenCalledTimes(1);
      expect(mocks.email.mock.calls[0]?.[2]).toContain(invite.invitePrompt);
      expect(await deliverOrganisationCreated(owner, invite)).toBe(true);
      expect(mocks.email).toHaveBeenCalledTimes(1);
    });
  },
);
