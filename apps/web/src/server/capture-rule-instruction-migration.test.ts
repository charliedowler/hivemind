import {readFile} from "node:fs/promises";
import postgres from "postgres";
import {describe, expect, it} from "vitest";
import {newId} from "./db/ids";

const enabled = process.env.DATABASE_URL?.startsWith("postgres://hivemind:hivemind@127.0.0.1:54329/hive_capture_rules_");
describe.skipIf(!enabled)("capture instruction migration", () => {
  it("replays safely, replaces an empty local proposal table and preserves populated audits on rollback", async () => {
    const sql = postgres(process.env.DATABASE_URL!, {prepare: false, max: 1, onnotice: () => {}});
    const schema = newId("instruction_migration");
    const migration = await readFile(new URL("../../drizzle/0020_capture_rule_instructions.sql", import.meta.url), "utf8");
    const rollback = await readFile(new URL("../../drizzle/rollback/0020_capture_rule_instructions.sql", import.meta.url), "utf8");
    try {
      await sql`CREATE SCHEMA ${sql(schema)}`;
      await sql`SET search_path TO ${sql(schema)}`;
      await sql`CREATE TABLE teams (id text PRIMARY KEY)`;
      await sql`CREATE TABLE members (id text, team_id text, UNIQUE(id, team_id))`;
      await sql`CREATE TABLE _migrations (name text PRIMARY KEY)`;
      await sql`CREATE TABLE capture_rules (id text, source text)`;
      await sql`CREATE TABLE capture_rule_applications (id text)`;
      await sql`CREATE TABLE capture_rule_proposals (id text)`;
      await sql`INSERT INTO capture_rules VALUES ('saved-rule', 'slack')`;
      await sql`INSERT INTO teams VALUES ('fixture')`;
      await sql`INSERT INTO members VALUES ('fixture', 'fixture')`;
      await sql`INSERT INTO _migrations VALUES ('0018_capture_rule_proposals.sql'), ('0199_capture_rule_instructions.sql'), ('0017_capture_rules.sql')`;
      for (let attempt = 0; attempt < 2; attempt++) {
        await sql.begin(async tx => {
          await tx.unsafe(migration);
          expect((await tx`SHOW lock_timeout`)[0].lock_timeout).toBe("3s");
          expect((await tx`SHOW statement_timeout`)[0].statement_timeout).toBe("30s");
        });
      }
      expect((await sql`SELECT to_regclass('capture_rule_proposals') AS name`)[0].name).toBeNull();
      await expect(sql`INSERT INTO capture_rule_instructions (id, team_id, member_id, source, decision, outcome, restatement, natural_text) VALUES ('bad', 'fixture', 'fixture', 'slack', '{}'::jsonb, 'question', 'Fixture', 'Fixture')`).rejects.toThrow();
      await sql`INSERT INTO capture_rule_instructions (id, team_id, member_id, source, decision, outcome, restatement, natural_text) VALUES ('audit', 'fixture', 'fixture', 'web', '{}'::jsonb, 'question', 'Fixture', 'Fixture')`;
      await expect(sql.unsafe(rollback)).rejects.toThrow("preserve capture instruction audits");
      await sql`ROLLBACK`;
      expect(await sql`SELECT id FROM capture_rule_instructions`).toHaveLength(1);
      await sql`DELETE FROM capture_rule_instructions`;
      await sql.unsafe(rollback);
      expect((await sql`SELECT to_regclass('capture_rule_instructions') AS name`)[0].name).toBeNull();
      expect(await sql`SELECT name FROM _migrations`).toEqual([{name: "0017_capture_rules.sql"}]);
      expect(await sql`SELECT id FROM capture_rules`).toEqual([{id: "saved-rule"}]);
      await sql`CREATE TABLE capture_rule_proposals (id text)`;
      await sql`INSERT INTO capture_rule_proposals VALUES ('pending')`;
      await expect(sql.begin(tx => tx.unsafe(migration))).rejects.toThrow("Preserve pending capture rule proposals");
      expect(await sql`SELECT id FROM capture_rule_proposals`).toHaveLength(1);
    } finally {
      await sql`ROLLBACK`;
      await sql`SET search_path TO public`;
      await sql`DROP SCHEMA ${sql(schema)} CASCADE`;
      await sql.end();
    }
  });
});
