import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import postgres from "postgres";

async function migrate() {
  const envPath = fileURLToPath(new URL("../.env.local", import.meta.url));
  if (existsSync(envPath)) loadEnvFile(envPath);
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before running migrations.");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
  try {
    await sql`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const directory = new URL("../drizzle/", import.meta.url);
    for (const name of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
      if ((await sql`SELECT name FROM _migrations WHERE name = ${name}`).length) continue;
      const body = await readFile(new URL(name, directory), "utf8");
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(body);
          await tx`INSERT INTO _migrations (name) VALUES (${name})`;
        });
        console.log(`Applied ${name}`);
      } catch (error) {
        if (name !== "0002_pgvector.sql") throw error;
        console.warn("pgvector migration could not be applied. The hive will use full-text search.");
      }
    }
    console.log("Migrations are up to date.");
  } finally {
    await sql.end();
  }
}

migrate().catch((error: unknown) => { console.error(error instanceof postgres.PostgresError ? `Database error ${error.code}` : "Migration runner failed"); console.error("Migration failed. Check DATABASE_URL and database permissions."); process.exitCode = 1; });
