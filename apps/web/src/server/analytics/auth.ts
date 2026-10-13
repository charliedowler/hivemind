import { currentOrigin, getAnalyticsSql, originFor, recordEvent, type EventInput } from "./events";

export async function authAccess(
  identity: { memberId: string } | { email: string },
  outcome: EventInput["outcome"],
  key?: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sql = getAnalyticsSql();
    const query = sql`SELECT m.id FROM members m WHERE ${"memberId" in identity ? sql`m.id = ${identity.memberId}` : sql`m.email = ${identity.email.trim().toLowerCase()}`} AND m.disabled_at IS NULL AND NOT m.provisional`;
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
      origin: { ...(currentOrigin() ?? originFor()), teamId: null, memberId: member?.id ?? null, apiKeyId: null, sessionKind: member ? "web_session" : "anonymous" },
      properties: { actorKind: member ? "member" : "anonymous", role: null },
    });
  } catch {
  } finally {
    if (timer) clearTimeout(timer);
  }
}
