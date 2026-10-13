import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HiveContext } from "@hivemind/core";
import words from "@/lib/join-words.json";
import { getSql } from "../db/client";
import { hashToken, newId } from "../db/ids";
import { authenticateApiKey } from "../auth";
import { contextFromClaims } from "../bearer-auth";
import { createHiveAuth } from "../better-auth";
import { getLearning, listMembers, searchLearnings } from "../hive";
import { bindVerifiedOwner, agentIdIssuer } from "./legacy-owner-fixture";
import { enrollAgent } from "./agent-enrollment";
import { enrollMember, memberContext } from "./enrollment";
import { joinPageState } from "./join-page";
import { allowDomain, removeMember, requireAdmin, revokeJoinCapability } from "./access";
import { adminJoinPhrase, generateJoinPhrase, issueJoinCapability, joinByPhrase, joinPhraseEntropyBits, lookupJoinPhrase, normaliseJoinPhrase, pauseJoinPhrase, randomJoinPhrase, rotateJoinPhrase } from "./join-phrases";

vi.mock("server-only", () => ({}));
vi.mock("../llm/embeddings", () => ({ embedText: async () => null }));
vi.mock("../llm/tagger", () => ({ suggestTags: async () => [] }));

it("uses at least 1,500 distinct words with more than 31.6 bits of phrase entropy", () => {
  expect(words.length).toBeGreaterThanOrEqual(1500);
  expect(new Set(words).size).toBe(words.length);
  for (const word of words) {
    expect(word).toMatch(/^[a-z]+$/);
    expect(words).not.toContain(`${word}s`);
  }
  expect(joinPhraseEntropyBits).toBeGreaterThan(31.6);
  const phrases = new Set(Array.from({ length: 1000 }, () => randomJoinPhrase()));
  expect(phrases.size).toBeGreaterThan(995);
  for (const phrase of phrases) for (const word of phrase.split("-")) expect(words).toContain(word);
  expect(normaliseJoinPhrase(" Amber Honey Fox ")).toBe("amber-honey-fox");
  expect(normaliseJoinPhrase("../../unknown")).toBeNull();
});

describe.skipIf(!process.env.DATABASE_URL)("multi-hive identities", () => {
  const suffix = randomBytes(8).toString("hex");
  const sql = getSql();
  const directory = new URL("../../../drizzle/", import.meta.url);
  const teamIds: string[] = [];
  const memberIds: string[] = [];
  let admin: HiveContext;
  let secondAdmin: HiveContext;
  let owner: HiveContext;
  let domain: string;
  let agentId: string;
  let provisionalId: string;
  const ip = () => `198.18.${parseInt(suffix.slice(0, 2), 16)}.${Math.floor(Math.random() * 250)}`;
  const options = () => ({ trustedProxyIp: ip() });

  async function human(label: string, workDomain = domain) {
    const id = newId("mem"); memberIds.push(id);
    await sql`INSERT INTO members (id, name, email, email_verified) VALUES (${id}, ${`${label}-${suffix}`}, ${`${label}-${suffix}@${workDomain}`}, true)`;
    const personal = (await sql`SELECT hive_ensure_personal_hive(${id}) AS id`)[0].id;
    return (await memberContext(id, personal))!;
  }
  async function agent(label: string, ownerId: string) {
    const id = newId("mem"); memberIds.push(id);
    await sql`INSERT INTO members (id, name, email, email_verified, actor_type) VALUES (${id}, ${label}, ${`${label}-${suffix}@agentmail.to`}, true, 'agent')`;
    const binding = (await sql`SELECT owner_sub, verified_contact_email FROM agent_owner_bindings WHERE owner_member_id = ${ownerId} LIMIT 1`)[0];
    await sql`INSERT INTO auth_accounts (id, user_id, account_id, provider_id, owner_sub, owner_email, owner_email_verified) VALUES (${newId("auth")}, ${id}, ${`${label}-${suffix}`}, 'agentid', ${binding.owner_sub}, ${binding.verified_contact_email}, true)`;
    await enrollAgent(id);
    return id;
  }
  async function resetRates() {
    await sql`DELETE FROM rate_limits WHERE bucket LIKE 'join-phrase-%'`;
  }
  beforeAll(async () => {
    vi.stubEnv("AGENTID_CLIENT_SECRET", "fixture-registered-secret");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    domain = `${suffix}.work.example.test`;
    const adminPerson = await human("admin");
    admin = (await enrollMember(adminPerson.memberId, { intent: "create", teamName: `First hive ${suffix}` }))!;
    teamIds.push(admin.teamId);
    const second = await human("admin-two");
    secondAdmin = (await enrollMember(second.memberId, { intent: "create", teamName: `Second hive ${suffix}` }))!;
    teamIds.push(secondAdmin.teamId);
    owner = await human("owner");
    await sql.begin(tx => bindVerifiedOwner(tx, { sub: `owner-${suffix}`, email: `owner-${suffix}@${domain}`, name: "Owner" }, true));
    agentId = await agent("agent", owner.memberId);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    const personals = await sql`SELECT id FROM teams WHERE personal_owner_member_id IN ${sql(memberIds)}`;
    teamIds.push(...personals.map(row => String(row.id)));
    const ids = [...new Set(teamIds)];
    for (const table of ["hive_join_capabilities", "hive_join_phrases", "knowledge_snapshots", "capture_rules", "learning_versions", "learnings", "api_keys", "web_sessions", "team_domains"]) await sql`DELETE FROM ${sql(table)} WHERE team_id IN ${sql(ids)}`;
    await sql`DELETE FROM members WHERE id IN ${sql(memberIds)}`;
    await sql`DELETE FROM teams WHERE id IN ${sql(ids)}`;
    await resetRates();
  });

  it("backfills a three-team fixture without changing identities, audiences, history, keys or sessions", async () => {
    const schema = `multi_hive_${suffix}`;
    const rollback = new Error("rollback fixture");
    try {
      await sql.begin(async tx => {
        await tx`CREATE SCHEMA ${tx(schema)}`;
        await tx`SET LOCAL search_path TO ${tx(schema)}`;
        await tx`CREATE TABLE _migrations (name text PRIMARY KEY)`;
        for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql") && name < "0027" && name !== "0002_pgvector.sql").sort()) {
          const body = await readFile(new URL(name, directory), "utf8");
          await tx.unsafe(name === "0015_slack.sql" ? body.replace(/DO \$\$ BEGIN\n IF EXISTS \(SELECT 1 FROM pg_type WHERE typname='vector'\)[\s\S]*?END \$\$;/, "") : body);
        }
        for (const n of [1, 2, 3]) {
          await tx`INSERT INTO teams (id, name, invite_code) VALUES (${`team_${n}`}, ${`Organisation ${n}`}, ${hashToken(`invite-${n}`)})`;
          await tx`INSERT INTO members (id, name, email, email_verified, role, team_id) VALUES (${`human_${n}`}, ${`Human ${n}`}, ${`human${n}@example.test`}, true, 'admin', ${`team_${n}`})`;
          await tx`INSERT INTO learnings (id, member_id, team_id, title, body, kind, source, confidence) VALUES (${`cell_${n}`}, ${`human_${n}`}, ${`team_${n}`}, 'Existing cell', 'Existing body', 'learning', 'manual', 1)`;
          await tx`INSERT INTO api_keys (id, member_id, team_id, key_hash, prefix) VALUES (${`key_${n}`}, ${`human_${n}`}, ${`team_${n}`}, ${hashToken(`key-${n}`)}, 'fixture')`;
          await tx`INSERT INTO web_sessions (id, member_id, team_id, token_hash, expires_at) VALUES (${`session_${n}`}, ${`human_${n}`}, ${`team_${n}`}, ${hashToken(`session-${n}`)}, now() + interval '1 day')`;
          await tx`INSERT INTO team_domains (team_id, domain, created_by) VALUES (${`team_${n}`}, ${`domain${n}.test`}, ${`human_${n}`})`;
        }
        await tx`INSERT INTO members (id, name, role, team_id, removed_at) VALUES ('removed_human', 'Removed human', 'member', 'team_1', now())`;
        await tx`INSERT INTO members (id, name, role, team_id, actor_type) VALUES ('agent_existing', 'Existing agent', 'member', 'team_1', 'agent')`;
        await tx`INSERT INTO auth_accounts (id, user_id, account_id, provider_id, owner_sub, owner_email, owner_email_verified) VALUES ('auth_agent', 'agent_existing', 'existing-agent-sub', 'agentid', 'existing-owner-sub', 'human1@example.test', true)`;
        await tx`INSERT INTO auth_accounts (id, user_id, account_id, provider_id, password) VALUES ('auth_password', 'human_2', 'human_2', 'credential', 'existing-password-hash')`;
        await tx`INSERT INTO learnings (id, member_id, team_id, title, body, kind, source, confidence) VALUES ('slack_cell', 'human_1', 'team_1', 'Slack cell', 'Existing Slack cell', 'learning', 'slack', 1)`;
        const before = await tx`SELECT to_jsonb(l) AS value FROM learnings l ORDER BY id`;
        const history = await tx`SELECT to_jsonb(v) AS value FROM learning_versions v ORDER BY learning_id`;
        const oldFks = await tx`SELECT count(*)::int AS count FROM pg_constraint WHERE contype = 'f' AND confrelid = 'members'::regclass AND cardinality(confkey) = 2`;
        await tx.unsafe(await readFile(new URL("0027_multi_hive.sql", directory), "utf8"));
        expect((await tx`SELECT * FROM hive_memberships WHERE team_id IN ('team_1','team_2','team_3')`)).toHaveLength(5);
        expect((await tx`SELECT * FROM teams WHERE personal_owner_member_id IS NOT NULL`)).toHaveLength(4);
        expect((await tx`SELECT owner_member_id, role FROM hive_memberships WHERE member_id = 'agent_existing' ORDER BY team_id`)).toEqual([{ owner_member_id: "human_1", role: "member" }, { owner_member_id: "human_1", role: "member" }]);
        expect((await tx`SELECT owner_member_id, verified_contact_email FROM agent_owner_bindings`)[0]).toEqual({ owner_member_id: "human_1", verified_contact_email: "human1@example.test" });
        expect((await tx`SELECT password FROM auth_accounts WHERE id = 'auth_password'`)[0].password).toBe("existing-password-hash");
        expect((await tx`SELECT role, removed_at FROM hive_memberships WHERE member_id = 'removed_human'`)[0].removed_at).not.toBeNull();
        expect(await tx`SELECT to_jsonb(l) - 'owner_member_id' AS value FROM learnings l ORDER BY id`).toEqual(before);
        expect(await tx`SELECT to_jsonb(v) AS value FROM learning_versions v ORDER BY learning_id`).toEqual(history);
        expect((await tx`SELECT count(*)::int AS count FROM hive_identity_legacy_constraints`)[0].count).toBe(oldFks[0].count);
        expect((await tx`SELECT count(*)::int AS count FROM pg_constraint WHERE contype = 'f' AND confrelid = 'members'::regclass AND cardinality(confkey) = 2`)[0].count).toBe(0);
        expect((await tx`SELECT count(*)::int AS count FROM capture_rules WHERE team_id LIKE 'team_personal_%' AND enabled`)[0].count).toBe(12);
        expect((await tx`SELECT owner_member_id, team_id FROM learnings WHERE id = 'slack_cell'`)[0]).toEqual({ owner_member_id: "human_1", team_id: "team_1" });
        expect((await tx`SELECT token_hash FROM web_sessions WHERE id = 'session_1'`)[0].token_hash).toBe(hashToken("session-1"));
        await tx.unsafe(await readFile(new URL("0027_multi_hive.sql", directory), "utf8"));
        expect((await tx`SELECT count(*)::int AS count FROM teams`)[0].count).toBe(7);
        const undo = await readFile(new URL("rollback/0027_multi_hive.sql", directory), "utf8");
        await tx`INSERT INTO knowledge_snapshots (token_hash, member_id, team_id, revision, object_key, expires_at) VALUES ('fixture-snapshot', 'human_1', 'team_personal_human_1', 1, 'fixture-private-object', now() + interval '1 day')`;
        await expect(tx.savepoint(sp => sp.unsafe(undo))).rejects.toThrow(/Refuse lossy/);
        expect((await tx`SELECT object_key FROM knowledge_snapshots WHERE token_hash = 'fixture-snapshot'`)[0].object_key).toBe("fixture-private-object");
        await tx`DELETE FROM knowledge_snapshots WHERE token_hash = 'fixture-snapshot'`;
        await tx.unsafe(undo);
        expect((await tx`SELECT count(*)::int AS count FROM teams`)[0].count).toBe(3);
        expect((await tx`SELECT count(*)::int AS count FROM pg_constraint WHERE contype = 'f' AND confrelid = 'members'::regclass AND cardinality(confkey) = 2`)[0].count).toBe(oldFks[0].count);
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  }, 30000);

  it("serialises bootstrap across several agents and owner subjects for one email", async () => {
    const email = `provisional-${suffix}@${domain}`;
    const ids = await Promise.all(Array.from({ length: 9 }, (_, n) => sql.begin(tx => bindVerifiedOwner(tx, { sub: `new-${n % 2}-${suffix}`, email, name: "Provisional owner" }, true))));
    expect(new Set(ids).size).toBe(1);
    provisionalId = ids[0]!; memberIds.push(provisionalId);
    expect((await sql`SELECT email_verified, provisional FROM members WHERE id = ${provisionalId}`)[0]).toEqual({ email_verified: false, provisional: true });
    expect(await sql`SELECT id FROM teams WHERE personal_owner_member_id = ${provisionalId}`).toHaveLength(1);
    expect(await sql`SELECT id FROM web_sessions WHERE member_id = ${provisionalId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM auth_accounts WHERE user_id = ${provisionalId}`).toHaveLength(0);
    expect(await memberContext(provisionalId)).toBeNull();
    const first = await agent("provisional-agent", provisionalId);
    const ctx = (await memberContext(first))!;
    expect((await sql`SELECT personal_owner_member_id FROM teams WHERE id = ${ctx.teamId}`)[0].personal_owner_member_id).toBe(provisionalId);
    await expect(requireAdmin(ctx)).rejects.toThrow(/human/);
  });

  it("claims the provisional identity with a human email proof, without replacing it or linking agent credentials", async () => {
    vi.stubEnv("RESEND_API_KEY", "fixture"); vi.stubEnv("EMAIL_FROM", "fixture@example.test");
    let code = "";
    const auth = createHiveAuth("http://localhost:3000", async (_email, otp) => { code = otp; return true; });
    const email = `provisional-${suffix}@${domain}`;
    const send = await auth.api.sendVerificationOTP({ body: { email, type: "email-verification" } });
    expect(send.success).toBe(true);
    await auth.api.verifyEmailOTP({ body: { email, otp: code } });
    expect((await sql`SELECT provisional, email_verified FROM members WHERE id = ${provisionalId}`)[0]).toEqual({ provisional: false, email_verified: true });
    expect((await memberContext(provisionalId))?.memberId).toBe(provisionalId);
    expect(await sql`SELECT id FROM teams WHERE personal_owner_member_id = ${provisionalId}`).toHaveLength(1);
    expect(await sql`SELECT id FROM auth_accounts WHERE user_id = ${provisionalId} AND provider_id = 'agentid'`).toHaveLength(0);
  });

  it("does not provision from open clients or verify a password-bearing email collision", async () => {
    expect(await sql.begin(tx => bindVerifiedOwner(tx, { sub: `open-${suffix}`, email: `open-${suffix}@${domain}` }, false))).toBeNull();
    expect(await sql`SELECT id FROM members WHERE email = ${`open-${suffix}@${domain}`}`).toHaveLength(0);
    const id = newId("mem"); memberIds.push(id);
    await sql`INSERT INTO members (id, name, email) VALUES (${id}, 'Password collision', ${`password-${suffix}@${domain}`})`;
    await sql`INSERT INTO auth_accounts (id, user_id, account_id, provider_id, password) VALUES (${newId("auth")}, ${id}, ${id}, 'credential', 'existing-hash')`;
    await expect(sql.begin(tx => bindVerifiedOwner(tx, { sub: `collision-${suffix}`, email: `password-${suffix}@${domain}` }, true))).rejects.toThrow(/cannot be linked/);
    expect((await sql`SELECT email_verified FROM members WHERE id = ${id}`)[0].email_verified).toBe(false);
    await expect(sql.begin(tx => bindVerifiedOwner(tx, { sub: `owner-${suffix}`, email: `another-${suffix}@${domain}` }, true))).rejects.toThrow(/cannot be linked/);
  });

  it("processes invites before a personal-hive redirect and keeps multiple organisation memberships", async () => {
    const code = `hive-first-${suffix}`;
    await sql`UPDATE teams SET invite_code = ${hashToken(code)} WHERE id = ${admin.teamId}`;
    const state = await joinPageState(owner.memberId, { invite: code });
    expect(state.destination).toBe("/app");
    expect((await memberContext(owner.memberId, admin.teamId))?.teamId).toBe(admin.teamId);
    expect((await memberContext(owner.memberId, owner.teamId))?.teamId).toBe(owner.teamId);
    const codeTwo = `hive-second-${suffix}`;
    await sql`UPDATE teams SET invite_code = ${hashToken(codeTwo)} WHERE id = ${secondAdmin.teamId}`;
    await enrollMember(owner.memberId, { intent: "invite", inviteCode: codeTwo });
    expect((await sql`SELECT role FROM hive_memberships WHERE member_id = ${agentId} AND team_id IN ${sql([admin.teamId, secondAdmin.teamId])}`)).toEqual([{ role: "member" }, { role: "member" }]);
    await expect(sql`UPDATE hive_memberships SET role = 'admin' WHERE member_id = ${agentId} AND team_id = ${admin.teamId}`).rejects.toMatchObject({ code: "23514" });
    expect((await listMembers(admin)).some(member => member.id === owner.memberId)).toBe(true);
  });

  it("keeps author attribution and organisation cells visible after the author's selected hive changes", async () => {
    const cell = newId("lrn");
    await sql`INSERT INTO learnings (id, member_id, team_id, title, body, kind, source, confidence) VALUES (${cell}, ${owner.memberId}, ${admin.teamId}, 'Membership attribution canary', 'A team keeps its existing cell.', 'learning', 'manual', 1)`;
    expect((await getLearning(admin, cell))?.author.id).toBe(owner.memberId);
    expect((await searchLearnings(admin, { query: "membership attribution", limit: 20 })).some(hit => hit.id === cell)).toBe(true);
    expect((await sql`SELECT owner_member_id FROM learnings WHERE id = ${cell}`)[0].owner_member_id).toBe(owner.memberId);
  });

  it("removes one organisation without disabling the owner, their personal hive or another organisation", async () => {
    await removeMember(admin, owner.memberId);
    expect(await memberContext(owner.memberId, admin.teamId)).toBeNull();
    expect(await memberContext(agentId, admin.teamId)).toBeNull();
    expect(await memberContext(owner.memberId, owner.teamId)).not.toBeNull();
    expect(await memberContext(agentId, secondAdmin.teamId)).not.toBeNull();
    expect((await sql`SELECT disabled_at FROM members WHERE id = ${owner.memberId}`)[0].disabled_at).toBeNull();
    await enrollAgent(agentId);
    expect((await sql`SELECT removed_at FROM hive_memberships WHERE member_id = ${agentId} AND team_id = ${admin.teamId}`)[0].removed_at).not.toBeNull();
    const code = `hive-first-${suffix}`;
    await expect(enrollMember(owner.memberId, { intent: "invite", inviteCode: code })).rejects.toThrow(/removed/);
    expect(await contextFromClaims({ sub: agentId, hive_member_id: agentId, hive_team_id: admin.teamId })).toBeNull();
    expect(await contextFromClaims({ sub: owner.memberId, hive_member_id: agentId, hive_team_id: secondAdmin.teamId })).toBeNull();
  });

  it("keeps team keys scoped to their membership rather than the selected hive", async () => {
    const key = `hm_${randomBytes(32).toString("base64url")}`;
    await sql`INSERT INTO api_keys (id, member_id, team_id, key_hash, prefix) VALUES (${newId("key")}, ${owner.memberId}, ${secondAdmin.teamId}, ${hashToken(key)}, 'fixture')`;
    expect((await authenticateApiKey(key))?.teamId).toBe(secondAdmin.teamId);
    await removeMember(secondAdmin, owner.memberId);
    expect(await authenticateApiKey(key)).toBeNull();
    expect(await memberContext(owner.memberId, owner.teamId)).not.toBeNull();
  });

  it("keeps phrase joins paused without verified eligibility and restricts stored reads to admins", async () => {
    await resetRates();
    const phrase = await generateJoinPhrase(admin);
    expect(phrase.paused).toBe(true);
    await expect(pauseJoinPhrase(admin, false)).rejects.toThrow(/could not be joined/);
    await expect(allowDomain(owner)).rejects.toThrow(/organisation hives/);
    await expect(lookupJoinPhrase(owner, phrase.phrase, options())).rejects.toThrow(/could not be joined/);
    await expect(adminJoinPhrase({ ...owner, teamId: admin.teamId })).rejects.toThrow(/admin/);
    await sql`INSERT INTO team_domains (team_id, domain, created_by) VALUES (${admin.teamId}, ${domain}, ${admin.memberId})`;
    await pauseJoinPhrase(admin, false);
    expect((await adminJoinPhrase(admin))?.paused).toBe(false);
  });

  it("joins only verified humans in an allowed domain and returns generic errors for bad phrases", async () => {
    await resetRates();
    const phrase = (await adminJoinPhrase(admin))!.phrase;
    const eligible = await human("phrase-eligible");
    const joined = await joinByPhrase(eligible, phrase, options());
    expect(joined.teamId).toBe(admin.teamId);
    expect((await memberContext(eligible.memberId, eligible.teamId))?.teamId).toBe(eligible.teamId);
    const wrong = await human("wrong-domain", `${suffix}.elsewhere.test`);
    await expect(lookupJoinPhrase(wrong, phrase, options())).rejects.toThrow(/could not be joined/);
    await expect(lookupJoinPhrase(wrong, "missing-honey-fox", options())).rejects.toThrow(/could not be joined/);
    await expect(lookupJoinPhrase({ ...wrong, memberId: "unknown" }, phrase, options())).rejects.toThrow(/Sign in first/);
    expect(await sql`SELECT team_id FROM hive_memberships WHERE member_id = ${wrong.memberId} AND team_id = ${admin.teamId}`).toHaveLength(0);
  });

  it("requires an explicit human capability, rejects cross-account and revoked grants, and follows both agents", async () => {
    await resetRates();
    const eligible = await human("capability-owner");
    await sql.begin(tx => bindVerifiedOwner(tx, { sub: `capability-${suffix}`, email: `capability-owner-${suffix}@${domain}` }, true));
    const first = await agent("capability-one", eligible.memberId);
    const second = await agent("capability-two", eligible.memberId);
    const firstCtx = (await memberContext(first))!;
    const secondCtx = (await memberContext(second))!;
    const phrase = (await adminJoinPhrase(admin))!.phrase;
    await expect(joinByPhrase(firstCtx, phrase, options())).rejects.toThrow(/could not be joined/);
    const grant = await issueJoinCapability(eligible, phrase, first, options());
    await expect(joinByPhrase(secondCtx, phrase, { ...options(), capability: grant.capability })).rejects.toThrow(/could not be joined/);
    await revokeJoinCapability(eligible, grant.capability);
    await expect(joinByPhrase(firstCtx, phrase, { ...options(), capability: grant.capability })).rejects.toThrow(/could not be joined/);
    await resetRates();
    const valid = await issueJoinCapability(eligible, phrase, first, options());
    expect((await joinByPhrase(firstCtx, phrase, { ...options(), capability: valid.capability })).teamId).toBe(admin.teamId);
    expect((await memberContext(second, admin.teamId))?.teamId).toBe(admin.teamId);
    expect((await sql`SELECT role FROM hive_memberships WHERE member_id = ${eligible.memberId} AND team_id = ${admin.teamId}`)[0].role).toBe("member");
  });

  it("retries phrase collisions and never reuses retired phrases", async () => {
    const old = (await adminJoinPhrase(admin))!;
    let attempts = 0;
    const current = await rotateJoinPhrase(admin, () => ++attempts < 3 ? old.phrase : randomJoinPhrase());
    expect(attempts).toBe(3);
    expect(current.generation).toBe(old.generation + 1);
    expect(current.phrase).not.toBe(old.phrase);
    expect((await sql`SELECT retired_at FROM hive_join_phrases WHERE phrase = ${old.phrase}`)[0].retired_at).not.toBeNull();
    await resetRates();
    await expect(lookupJoinPhrase(owner, old.phrase, options())).rejects.toThrow(/could not be joined/);
    await expect(rotateJoinPhrase(admin, () => old.phrase)).rejects.toMatchObject({ status: 503 });
    expect((await adminJoinPhrase(admin))?.phrase).toBe(current.phrase);
  });

  it("shares guessing limits across callers, owner agents, trusted IPs and the global bucket", async () => {
    await resetRates();
    const phrase = (await adminJoinPhrase(admin))!.phrase;
    for (let n = 0; n < 5; n++) await expect(lookupJoinPhrase(owner, phrase, options())).rejects.toMatchObject({ status: 403 });
    await expect(lookupJoinPhrase((await memberContext(agentId))!, phrase, options())).rejects.toMatchObject({ status: 429 });
    await resetRates();
    await sql`INSERT INTO rate_limits (bucket, window_start, count) VALUES (${`join-phrase-ip:${hashToken("198.18.0.10")}`}, now(), 30)`;
    await expect(lookupJoinPhrase(owner, phrase, { trustedProxyIp: "198.18.0.10" })).rejects.toMatchObject({ status: 429 });
    await resetRates();
    await sql`INSERT INTO rate_limits (bucket, window_start, count) VALUES (${`join-phrase-global:${hashToken("all")}`}, now(), 1000)`;
    await expect(lookupJoinPhrase(owner, phrase, options())).rejects.toMatchObject({ status: 429 });
    await resetRates();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => lookupJoinPhrase(owner, phrase, options())));
    expect(results.filter(result => result.status === "rejected" && result.reason.status === 429)).toHaveLength(7);
  });

  it("locks and rechecks the phrase generation when rotation races with joining", async () => {
    await resetRates();
    const candidate = await human("race-candidate");
    const phrase = (await adminJoinPhrase(admin))!.phrase;
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<void>(resolve => { ready = resolve; });
    const blocker = sql.begin(async tx => {
      await tx`SELECT phrase FROM hive_join_phrases WHERE phrase = ${phrase} FOR UPDATE`;
      ready();
      await held;
    });
    await acquired;
    const rotating = rotateJoinPhrase(admin);
    for (let n = 0; n < 100; n++) {
      let locked = false;
      try { await sql.begin(tx => tx`SELECT id FROM teams WHERE id = ${admin.teamId} FOR UPDATE NOWAIT`); }
      catch (error) { if ((error as { code?: string }).code === "55P03") locked = true; else throw error; }
      if (locked) break;
      if (n === 99) { release(); throw new Error("Rotation did not acquire the team lock"); }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const joining = joinByPhrase(candidate, phrase, options());
    const observed = joining.then(() => "joined", () => "refused");
    release();
    await blocker;
    await rotating;
    expect(await observed).toBe("refused");
    expect(await sql`SELECT team_id FROM hive_memberships WHERE member_id = ${candidate.memberId} AND team_id = ${admin.teamId}`).toHaveLength(0);
    await pauseJoinPhrase(admin, true);
    await expect(joinByPhrase(candidate, (await adminJoinPhrase(admin))!.phrase, options())).rejects.toThrow(/could not be joined/);
  });

  it("refuses rollback after personal identities, phrases and multiple memberships exist", async () => {
    const rollback = await readFile(new URL("rollback/0027_multi_hive.sql", directory), "utf8");
    await expect(sql.begin(tx => tx.unsafe(rollback))).rejects.toThrow(/Refuse lossy/);
  });
});
