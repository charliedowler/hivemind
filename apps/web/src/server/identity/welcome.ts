import { SignJWT, jwtVerify } from "jose";
import type postgres from "postgres";
import { getSql } from "../db/client";
import { hashToken, newId, newToken } from "../db/ids";
import { HiveError } from "../errors";
import { deliverEmail } from "./email";
import { claimProvisionalHuman } from "./owner-bindings";
import { renderWelcome } from "./welcome-template";
import { connectionCredential, createAgentCredential } from "./agent-credentials";

type Welcome = { email: string; nonce: string; issued: number; expires: number; consumed?: boolean; delivered?: boolean; attempts: number; message?: { subject: string; text: string; html?: string } };
const identifier = (id: string) => `hive-welcome:${id}`;
const connectionIdentifier = (id: string) => `hive-agent-connect:${id}`;
const invalid = () => new HiveError("This Hive link has expired or was already used. Sign in with your email instead.", 403);
const secret = () => {
  const value = process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV !== "production" ? "hive-local-development-secret-change-before-deploy" : "");
  if (!value) throw new HiveError("Hive sign-in is temporarily unavailable.", 503);
  return new TextEncoder().encode(value);
};

async function human(tx: postgres.TransactionSql, memberId: string, allowVerified = false) {
  const emails = await tx`SELECT email FROM members WHERE id = ${memberId}`;
  if (!emails[0]?.email) throw invalid();
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`identity-email:${emails[0].email}`}))`;
  const member = (await tx`SELECT * FROM members WHERE id = ${memberId} FOR UPDATE`)[0];
  if (!member || member.actor_type !== "human" || member.disabled_at || !member.email || (member.provisional_expires_at && member.provisional_expires_at <= new Date())) throw invalid();
  if (allowVerified && member.email_verified && !member.provisional) return member;
  if (!member.provisional || member.email_verified) throw invalid();
  const collisions = await tx`SELECT id FROM members WHERE lower(email) = ${String(member.email).toLowerCase()} AND id <> ${memberId}`;
  const accounts = await tx`SELECT id FROM auth_accounts WHERE user_id = ${memberId}`;
  const owners = await tx`SELECT owner_member_id FROM agent_owner_bindings WHERE owner_member_id = ${memberId} AND verified_contact_email = ${member.email} UNION SELECT owner_member_id FROM agent_credentials WHERE owner_member_id = ${memberId}`;
  if (collisions.length || accounts.length || !owners.length) throw invalid();
  return member;
}

async function state(tx: postgres.TransactionSql, memberId: string, email: string, id = identifier(memberId)): Promise<Welcome> {
  const rows = await tx`SELECT value FROM auth_verification WHERE id = ${id} FOR UPDATE`;
  if (rows[0]) {
    const value: Welcome = JSON.parse(rows[0].value);
    if (value.email !== email || value.consumed) throw invalid();
    if (value.expires > Math.floor(Date.now() / 1000) || value.delivered || value.attempts) return value;
  }
  const issued = Math.floor(Date.now() / 1000);
  const value: Welcome = { email, nonce: newToken(), issued, expires: issued + 86400, attempts: 0 };
  await tx`INSERT INTO auth_verification (id, identifier, value, expires_at) VALUES (${id}, ${id}, ${JSON.stringify(value)}, '9999-01-01'::timestamptz) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return value;
}

async function link(memberId: string, value: Welcome, connectionId?: string, joinPhrase?: string) {
  const token = await new SignJWT({ email: value.email, ...(connectionId ? { connectionId } : {}), ...(joinPhrase ? { joinPhrase } : {}) }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer("hive-welcome").setAudience("hive-human-claim").setSubject(memberId).setJti(value.nonce).setIssuedAt(value.issued).setExpirationTime(value.expires).sign(secret());
  const url = new URL("/api/auth/claim", process.env.PUBLIC_URL || process.env.BETTER_AUTH_URL || "https://gohive.dev");
  url.searchParams.set("token", token);
  return url.href;
}

export async function issueWelcomeLink(memberId: string): Promise<string> {
  return getSql().begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${identifier(memberId)}))`;
    const member = await human(tx, memberId);
    const phrases = await tx`SELECT join_phrase FROM agent_credentials WHERE owner_member_id = ${memberId} AND join_phrase IS NOT NULL AND revoked_at IS NULL ORDER BY created_at LIMIT 1`;
    return link(memberId, await state(tx, memberId, member.email), undefined, phrases[0]?.join_phrase);
  });
}

export async function deliverWelcome(memberId: string): Promise<void> {
  await getSql().begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${identifier(memberId)}))`;
    const people = await tx`SELECT provisional FROM members WHERE id = ${memberId}`;
    if (!people[0]?.provisional) return;
    const member = await human(tx, memberId);
    const value = await state(tx, memberId, member.email);
    if (value.delivered || value.expires <= Math.floor(Date.now() / 1000)) return;
    if (!value.message) {
      const phrases = await tx`SELECT join_phrase FROM agent_credentials WHERE owner_member_id = ${memberId} AND join_phrase IS NOT NULL AND revoked_at IS NULL ORDER BY created_at LIMIT 1`;
      const claimUrl = await link(memberId, value, undefined, phrases[0]?.join_phrase);
      value.message = renderWelcome({ name: String(member.name), claimUrl });
      value.message.text += "\n\nThis link expires in 24 hours. Your agents will use your hives after you claim this account.";
    }
    value.attempts++;
    value.delivered = await deliverEmail(value.email, value.message.subject, value.message.text, `hive-welcome/${memberId}/${value.nonce}`, value.message.html);
    await tx`UPDATE auth_verification SET value = ${JSON.stringify(value)}, updated_at = now() WHERE id = ${identifier(memberId)}`;
  });
}

export async function deliverConnectionLink(memberId: string, connectionId: string, machine: string) {
  await getSql().begin(async tx => {
    const id = connectionIdentifier(connectionId);
    await tx`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const member = await human(tx, memberId, true);
    const value = await state(tx, memberId, member.email, id);
    if (value.delivered) return;
    value.message ??= { subject: "Connect your agent to Hive", text: `Your agent on ${machine} wants to connect to Hive. Click the link to connect this machine.\n\n${await link(memberId, value, connectionId)}\n\nYour agents will use your hives. This link expires in 24 hours.` };
    value.attempts++;
    value.delivered = await deliverEmail(value.email, value.message.subject, value.message.text, `hive-agent-connect/${connectionId}/${value.nonce}`);
    await tx`UPDATE auth_verification SET value = ${JSON.stringify(value)}, updated_at = now() WHERE id = ${id}`;
    if (!value.delivered) throw new HiveError("The connection email could not be sent. Try again later.", 503);
  });
}

export async function claimWelcome(token: string, userAgent?: string | null) {
  let payload;
  try { payload = (await jwtVerify(token, secret(), { issuer: "hive-welcome", audience: "hive-human-claim", algorithms: ["HS256"] })).payload; }
  catch { throw invalid(); }
  if (!payload.sub || !payload.jti || typeof payload.email !== "string") throw invalid();
  const memberId = payload.sub;
  const connectionId = typeof payload.connectionId === "string" ? payload.connectionId : undefined;
  return getSql().begin(async tx => {
    const id = connectionId ? connectionIdentifier(connectionId) : identifier(memberId);
    await tx`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const member = await human(tx, memberId, Boolean(connectionId));
    const rows = await tx`SELECT value FROM auth_verification WHERE id = ${id} FOR UPDATE`;
    const value: Welcome | undefined = rows[0] ? JSON.parse(rows[0].value) : undefined;
    if (!value || value.consumed || value.email !== member.email || payload.email !== member.email || value.nonce !== payload.jti || value.expires !== payload.exp || value.expires <= Math.floor(Date.now() / 1000)) throw invalid();
    await tx`UPDATE members SET email_verified = true, updated_at = now() WHERE id = ${memberId}`;
    await claimProvisionalHuman(tx, memberId);
    if (connectionId) {
      const request = (await tx`SELECT * FROM agent_connection_requests WHERE id = ${connectionId} AND owner_member_id = ${memberId} AND expires_at > now() AND approved_at IS NULL FOR UPDATE`)[0];
      if (!request) throw invalid();
      const agentId = await createAgentCredential(tx, memberId, request.agent_name, request.machine, connectionCredential(connectionId, request.polling_token_hash), request.join_phrase ?? undefined);
      await tx`UPDATE agent_connection_requests SET approved_at = now(), agent_member_id = ${agentId} WHERE id = ${connectionId}`;
    }
    const teamId = (await tx`SELECT hive_ensure_personal_hive(${memberId}) AS id`)[0].id;
    const session = { id: newId("auth"), userId: memberId, token: newToken(), teamId, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400000), ipAddress: null, userAgent: userAgent?.slice(0, 1000) ?? null };
    await tx`INSERT INTO web_sessions (id, member_id, token, token_hash, team_id, expires_at, user_agent) VALUES (${session.id}, ${memberId}, ${session.token}, ${hashToken(session.token)}, ${teamId}, ${session.expiresAt}, ${session.userAgent})`;
    value.consumed = true;
    await tx`UPDATE auth_verification SET value = ${JSON.stringify(value)}, updated_at = now() WHERE id = ${id}`;
    const agents = await tx`SELECT machine FROM agent_credentials WHERE owner_member_id = ${memberId} AND revoked_at IS NULL`;
    return { session, user: { id: memberId, name: String(member.name), email: String(member.email), emailVerified: true, image: member.image as string | null, createdAt: member.created_at as Date, updatedAt: new Date() }, agentClaim: agents.length > 0 };
  });
}
