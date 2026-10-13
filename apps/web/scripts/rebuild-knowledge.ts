import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSql } from "../src/server/db/client";
import { ensureKnowledge } from "../src/server/knowledge-tree";
async function main() {
  const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
  if (existsSync(envPath)) loadEnvFile(envPath);
  const sql = getSql();
  try {
    const teams =
      await sql`SELECT t.id, t.name, m.id AS member_id, m.name AS member_name FROM teams t JOIN LATERAL (SELECT person.id, person.name FROM members person JOIN hive_memberships h ON h.member_id = person.id WHERE h.team_id = t.id AND h.role = 'admin' AND h.removed_at IS NULL AND person.disabled_at IS NULL AND NOT person.provisional ORDER BY h.joined_at, person.id LIMIT 1) m ON true`;
    for (const team of teams) {
      const ctx = {
        teamId: team.id,
        teamName: team.name,
        memberId: team.member_id,
        memberName: team.member_name,
      };
      const result = await ensureKnowledge(ctx, true);
      while (
        (
          await sql`SELECT count(*)::int AS count FROM learning_evidence WHERE team_id = ${ctx.teamId} AND uploaded_at IS NULL`
        )[0].count > 0
      )
        await ensureKnowledge(ctx);
      console.log(
        `${team.id}: revision ${result.revision}, ${Object.keys(result.manifest).length} files`,
      );
    }
  } finally {
    await sql.end();
  }
}
main().catch(() => {
  console.error(
    "Knowledge rebuild failed. Check database and private Blob configuration.",
  );
  process.exitCode = 1;
});
