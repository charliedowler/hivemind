import { getSql } from "./db/client";
import { newId } from "./db/ids";

export async function saveEarlyAccess(input: {
  email: string;
  name?: string;
  company?: string;
  teamSize?: string;
  source?: string;
}): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  return getSql().begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`early-access:${email}`}, 0))`;
    const existing = await sql`
      SELECT id FROM early_access WHERE lower(trim(email)) = ${email}
      ORDER BY created_at, id LIMIT 1
    `;
    if (existing[0]) return { id: String(existing[0].id) };
    const id = newId("ea");
    await sql`
      INSERT INTO early_access (id, email, name, company, team_size, source)
      VALUES (${id}, ${email}, ${input.name ?? null}, ${input.company ?? null},
        ${input.teamSize ?? null}, ${input.source ?? "landing"})
    `;
    return { id };
  });
}
