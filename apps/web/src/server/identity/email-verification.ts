import { earlyAccessIdForEmail } from "../analytics/linkages";
import {
  accessEvent,
  bindApiKey,
  bindRole,
  withActor,
} from "../analytics/events";
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";
import { hashToken, newId, newToken } from "../db/ids";
import { HiveError, HiveInputError } from "../errors";
import { deliverCode, emailConfigured } from "./email";
import { hashCode, verifyCode } from "./passwords";
import { emailDomain, isPublicDomain } from "./email-domain";
import { rateLimit } from "./rate-limit";
export const emailRequest = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200, "Keep your email to 200 characters or fewer.")
    .pipe(z.email("Enter a valid work email address.")),
  memberName: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(80, "Keep your name to 80 characters or fewer."),
  intent: z.enum(["teams", "join", "domain", "account"]),
  teamName: z
    .string()
    .trim()
    .min(1, "Enter a team name.")
    .max(80, "Keep the team name to 80 characters or fewer.")
    .optional(),
  inviteCode: z
    .string()
    .trim()
    .min(4, "Enter the invite code from your team.")
    .max(80, "Check your invite code. It must be 80 characters or fewer.")
    .optional(),
});
type Payload = z.infer<typeof emailRequest> & {
  teamId?: string;
  memberId?: string;
};
export type Delivery = typeof deliverCode;
export async function sendEmailCode(
  input: unknown,
  ip: string,
  ctx?: HiveContext,
  delivery: Delivery = deliverCode,
) {
  if (!emailConfigured())
    throw new HiveError(
      "Email verification is unavailable. Please try later.",
      503,
    );
  const data = emailRequest.parse(input);
  if (data.intent === "account" && !ctx)
    throw new HiveError("Sign in first.", 401);
  if (data.intent === "teams" && !data.teamName)
    throw new HiveInputError("Enter a team name.");
  if (data.intent === "join" && !data.inviteCode)
    throw new HiveInputError("Enter an invite code.");
  if (
    (data.intent === "domain" || data.intent === "teams") &&
    isPublicDomain(emailDomain(data.email) ?? "")
  )
    throw new HiveInputError(
      "Use a work email. Public email providers cannot join by domain.",
    );
  await Promise.all([
    rateLimit("email-send", data.email, 5, 3600),
    rateLimit("email-send-ip", ip, 20, 3600),
  ]);
  const id = newId("ver"),
    token = newToken(),
    code = randomInt(0, 1000000).toString().padStart(6, "0");
  const payload: Payload = {
    ...data,
    inviteCode: data.inviteCode ? hashToken(data.inviteCode) : undefined,
    ...(ctx && data.intent === "account"
      ? { teamId: ctx.teamId, memberId: ctx.memberId }
      : {}),
  };
  const hash = await hashCode(code);
  await getSql().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${data.email}))`;
    const recent =
      await tx`SELECT id FROM email_verifications WHERE email = ${data.email} AND created_at > now() - interval '30 seconds'`;
    if (recent.length)
      throw new HiveError(
        "Wait 30 seconds before requesting another code.",
        429,
      );
    await tx`UPDATE email_verifications SET consumed_at = now() WHERE email = ${data.email} AND consumed_at IS NULL`;
    await tx`INSERT INTO email_verifications (id, email, token_hash, code_hash, payload, expires_at) VALUES (${id}, ${data.email}, ${hashToken(token)}, ${hash}, ${tx.json(payload)}, now() + interval '15 minutes')`;
  });
  if (!(await delivery(data.email, code, id)))
    throw new HiveError("We could not send the code. Please try later.", 502);
  await getSql()`UPDATE email_verifications SET delivered = true WHERE id = ${id} AND email = ${data.email} AND consumed_at IS NULL`;
  await accessEvent(ctx, "email_verification_sent");
  return { verificationToken: token, expiresIn: 900 };
}
export async function completeEmailCode(
  token: string,
  code: string,
  ip: string,
  ctx?: HiveContext,
) {
  if (!emailConfigured())
    throw new HiveError(
      "Email verification is unavailable. Please try later.",
      503,
    );
  await Promise.all([
    rateLimit("email-verify", token, 30, 60),
    rateLimit("email-verify-ip", ip, 60, 60),
  ]);
  const result = await getSql().begin(async (tx) => {
    const rows =
      await tx`SELECT *, expires_at <= now() AS expired FROM email_verifications WHERE token_hash = ${hashToken(token)} FOR UPDATE`;
    const row = rows[0];
    if (!row || row.consumed_at || !row.delivered)
      return {
        error: "This code is invalid. Check your email or request a new code.",
      };
    if (row.expired)
      return { error: "This code has expired. Request a new code." };
    if (row.attempts >= 5)
      return { error: "Too many attempts. Request a new code." };
    const correct =
      /^\d{6}$/.test(code) && (await verifyCode(code, row.code_hash));
    await tx`UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ${row.id} AND token_hash = ${hashToken(token)}`;
    if (!correct)
      return {
        error: "This code is invalid. Check your email or request a new code.",
      };
    const payload = row.payload as Payload;
    if (payload.intent === "account") {
      if (
        !ctx ||
        ctx.teamId !== payload.teamId ||
        ctx.memberId !== payload.memberId
      )
        return { error: "Sign in with the account that requested this code." };
      const conflict =
        await tx`SELECT id FROM members WHERE email = ${row.email} AND id <> ${ctx.memberId}`;
      if (conflict.length)
        return { error: "This email already belongs to a member." };
      const updated =
        await tx`UPDATE members SET email = ${row.email}, email_verified = true WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} AND removed_at IS NULL RETURNING id`;
      if (!updated.length) return { error: "Member not found." };
      await tx`UPDATE email_verifications SET consumed_at = now() WHERE id = ${row.id} AND token_hash = ${hashToken(token)}`;
      return {
        ctx,
        analytics: {
          outcome: null,
          keyId: null,
          role: null,
          verifiedEmail: null,
        },
      };
    }
    const existing =
      await tx`SELECT id FROM members WHERE email = ${row.email}`;
    if (existing.length)
      return {
        error:
          "This email already belongs to a member. Sign in or set your password with an email code.",
      };
    let teamId = newId("team"),
      teamName = payload.teamName ?? "",
      inviteCode: string | undefined;
    if (payload.intent === "teams") {
      inviteCode = `hive-${newToken()}`;
      await tx`INSERT INTO teams (id, name, invite_code) VALUES (${teamId}, ${teamName}, ${hashToken(inviteCode)})`;
    } else {
      const teams =
        payload.intent === "join"
          ? await tx`SELECT id, name FROM teams WHERE invite_code = ${payload.inviteCode!} AND invite_expires_at > now() FOR UPDATE`
          : await tx`SELECT t.id, t.name FROM teams t JOIN team_domains d ON d.team_id = t.id WHERE d.domain = ${emailDomain(row.email)} FOR UPDATE OF t`;
      if (!teams.length)
        return {
          error:
            "No hive matches your invite code or work domain. Check with your team admin.",
        };
      teamId = teams[0].id;
      teamName = teams[0].name;
    }
    const memberId = newId("mem"),
      apiKey = `hm_${newToken()}`;
    await tx`INSERT INTO members (id, team_id, name, email, email_verified, role) VALUES (${memberId}, ${teamId}, ${payload.memberName}, ${row.email}, true, ${payload.intent === "teams" ? "admin" : "member"})`;
    const keyId = newId("key");
    await tx`INSERT INTO api_keys (id, team_id, member_id, key_hash, prefix) VALUES (${keyId}, ${teamId}, ${memberId}, ${hashToken(apiKey)}, ${apiKey.slice(0, 10)})`;
    await tx`UPDATE email_verifications SET consumed_at = now() WHERE id = ${row.id} AND token_hash = ${hashToken(token)}`;
    return {
      ctx: { teamId, teamName, memberId, memberName: payload.memberName },
      apiKey,
      inviteCode,
      analytics: {
        outcome: payload.intent,
        verifiedEmail: row.email as string,
        keyId,
        role:
          payload.intent === "teams" ? ("admin" as const) : ("member" as const),
      },
    };
  });
  if ("error" in result) throw new HiveInputError(result.error);
  const { analytics, ...value } = result;
  if (analytics.keyId) bindApiKey(value.ctx, analytics.keyId);
  if (analytics.role) bindRole(value.ctx, analytics.role);
  await withActor(value.ctx, async () => {
    await accessEvent(value.ctx, "email_verified");
    if (analytics.outcome) {
      await accessEvent(value.ctx, "signup", {
        earlyAccessId: analytics.verifiedEmail
          ? await earlyAccessIdForEmail(analytics.verifiedEmail)
          : null,
      });
      await accessEvent(
        value.ctx,
        analytics.outcome === "teams"
          ? "invite_created"
          : analytics.outcome === "join"
            ? "invite_accepted"
            : "domain_join",
      );
      await accessEvent(
        value.ctx,
        "key_created",
        { keyId: analytics.keyId },
        analytics.keyId ?? undefined,
      );
    }
  });
  return value;
}
