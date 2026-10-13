import { recordMembershipJoin } from "./join-receipts";
import { randomInt } from "node:crypto";
import { isIP } from "node:net";
import type postgres from "postgres";
import type { HiveContext, HiveJoinPhrase } from "@hivemind/core";
import words from "@/lib/join-words.json";
import { getSql } from "../db/client";
import { hashToken, newToken } from "../db/ids";
import { HiveError } from "../errors";
import { requireAdmin } from "./access";
import { agentIdIssuer, followOwnerMemberships } from "./owner-bindings";
import { memberContext } from "./enrollment";
import { emailDomain, isPublicDomain } from "./email-domain";
import { joinPhraseRateLimit } from "./rate-limit";

const failure = () => new HiveError("This hive could not be joined. Check the link or ask your admin.", 403);
export const joinPhraseEntropyBits = 3 * Math.log2(words.length);
export function randomJoinPhrase(): string {
  return Array.from({ length: 3 }, () => words[randomInt(words.length)]).join("-");
}
export function normaliseJoinPhrase(phrase: string): string | null {
  const value = phrase.trim().toLowerCase().replace(/\s+/g, "-");
  return value.length <= 80 && /^[a-z]+-[a-z]+-[a-z]+$/.test(value) ? value : null;
}

async function lockAdmin(tx: postgres.TransactionSql, ctx: HiveContext) {
  await tx`SELECT id FROM members WHERE id = ${ctx.memberId} FOR UPDATE`;
  const rows = await tx`SELECT h.member_id FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.role = 'admin' AND h.removed_at IS NULL AND m.actor_type = 'human' AND NOT m.provisional AND m.disabled_at IS NULL`;
  if (!rows.length) throw failure();
  const teams = await tx`SELECT * FROM teams WHERE id = ${ctx.teamId} AND personal_owner_member_id IS NULL FOR UPDATE`;
  if (!teams[0]) throw failure();
  return teams[0];
}

async function writePhrase(ctx: HiveContext, rotate: boolean, generate = randomJoinPhrase): Promise<HiveJoinPhrase> {
  await requireAdmin(ctx);
  return getSql().begin(async tx => {
    const team = await lockAdmin(tx, ctx);
    const current = await tx`SELECT phrase, generation FROM hive_join_phrases WHERE team_id = ${ctx.teamId} AND retired_at IS NULL FOR UPDATE`;
    if (!rotate && current[0]) return { phrase: String(current[0].phrase), generation: Number(current[0].generation), paused: Boolean(team.join_paused) };
    const generation = Number(team.join_generation) + 1;
    await tx`UPDATE hive_join_phrases SET retired_at = now() WHERE team_id = ${ctx.teamId} AND retired_at IS NULL`;
    for (let attempt = 0; attempt < 20; attempt++) {
      const phrase = generate();
      if (!normaliseJoinPhrase(phrase) || phrase !== normaliseJoinPhrase(phrase)) throw failure();
      const rows = await tx`INSERT INTO hive_join_phrases (phrase, team_id, generation, created_by) VALUES (${phrase}, ${ctx.teamId}, ${generation}, ${ctx.memberId}) ON CONFLICT (phrase) DO NOTHING RETURNING phrase`;
      if (!rows.length) continue;
      const domains = await tx`SELECT domain FROM team_domains WHERE team_id = ${ctx.teamId}`;
      const eligible = domains.some(row => !isPublicDomain(row.domain));
      const paused = current.length ? Boolean(team.join_paused) : !eligible;
      await tx`UPDATE teams SET join_generation = ${generation}, join_paused = ${paused} WHERE id = ${ctx.teamId}`;
      return { phrase, generation, paused };
    }
    throw new HiveError("A join link could not be created. Try again later.", 503);
  });
}

export async function generateJoinPhrase(ctx: HiveContext): Promise<HiveJoinPhrase> {
  return writePhrase(ctx, false);
}
export async function rotateJoinPhrase(ctx: HiveContext, generate = randomJoinPhrase): Promise<HiveJoinPhrase> {
  return writePhrase(ctx, true, generate);
}
export async function pauseJoinPhrase(ctx: HiveContext, paused: boolean): Promise<void> {
  await requireAdmin(ctx);
  await getSql().begin(async tx => {
    await lockAdmin(tx, ctx);
    const domains = await tx`SELECT domain FROM team_domains WHERE team_id = ${ctx.teamId}`;
    if (!paused && !domains.some(row => !isPublicDomain(row.domain))) throw failure();
    await tx`UPDATE teams SET join_paused = ${paused} WHERE id = ${ctx.teamId}`;
  });
}
export async function adminJoinPhrase(ctx: HiveContext): Promise<HiveJoinPhrase | null> {
  await requireAdmin(ctx);
  return getSql().begin(async tx => {
    const team = await lockAdmin(tx, ctx);
    const rows = await tx`SELECT phrase, generation FROM hive_join_phrases WHERE team_id = ${ctx.teamId} AND retired_at IS NULL`;
    return rows[0] ? { phrase: rows[0].phrase, generation: Number(rows[0].generation), paused: Boolean(team.join_paused) } : null;
  });
}

export async function memberJoinPhrase(ctx: HiveContext): Promise<HiveJoinPhrase | null> {
  if (!await memberContext(ctx.memberId, ctx.teamId)) throw failure();
  const rows = await getSql()`SELECT p.phrase, p.generation, t.join_paused FROM hive_join_phrases p JOIN teams t ON t.id = p.team_id JOIN hive_memberships h ON h.team_id = t.id AND h.member_id = ${ctx.memberId} WHERE t.id = ${ctx.teamId} AND t.personal_owner_member_id IS NULL AND h.removed_at IS NULL AND p.retired_at IS NULL AND p.generation = t.join_generation`;
  return rows[0] ? { phrase: String(rows[0].phrase), generation: Number(rows[0].generation), paused: Boolean(rows[0].join_paused) } : null;
}

type JoinOptions = { trustedProxyIp: string | null; capability?: string; capabilityHash?: string };
async function authenticatedActor(ctx: HiveContext) {
  const rows = await getSql()`SELECT m.*, b.owner_member_id FROM members m JOIN hive_memberships h ON h.member_id = m.id AND h.team_id = ${ctx.teamId} AND h.removed_at IS NULL LEFT JOIN auth_accounts a ON a.user_id = m.id AND a.provider_id = 'agentid' AND a.owner_email_verified LEFT JOIN agent_owner_bindings b ON b.issuer = ${agentIdIssuer} AND b.owner_sub = a.owner_sub WHERE m.id = ${ctx.memberId} AND m.disabled_at IS NULL AND NOT m.provisional`;
  if (!rows[0]) throw new HiveError("Sign in first.", 401);
  return rows[0];
}

async function attempt<T>(ctx: HiveContext, input: string, options: JoinOptions, action: (tx: postgres.TransactionSql, team: postgres.Row, human: postgres.Row, phrase: string) => Promise<T>, allowRequest = false) {
  const actor = await authenticatedActor(ctx);
  const ownerId = actor.actor_type === "agent" ? actor.owner_member_id : actor.id;
  await joinPhraseRateLimit(String(ownerId || actor.id), options.trustedProxyIp && isIP(options.trustedProxyIp) ? options.trustedProxyIp : null);
  if (!ownerId) throw failure();
  const phrase = normaliseJoinPhrase(input);
  if (!phrase) throw failure();
  return getSql().begin(async tx => {
    const people = await tx`SELECT * FROM members WHERE id = ${ownerId} AND actor_type = 'human' AND email_verified AND NOT provisional AND disabled_at IS NULL FOR UPDATE`;
    if (!people[0]) throw failure();
    const human = people[0];
    let capability: postgres.Row | undefined;
    if (actor.actor_type === "agent") {
      if (!options.capability && !options.capabilityHash) throw failure();
      const grants = await tx`SELECT * FROM hive_join_capabilities WHERE token_hash = ${options.capabilityHash ?? hashToken(options.capability!)} AND owner_member_id = ${ownerId} AND agent_member_id = ${ctx.memberId} AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`;
      capability = grants[0];
      if (!capability) throw failure();
    }
    const actors = await tx`SELECT m.id FROM members m JOIN hive_memberships h ON h.member_id = m.id WHERE m.id = ${ctx.memberId} AND m.disabled_at IS NULL AND NOT m.provisional AND h.team_id = ${ctx.teamId} AND h.removed_at IS NULL`;
    if (!actors.length) throw failure();
    const phrases = await tx`SELECT team_id, generation FROM hive_join_phrases WHERE phrase = ${phrase} AND retired_at IS NULL`;
    if (!phrases[0]) throw failure();
    const teams = await tx`SELECT * FROM teams WHERE id = ${phrases[0].team_id} AND personal_owner_member_id IS NULL FOR UPDATE`;
    const team = teams[0];
    const current = await tx`SELECT generation FROM hive_join_phrases WHERE phrase = ${phrase} AND team_id = ${team?.id ?? ""} AND retired_at IS NULL FOR UPDATE`;
    if (!team || team.join_paused || team.join_domain_policy !== "verified_domain" || !current[0] || Number(team.join_generation) !== Number(current[0].generation) || Number(phrases[0].generation) !== Number(current[0].generation)) throw failure();
    if (capability && (capability.team_id !== team.id || Number(capability.generation) !== Number(current[0].generation))) throw failure();
    const domain = emailDomain(String(human.email));
    if ((!domain || isPublicDomain(domain)) && !allowRequest) throw failure();
    const domains = await tx`SELECT domain FROM team_domains WHERE team_id = ${team.id} AND domain = ${domain ?? ""} FOR SHARE`;
    if (!domains.length && !allowRequest) throw failure();
    const membership = await tx`SELECT removed_at FROM hive_memberships WHERE member_id = ${human.id} AND team_id = ${team.id}`;
    if (membership[0]?.removed_at && !(allowRequest && (await tx`SELECT id FROM hive_join_requests WHERE team_id = ${team.id} AND member_id = ${human.id} AND status = 'pending' AND undone_at IS NOT NULL`).length)) throw failure();
    return action(tx, team, human, phrase);
  });
}

export async function lookupJoinPhrase(ctx: HiveContext, phrase: string, options: JoinOptions) {
  return attempt(ctx, phrase, options, async (_tx, team) => ({ teamId: String(team.id), teamName: String(team.name), generation: Number(team.join_generation) }));
}

export async function joinByPhrase(ctx: HiveContext, phrase: string, options: JoinOptions): Promise<HiveContext> {
  const member = await attempt(ctx, phrase, options, async (tx, team, human) => {
    const added = await tx`INSERT INTO hive_memberships (member_id, team_id, role) VALUES (${human.id}, ${team.id}, 'member') ON CONFLICT DO NOTHING RETURNING member_id`;
    if (added.length) await recordMembershipJoin(tx, human.id, team.id, 'phrase');
    await followOwnerMemberships(tx, human.id);
    const active = await tx`SELECT role FROM hive_memberships WHERE member_id = ${ctx.memberId} AND team_id = ${team.id} AND removed_at IS NULL`;
    if (!active.length) throw failure();
    await tx`UPDATE members SET hive_registration = NULL, updated_at = now() WHERE id = ${ctx.memberId}`;
    return { memberId: ctx.memberId, teamId: String(team.id) };
  });
  const result = await memberContext(member.memberId, member.teamId);
  if (!result) throw failure();
  return result;
}

export async function issueJoinCapability(ctx: HiveContext, phrase: string, agentId: string, options: JoinOptions) {
  const actor = await authenticatedActor(ctx);
  if (actor.actor_type !== "human") throw failure();
  return attempt(ctx, phrase, options, async (tx, team, human) => {
    const agents = await tx`SELECT a.user_id FROM auth_accounts a JOIN agent_owner_bindings b ON b.issuer = ${agentIdIssuer} AND b.owner_sub = a.owner_sub JOIN members m ON m.id = a.user_id WHERE a.provider_id = 'agentid' AND a.user_id = ${agentId} AND b.owner_member_id = ${human.id} AND a.owner_email_verified AND m.actor_type = 'agent' AND m.disabled_at IS NULL`;
    if (!agents.length) throw failure();
    const capability = newToken();
    await tx`INSERT INTO hive_join_capabilities (token_hash, owner_member_id, agent_member_id, team_id, generation, expires_at) VALUES (${hashToken(capability)}, ${human.id}, ${agentId}, ${team.id}, ${team.join_generation}, now() + interval '15 minutes')`;
    return { capability, expiresIn: 900 };
  });
}

export async function withHumanJoinPhrase<T>(ctx: HiveContext, phrase: string, trustedProxyIp: string | null, action: (tx: postgres.TransactionSql, team: postgres.Row, human: postgres.Row) => Promise<T>) {
  const actor = await authenticatedActor(ctx);
  if (actor.actor_type !== "human") throw failure();
  return attempt(ctx, phrase, { trustedProxyIp }, action, true);
}
