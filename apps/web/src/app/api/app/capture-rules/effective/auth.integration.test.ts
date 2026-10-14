import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getSql } from "@/server/db/client";
import { createCaptureRule } from "@/server/capture-rules";
import { hashToken } from "@/server/db/ids";
import { AUTH_CACHE_TTL_MS } from "@/server/auth-cache";
import { revokeKey } from "@/server/identity/access";

vi.mock("server-only", () => ({}));
const suffix = randomBytes(8).toString("hex");
const key = `hm_${randomBytes(32).toString("base64url")}`;
const ctx = {
  teamId: `team_ruleauth_${suffix}`,
  memberId: `mem_ruleauth_${suffix}`,
  teamName: "Rule auth fixture",
  memberName: "Fixture member",
};
const peerId = `mem_ruleauthpeer_${suffix}`;
const keyId = `key_ruleauth_${suffix}`;
function request(authorization?: string) {
  return new Request("http://127.0.0.1:4358/api/app/capture-rules/effective", {
    headers: {
      Cookie: "hm_session=capture-fixture-token",
      ...(authorization ? { Authorization: authorization } : {}),
    },
  });
}

describe.skipIf(!process.env.DATABASE_URL)(
  "effective capture rules real bearer auth",
  () => {
    beforeAll(async () => {
      vi.stubEnv("PUBLIC_URL", "http://127.0.0.1:4358");
      vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:4358");
      vi.stubEnv(
        "BETTER_AUTH_SECRET",
        "capture-auth-fixture-secret-with-thirty-two-characters",
      );
      const sql = getSql();
      await sql`INSERT INTO teams (id, name, invite_code) VALUES (${ctx.teamId}, ${ctx.teamName}, ${hashToken(suffix)})`;
      await sql`INSERT INTO members (id, name) VALUES (${ctx.memberId}, ${ctx.memberName}), (${peerId}, 'Peer fixture')`;
      await sql`INSERT INTO hive_memberships (member_id, team_id, role) VALUES (${ctx.memberId}, ${ctx.teamId}, 'admin'), (${peerId}, ${ctx.teamId}, 'member')`;
      await sql`INSERT INTO api_keys (id, team_id, member_id, key_hash, prefix) VALUES (${keyId}, ${ctx.teamId}, ${ctx.memberId}, ${hashToken(key)}, ${key.slice(0, 10)})`;
      const common = {
        action: "drop" as const,
        enabled: true,
        source: "web" as const,
        kind: "repo_match" as const,
        pattern: "team/private-*",
      };
      await createCaptureRule(ctx, {
        ...common,
        name: "Own rule",
        scope: "member",
      });
      await createCaptureRule(ctx, {
        ...common,
        name: "Team rule",
        scope: "team",
      });
      await createCaptureRule(ctx, {
        ...common,
        name: "Disabled rule",
        scope: "member",
        enabled: false,
      });
      await createCaptureRule(
        { ...ctx, memberId: peerId },
        { ...common, name: "Peer rule", scope: "member" },
      );
    });
    afterAll(async () => {
      const sql = getSql();
      await sql`DELETE FROM capture_rules WHERE team_id = ${ctx.teamId}`;
      await sql`DELETE FROM api_keys WHERE team_id = ${ctx.teamId}`;
      await sql`DELETE FROM members WHERE id IN (${ctx.memberId}, ${peerId})`;
      await sql`DELETE FROM teams WHERE id = ${ctx.teamId}`;
      vi.unstubAllEnvs();
    });
    it("returns only enabled team and own rules through a valid stored bearer key", async () => {
      const response = await GET(request(`Bearer ${key}`));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(
        result.rules.map((rule: { name: string }) => rule.name).sort(),
      ).toEqual(["Exclude credentials", "Exclude customer data", "Exclude personal data", "Own rule"]);
      expect(result.policy).toEqual({include: [], exclude: [], revision: 0});
    });
    it("rejects a cookie-only request and an invalid key", async () => {
      expect((await GET(request())).status).toBe(401);
      expect((await GET(request(`Bearer hm_${"z".repeat(43)}`))).status).toBe(
        401,
      );
    });
    it("rejects a key revoked here at once and one revoked elsewhere within the cache window", async () => {
      const sql = getSql();
      expect((await GET(request(`Bearer ${key}`))).status).toBe(200);
      await revokeKey(ctx, keyId);
      expect((await GET(request(`Bearer ${key}`))).status).toBe(401);
      await sql`UPDATE api_keys SET revoked_at = NULL WHERE id = ${keyId}`;
      expect((await GET(request(`Bearer ${key}`))).status).toBe(200);
      // Another instance removes the member: this process may answer from its cache for at most the TTL.
      await sql`UPDATE hive_memberships SET removed_at = now() WHERE member_id = ${ctx.memberId} AND team_id = ${ctx.teamId}`;
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now + AUTH_CACHE_TTL_MS);
      try {
        expect((await GET(request(`Bearer ${key}`))).status).toBe(401);
      } finally {
        vi.restoreAllMocks();
      }
    });
  },
);
