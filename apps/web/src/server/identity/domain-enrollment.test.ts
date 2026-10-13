import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getSql } from "../db/client";
import { hashToken, newId } from "../db/ids";
import { enrollMember, personalMemberContext } from "./enrollment";
import { loadMemberContext } from "./session-context";
import { bindVerifiedOwner } from "./owner-bindings";
import { createHiveAuth } from "../better-auth";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
vi.mock("server-only", () => ({}));

describe.skipIf(!process.env.DATABASE_URL)("automatic verified-domain enrollment", () => {
  const sql = getSql();
  const people: string[] = [];
  const teams: string[] = [];
  const sessions: string[] = [];
  async function fixture(domain = `${randomBytes(8).toString("hex")}.work.example.test`) {
    const admin = newId("mem");
    const member = newId("mem");
    const team = newId("team");
    people.push(admin, member); teams.push(team);
    await sql`INSERT INTO members (id,name,email,email_verified) VALUES (${admin},'Admin',${`${admin}@fixture.example.test`},true),(${member},'Idris fixture',${`${member}@${domain}`},true)`;
    await sql`INSERT INTO teams (id,name,invite_code) VALUES (${team},'Lightdash fixture',${hashToken(team)})`;
    await sql`INSERT INTO hive_memberships (member_id,team_id,role) VALUES (${admin},${team},'admin')`;
    await sql`INSERT INTO team_domains (team_id,domain,created_by) VALUES (${team},${domain},${admin})`;
    return { admin, member, team, domain };
  }
  afterAll(async () => {
    for (const id of sessions) {
      await sql`DELETE FROM auth_verification WHERE id=${`hive-domain-landing:${id}`}`;
      await sql`DELETE FROM web_sessions WHERE id=${id}`;
    }
    for (const team of teams) await sql`DELETE FROM teams WHERE id=${team}`;
    for (const id of people) {
      await sql`DELETE FROM auth_verification WHERE id=${`hive-enrollment-context:${id}`}`;
      await sql`DELETE FROM capture_rules WHERE team_id IN (SELECT id FROM teams WHERE personal_owner_member_id=${id})`;
      await sql`DELETE FROM members WHERE id=${id}`;
    }
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  async function session(member: string) {
    const personal = (await sql`SELECT hive_ensure_personal_hive(${member}) AS id`)[0].id;
    const id = newId("auth"); sessions.push(id);
    await sql`INSERT INTO web_sessions (id,member_id,team_id,token_hash,expires_at) VALUES (${id},${member},${personal},${hashToken(id)},now()+interval '1 day')`;
    return { id, personal };
  }
  it("joins a new verified human without a Join tab and keeps the personal hive", async () => {
    const { member, team } = await fixture();
    expect((await enrollMember(member))?.teamId).toBe(team);
    expect((await sql`SELECT role FROM hive_memberships WHERE member_id=${member} AND team_id=${team}`)[0]?.role).toBe("member");
    expect(await personalMemberContext(member)).not.toBeNull();
  });
  it("repairs an existing signed-in human, announces once, and respects their next hive switch", async () => {
    const { member, team } = await fixture();
    const signed = await session(member);
    const first = await loadMemberContext(member, signed.id);
    expect(first?.selectedHiveId).toBe(team);
    expect(first?.justJoined).toEqual({ teamId: team, teamName: "Lightdash fixture", via: "domain" });
    expect(first?.personalHive.id).toBe(signed.personal);
    expect(first?.organisations).toEqual([expect.objectContaining({ id: team, role: "member" })]);
    expect((await loadMemberContext(member, signed.id))?.justJoined).toBeNull();
    await sql`UPDATE web_sessions SET team_id=${signed.personal} WHERE id=${signed.id}`;
    expect((await loadMemberContext(member, signed.id))?.selectedHiveId).toBe(signed.personal);
  });
  it("keeps removal tombstones and excludes unverified and public inbox domains", async () => {
    const removed = await fixture();
    await sql`INSERT INTO hive_memberships (member_id,team_id,removed_at) VALUES (${removed.member},${removed.team},now())`;
    const signed = await session(removed.member);
    expect((await loadMemberContext(removed.member, signed.id))?.organisations).toEqual([]);
    expect((await sql`SELECT removed_at FROM hive_memberships WHERE member_id=${removed.member} AND team_id=${removed.team}`)[0].removed_at).not.toBeNull();
    const pending = await fixture();
    await sql`UPDATE members SET email_verified=false WHERE id=${pending.member}`;
    expect((await loadMemberContext(pending.member, (await session(pending.member)).id))?.organisations).toEqual([]);
    for (const domain of ["gmail.com", "agentmail.to", "agentmail.cc"]) {
      const inbox = await fixture(domain);
      await enrollMember(inbox.member);
      expect(await sql`SELECT role FROM hive_memberships WHERE member_id=${inbox.member} AND team_id=${inbox.team}`).toHaveLength(0);
    }
  });
  it("follows an owner's domain membership without making their agent an admin", async () => {
    const f = await fixture();
    const sub = `domain-owner-${f.member}`;
    await sql.begin(tx => bindVerifiedOwner(tx, { sub, email: `${f.member}@${f.domain}` }, true));
    const agent = newId("mem"); people.push(agent);
    await sql`INSERT INTO members (id,name,email,email_verified,actor_type) VALUES (${agent},'Agent',${`${agent}@agentmail.to`},true,'agent')`;
    await sql`INSERT INTO auth_accounts (id,user_id,account_id,provider_id,owner_sub,owner_email_verified) VALUES (${newId("auth")},${agent},${agent},'agentid',${sub},true)`;
    await enrollMember(f.member);
    expect((await sql`SELECT role,owner_member_id FROM hive_memberships WHERE member_id=${agent} AND team_id=${f.team}`)[0]).toEqual({ role: "member", owner_member_id: f.member });
  });
  it("runs domain enrollment during the real Google callback before the first human session", async () => {
    const f = await fixture();
    await sql`DELETE FROM members WHERE id=${f.member}`;
    vi.stubEnv("BETTER_AUTH_SECRET", "fixture-secret-with-at-least-thirty-two-characters");
    vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-google-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-google-secret");
    const keys = await generateKeyPair("RS256");
    const publicKey = { ...await exportJWK(keys.publicKey), kid: "fixture-google", alg: "RS256" };
    const idToken = await new SignJWT({ name: "Google Idris", email: `${f.member}@${f.domain}`, email_verified: true }).setProtectedHeader({ alg: "RS256", kid: "fixture-google" }).setSubject(f.member).setIssuer("https://accounts.google.com").setAudience("fixture-google-client").setIssuedAt().setExpirationTime("1h").sign(keys.privateKey);
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "fixture-google-token", id_token: idToken, token_type: "Bearer", expires_in: 3600 });
      if (String(url).includes("/certs")) return Response.json({ keys: [publicKey] });
      if (String(url).includes("googleapis.com")) return Response.json({ sub: f.member, name: "Google Idris", email: `${f.member}@${f.domain}`, email_verified: true });
      throw new Error("Unexpected Google request");
    }));
    const auth = createHiveAuth("http://localhost:3000");
    const started = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify({ provider: "google", callbackURL: "/app" }) }));
    expect(started.status).toBe(200);
    const state = new URL((await started.json()).url).searchParams.get("state");
    const callback = await auth.handler(new Request(`http://localhost:3000/api/auth/callback/google?code=fixture-code&state=${state}`, { headers: { Cookie: started.headers.getSetCookie().map(v => v.split(";")[0]).join("; ") } }));
    expect(callback.headers.get("location")).not.toContain("error");
    const cookie = callback.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
    const human = await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
    expect(human?.user.email).toBe(`${f.member}@${f.domain}`);
    people.push(human!.user.id); sessions.push(human!.session.id);
    expect((await sql`SELECT role FROM hive_memberships WHERE member_id=${human!.user.id} AND team_id=${f.team}`)[0]?.role).toBe("member");
    const loaded = await loadMemberContext(human!.user.id, human!.session.id);
    expect(loaded?.selectedHiveId).toBe(f.team);
    expect(loaded?.justJoined?.via).toBe("domain");
  });
});
