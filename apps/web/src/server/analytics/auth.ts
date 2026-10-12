import { currentOrigin, getAnalyticsSql, originFor, recordEvent, type EventInput } from "./events";

export async function authAccess(
  identity: { memberId: string } | { email: string },
  outcome: EventInput["outcome"],
  key?: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sql = getAnalyticsSql();
    const query = sql`SELECT id, team_id, role FROM members WHERE ${"memberId" in identity ? sql`id = ${identity.memberId}` : sql`email = ${identity.email.trim().toLowerCase()}`} AND removed_at IS NULL`;
    const rows = await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { query.cancel(); reject(new Error("AnalyticsLookupTimeout")); }, 500);
      }),
    ]);
    const member = rows[0];
    if (!member && outcome !== "email_verification_sent") return;
    await recordEvent({
      name: "access.changed",
      outcome,
      key: key ? `${outcome}:${key}` : undefined,
      origin: { ...(currentOrigin() ?? originFor()), teamId: member?.team_id ?? null, memberId: member?.id ?? null, apiKeyId: null, sessionKind: member ? "web_session" : "anonymous" },
      properties: { actorKind: member ? "member" : "anonymous", role: member?.role ?? null },
    });
  } catch {
  } finally {
    if (timer) clearTimeout(timer);
  }
}
