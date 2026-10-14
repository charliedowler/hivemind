import { createHash } from "node:crypto";
import type postgres from "postgres";
import { getSql } from "../db/client";
import { forgetCachedAuth } from "../auth-cache";

type Sql = ReturnType<typeof getSql>;
type Transaction = postgres.TransactionSql;

export async function oauthCutoverReportInTransaction(tx: Sql | Transaction) {
  const rows = await tx`SELECT kind,id,user_id FROM (
    SELECT 'access' AS kind,id,user_id FROM auth_oauth_access_token WHERE revoked IS NULL
    UNION ALL SELECT 'refresh',id,user_id FROM auth_oauth_refresh_token WHERE revoked IS NULL
    UNION ALL SELECT 'consent',id,user_id FROM auth_oauth_consent
  ) grants ORDER BY user_id,kind,id`;
  const people = await tx`SELECT id,name,email FROM members WHERE id IN ${tx([...new Set(rows.map(r => r.user_id))].concat(""))} ORDER BY id`;
  return {
    digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    people: people.map(person => ({ memberId: person.id, name: person.name, email: person.email, access: rows.filter(r => r.user_id === person.id && r.kind === "access").length, refresh: rows.filter(r => r.user_id === person.id && r.kind === "refresh").length, consent: rows.filter(r => r.user_id === person.id && r.kind === "consent").length })),
    totals: { access: rows.filter(r => r.kind === "access").length, refresh: rows.filter(r => r.kind === "refresh").length, consent: rows.filter(r => r.kind === "consent").length },
  };
}

export async function oauthCutoverReport() {
  return getSql().begin(tx => oauthCutoverReportInTransaction(tx));
}

export async function revokeLegacyOAuth(expectedDigest: string) {
  const result = await getSql().begin(tx => revokeLegacyOAuthInTransaction(tx, expectedDigest));
  forgetCachedAuth();
  return result;
}

export async function revokeLegacyOAuthInTransaction(tx: Transaction, expectedDigest: string) {
    await tx`SELECT pg_advisory_xact_lock(hashtext('hive-oauth-cutover'))`;
    const marker = await tx`SELECT value FROM auth_verification WHERE id='hive-oauth-cutover' FOR UPDATE`;
    if (!marker.length) throw new Error("Apply schema migration 0029 first.");
    if (marker[0].value !== "0") throw new Error("OAuth revocation has already run.");
    const current = await oauthCutoverReportInTransaction(tx);
    if (current.digest !== expectedDigest) throw new Error("Grants changed. Run dry-run again and approve the new report.");
    const cutoff = (await tx`SELECT clock_timestamp() AS value`)[0].value;
    await tx`UPDATE auth_verification SET value=${String(Math.ceil(cutoff.getTime()/1000))},updated_at=${cutoff} WHERE id='hive-oauth-cutover'`;
    await tx`UPDATE auth_oauth_access_token SET revoked=${cutoff} WHERE revoked IS NULL AND created_at <= ${cutoff}`;
    await tx`UPDATE auth_oauth_refresh_token SET revoked=${cutoff} WHERE revoked IS NULL AND created_at <= ${cutoff}`;
    await tx`DELETE FROM auth_oauth_consent WHERE created_at <= ${cutoff}`;
    return { ...current, appliedAt: cutoff.toISOString() };
}
