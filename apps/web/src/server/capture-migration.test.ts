import {readFile, readdir} from "node:fs/promises";
import postgres from "postgres";
import {describe, expect, it} from "vitest";
import {randomUUID} from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("capture migration", () => {
  it("upgrades existing cells, is repeatable and refuses rollback of private history", async () => {
    const sql = postgres(databaseUrl!, {prepare: false, max: 1, onnotice: () => {}});
    const schema = `capture_migration_${randomUUID().replaceAll("-", "")}`;
    try {
      await sql`CREATE SCHEMA ${sql(schema)}`;
      await sql`SET search_path TO ${sql(schema)}, public`;
      await sql`SET synchronous_commit = off`;
      const directory = new URL("../../drizzle/", import.meta.url);
      const files = await readdir(directory);
      const migration = files.find(file => /^\d+_capture_rules\.sql$/.test(file));
      if (!migration) throw new Error("Capture migration is missing.");
      for (const filename of files.filter(file => file.endsWith(".sql") && file < migration).sort()) {
        const body = await readFile(new URL(filename, directory), "utf8");
        await sql.begin(async tx => {await tx.unsafe(body);});
      }
      await sql`CREATE TABLE _migrations (name text PRIMARY KEY)`;
      await sql`INSERT INTO teams (id, name, invite_code, invite_expires_at) VALUES ('team_fixture', 'Fixture', 'fixture', now() + interval '1 day')`;
      await sql`INSERT INTO members (id, team_id, name, role) VALUES ('mem_fixture', 'team_fixture', 'Owner', 'admin')`;
      await sql`INSERT INTO learnings (id, team_id, member_id, title, body, kind, source, confidence) VALUES ('lrn_fixture', 'team_fixture', 'mem_fixture', 'Existing cell', 'Existing fact', 'learning', 'manual', 0.7)`;
      const body = await readFile(new URL(migration, directory), "utf8");
      for (let run = 0; run < 2; run++) await sql.begin(async tx => {await tx.unsafe(body);});
      const upgraded = await sql`SELECT title, capture_flagged, capture_redacted, capture_rule_ids, capture_categories, capture_context FROM learnings WHERE id = 'lrn_fixture'`;
      expect(upgraded[0]).toMatchObject({title: "Existing cell", capture_flagged: false, capture_redacted: false, capture_rule_ids: [], capture_categories: {}, capture_context: {}});
      const rollback = await readFile(new URL(`rollback/${migration}`, directory), "utf8");
      await sql.unsafe(rollback);
      expect(await sql`SELECT 1 FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'learnings' AND column_name = 'capture_flagged'`).toHaveLength(0);
      await sql.begin(async tx => {await tx.unsafe(body);});
      await sql`INSERT INTO capture_rules (id, team_id, member_id, created_by, name, scope, kind, action, config) VALUES ('crule_fixture', 'team_fixture', 'mem_fixture', 'mem_fixture', 'Fixture rule', 'member', 'keyword', 'drop', '{"pattern":"fixture"}')`;
      await expect(sql.unsafe(rollback)).rejects.toThrow("Export and preserve");
      await sql`ROLLBACK`;
      expect(await sql`SELECT id FROM capture_rules WHERE id = 'crule_fixture'`).toHaveLength(1);
      expect(await sql`SELECT 1 FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'learnings' AND column_name = 'capture_flagged'`).toHaveLength(1);
    } finally {
      await sql`SET search_path TO public`;
      if (/^capture_migration_[0-9a-f]{32}$/.test(schema)) await sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`;
      await sql.end();
    }
  }, 60000);
});
