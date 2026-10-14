import { createHmac } from "node:crypto";
import { z } from "zod";
import type postgres from "postgres";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";
import { hashToken, newId, newToken } from "../db/ids";
import { HiveError } from "../errors";
import { memberContext, listHiveContexts } from "./enrollment";
import { followOwnerMemberships } from "./owner-bindings";
import { rateLimit } from "./rate-limit";
import { deliverWelcome, deliverConnectionLink } from "./welcome";
import { normaliseJoinPhrase } from "./join-phrases";
import { shareOnJoinOffer } from "../share-on-join";
import { forgetCachedAuth } from "../auth-cache";

const label = z.string().trim().min(1).max(80).transform(value => value.normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, "").trim()).refine(Boolean);
export const bootstrapInput = z.strictObject({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)), agentName: label, machine: label, joinPhrase: z.string().max(80).optional() });

export async function createAgentCredential(tx: postgres.TransactionSql, ownerId: string, agentName: string, machine: string, credential: string, phrase?: string) {
  const agentId = newId("mem");
  const display = agentName.endsWith(` on ${machine}`) ? agentName : `${agentName} on ${machine}`;
  await tx`INSERT INTO members (id, name, actor_type, email_verified) VALUES (${agentId}, ${display.slice(0, 160)}, 'agent', true)`;
  await tx`INSERT INTO agent_credentials (id, agent_member_id, owner_member_id, token_hash, machine, join_phrase) VALUES (${newId("acred")}, ${agentId}, ${ownerId}, ${hashToken(credential)}, ${machine}, ${phrase ?? null})`;
  await tx`SELECT hive_ensure_personal_hive(${ownerId})`;
  await followOwnerMemberships(tx, ownerId);
  return agentId;
}

export async function bootstrapAgent(input: unknown, ip: string | null) {
  const data = bootstrapInput.parse(input);
  const phrase = data.joinPhrase ? normaliseJoinPhrase(data.joinPhrase) : null;
  if (data.joinPhrase && !phrase) throw new HiveError("Use the three-word Hive phrase.", 400);
  const attempts = await Promise.allSettled([
    rateLimit("agent-bootstrap-ip", ip ?? "unavailable", 5, 3600),
    rateLimit("agent-bootstrap-email", data.email, 5, 3600),
    rateLimit("agent-bootstrap-global", "all", 100, 3600),
  ]);
  if (attempts.some(result => result.status === "rejected")) throw new HiveError("Too many attempts. Try again in an hour.", 429);
  const result = await getSql().begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`identity-email:${data.email}`}))`;
    const rows = await tx`SELECT * FROM members WHERE lower(email) = ${data.email} FOR UPDATE`;
    let owner = rows[0];
    if (owner && (owner.actor_type !== "human" || owner.disabled_at || (!owner.email_verified && !owner.provisional))) throw new HiveError("Sign in to Hive with your email to connect this machine.", 403);
    if (owner?.provisional_expires_at && owner.provisional_expires_at <= new Date()) throw new HiveError("This personal Hive expired. Sign in with your email to start again.", 403);
    if (!owner) {
      const id = newId("mem");
      owner = (await tx`INSERT INTO members (id, name, email, provisional, provisional_expires_at) VALUES (${id}, 'Your Hive', ${data.email}, true, now() + interval '7 days') RETURNING *`)[0];
    }
    const ownerId = String(owner.id);
    await tx`SELECT hive_ensure_personal_hive(${ownerId})`;
    if (owner.email_verified && !owner.provisional) {
      const requestId = newId("acon");
      const pollingToken = newToken();
      await tx`INSERT INTO agent_connection_requests (id, owner_member_id, polling_token_hash, agent_name, machine, join_phrase) VALUES (${requestId}, ${ownerId}, ${hashToken(pollingToken)}, ${data.agentName}, ${data.machine}, ${phrase})`;
      return { status: "link_sent" as const, requestId, pollingToken, ownerId };
    }
    const passwords = await tx`SELECT id FROM auth_accounts WHERE user_id = ${ownerId} AND password IS NOT NULL`;
    if (passwords.length) throw new HiveError("Sign in with your existing human account.", 403);
    const credential = `ha_${newToken()}`;
    const agentId = await createAgentCredential(tx, ownerId, data.agentName, data.machine, credential, phrase ?? undefined);
    return { status: "issued" as const, credential, agentId, claimPending: true as const, ownerId };
  });
  if (result.status === "issued") {
    await deliverWelcome(result.ownerId);
    return { status: result.status, credential: result.credential, agentId: result.agentId, claimPending: true };
  }
  await deliverConnectionLink(result.ownerId, result.requestId, data.machine);
  return { status: result.status, requestId: result.requestId, pollingToken: result.pollingToken };
}

export function connectionCredential(requestId: string, pollingHash: string) {
  const secret = process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV !== "production" ? "hive-local-development-secret-change-before-deploy" : "");
  if (!secret) throw new HiveError("Hive sign-in is temporarily unavailable.", 503);
  return `ha_${createHmac("sha256", secret).update(`agent-connect:${requestId}:${pollingHash}`).digest("base64url")}`;
}

export async function pollAgentConnection(requestId: string, pollingToken: string) {
  const rows = await getSql()`SELECT r.*, m.disabled_at FROM agent_connection_requests r JOIN members m ON m.id = r.owner_member_id WHERE r.id = ${requestId} AND r.polling_token_hash = ${hashToken(pollingToken)} AND r.expires_at > now() AND m.disabled_at IS NULL`;
  if (!rows[0]) throw new HiveError("This connection request expired. Run the installer again.", 403);
  if (!rows[0].approved_at || !rows[0].agent_member_id) return { status: "pending" as const };
  const credential = connectionCredential(requestId, rows[0].polling_token_hash);
  if (!await authenticateAgentCredential(credential)) throw new HiveError("This agent credential was revoked.", 403);
  return { status: "issued" as const, credential, agentId: String(rows[0].agent_member_id), claimPending: false };
}

export async function cancelAgentConnection(requestId: string, pollingToken: string) {
  await getSql().begin(async tx => {
    const rows = await tx`SELECT agent_member_id FROM agent_connection_requests WHERE id = ${requestId} AND polling_token_hash = ${hashToken(pollingToken)} FOR UPDATE`;
    if (!rows.length) throw new HiveError("Connection request not found.", 403);
    await tx`UPDATE agent_connection_requests SET expires_at = now() WHERE id = ${requestId}`;
    if (rows[0].agent_member_id) {
      await tx`UPDATE agent_credentials SET revoked_at = coalesce(revoked_at, now()) WHERE agent_member_id = ${rows[0].agent_member_id}`;
      await tx`UPDATE members SET disabled_at = coalesce(disabled_at, now()) WHERE id = ${rows[0].agent_member_id}`;
      await tx`DELETE FROM web_sessions WHERE member_id = ${rows[0].agent_member_id}`;
      await tx`UPDATE hive_join_capabilities SET revoked_at = now() WHERE agent_member_id = ${rows[0].agent_member_id}`;
    }
  });
  forgetCachedAuth();
}

// A provisional owner's credential stops working at provisional_expires_at; cached contexts must not outlive it.
const notAfter = new WeakMap<HiveContext, number>();
export function agentCredentialNotAfter(ctx: HiveContext) { return notAfter.get(ctx); }

export async function authenticateAgentCredential(token: string): Promise<HiveContext | null> {
  if (!/^ha_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const rows = await getSql()`SELECT c.agent_member_id, c.owner_member_id, o.provisional, o.provisional_expires_at FROM agent_credentials c JOIN members a ON a.id = c.agent_member_id JOIN members o ON o.id = c.owner_member_id WHERE c.token_hash = ${hashToken(token)} AND c.revoked_at IS NULL AND a.disabled_at IS NULL AND o.disabled_at IS NULL AND (NOT o.provisional OR o.provisional_expires_at > now())`;
  if (!rows[0]) return null;
  const personal = await getSql()`SELECT id FROM teams WHERE personal_owner_member_id = ${rows[0].owner_member_id}`;
  const ctx = personal[0] ? await memberContext(rows[0].agent_member_id, personal[0].id) : null;
  if (!ctx) return null;
  if (rows[0].provisional && rows[0].provisional_expires_at) notAfter.set(ctx, new Date(rows[0].provisional_expires_at).getTime());
  await getSql()`WITH touched AS (UPDATE agent_credentials SET last_used_at = now() WHERE agent_member_id = ${ctx.memberId} AND revoked_at IS NULL AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute') RETURNING agent_member_id) UPDATE members SET last_seen_at = now() WHERE id IN (SELECT agent_member_id FROM touched)`;
  return ctx;
}

export async function agentStatus(ctx: HiveContext) {
  const rows = await getSql()`SELECT c.owner_member_id, c.machine, c.join_phrase, c.join_error, o.provisional, o.email_verified, o.provisional_expires_at FROM agent_credentials c JOIN members o ON o.id = c.owner_member_id WHERE c.agent_member_id = ${ctx.memberId} AND c.revoked_at IS NULL`;
  // A person signed in with OAuth (Claude Code /mcp, gohive login) has no agent credential; report their own state instead of a revoked-credential error.
  const people = rows[0] ? [] : await getSql()`SELECT id AS owner_member_id, NULL::text AS machine, NULL::text AS join_phrase, NULL::text AS join_error, provisional, email_verified, provisional_expires_at FROM members WHERE id = ${ctx.memberId} AND actor_type = 'human' AND disabled_at IS NULL`;
  const row = rows[0] ?? people[0];
  if (!row) throw new HiveError("This agent credential is no longer active.", 403);
  const identity = rows[0] ? "agent" : "human";
  const hives = await listHiveContexts(ctx.memberId);
  const organisations = hives.filter(hive => !hive.personal);
  const requests = await getSql()`SELECT r.status, r.team_id, t.name AS team_name, p.phrase FROM hive_join_requests r JOIN teams t ON t.id = r.team_id LEFT JOIN hive_join_phrases p ON p.team_id = r.team_id AND p.generation = r.phrase_generation AND p.retired_at IS NULL WHERE r.member_id = ${row.owner_member_id} AND r.status = 'pending' AND r.expires_at > now()`;
  const offers = await Promise.all(organisations.map(hive => shareOnJoinOffer(ctx, hive.teamId)));
  return { agentId: ctx.memberId, identity, claimPending: Boolean(row.provisional || !row.email_verified), expiresAt: row.provisional ? row.provisional_expires_at?.toISOString() : null, joinPending: row.join_phrase, joinError: row.join_error, joinRequests: requests.map(request => ({ teamId: String(request.team_id), teamName: String(request.team_name), status: "requested", joinUrl: request.phrase ? `${process.env.PUBLIC_URL || "https://gohive.dev"}/j/${request.phrase}` : null })), organisations: organisations.map(hive => ({ teamId: hive.teamId, teamName: hive.teamName })), shareOffers: offers.filter(Boolean) };
}

export async function revokeAgentCredential(ctx: HiveContext, agentId = ctx.memberId) {
  await getSql().begin(async tx => {
    const rows = await tx`UPDATE agent_credentials SET revoked_at = coalesce(revoked_at, now()) WHERE agent_member_id = ${agentId} AND (agent_member_id = ${ctx.memberId} OR owner_member_id = ${ctx.memberId}) RETURNING agent_member_id`;
    if (!rows.length) throw new HiveError("Agent not found under your account.", 404);
    await tx`UPDATE members SET disabled_at = coalesce(disabled_at, now()) WHERE id = ${agentId}`;
    await tx`DELETE FROM web_sessions WHERE member_id = ${agentId}`;
    await tx`UPDATE hive_join_capabilities SET revoked_at = now() WHERE agent_member_id = ${agentId}`;
  });
  forgetCachedAuth();
}
