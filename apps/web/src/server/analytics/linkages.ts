import { getAnalyticsSql } from "./events";

export async function earlyAccessIdForEmail(
  email: string,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sql = getAnalyticsSql();
    const query = sql`SELECT id FROM early_access WHERE lower(trim(email)) = ${email} ORDER BY created_at LIMIT 1`;
    const rows = await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          query.cancel();
          reject(new Error("AnalyticsLookupTimeout"));
        }, 500);
      }),
    ]);
    return rows[0]?.id ?? null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
