import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.DATABASE_URL)(
  "capture and outcome migrations",
  () => {
    it("upgrades old rows, repeats safely, and refuses rollback with new history", async () => {
      const sql = postgres(process.env.DATABASE_URL!, {
        prepare: false,
        max: 1,
        onnotice: () => {},
      });
      const schema = `capture_outcome_${randomUUID().replaceAll("-", "")}`;
      const directory = new URL("../../drizzle/", import.meta.url);
      try {
        await sql`CREATE SCHEMA ${sql(schema)}`;
        await sql`SET search_path TO ${sql(schema)}, public`;
        for (const name of (await readdir(directory))
          .filter((name) => name.endsWith(".sql") && name < "0022")
          .sort())
          await sql.begin(async (tx) => {
            await tx.unsafe(await readFile(new URL(name, directory), "utf8"));
          });
        await sql`CREATE TABLE _migrations (name text PRIMARY KEY)`;
        await sql`INSERT INTO teams (id, name, invite_code) VALUES ('team_fixture', 'Fixture', 'fixture')`;
        await sql`INSERT INTO members (id, team_id, name) VALUES ('mem_fixture', 'team_fixture', 'Fixture')`;
        await sql`INSERT INTO learnings (id, team_id, member_id, title, body, kind, source, confidence, blocked) VALUES ('lrn_fixture', 'team_fixture', 'mem_fixture', 'Old fact', 'Old body', 'learning', 'manual', 0.7, false)`;
        const names = [
          "0022_capture_contract.sql",
          "0023_outcome_feedback.sql",
        ];
        for (const name of names)
          for (let pass = 0; pass < 2; pass++)
            await sql.begin(async (tx) => {
              await tx.unsafe(await readFile(new URL(name, directory), "utf8"));
            });
        expect(
          (
            await sql`SELECT blocked, body FROM learnings WHERE id = 'lrn_fixture'`
          )[0],
        ).toMatchObject({ blocked: false, body: "Old body" });
        await sql`UPDATE learnings SET blocked = NULL WHERE id = 'lrn_fixture'`;
        expect(
          (await sql`SELECT blocked FROM learnings WHERE id = 'lrn_fixture'`)[0]
            .blocked,
        ).toBeNull();
        const rollback22 = await readFile(
          new URL("rollback/0022_capture_contract.sql", directory),
          "utf8",
        );
        await expect(sql.unsafe(rollback22)).rejects.toThrow(
          "Export and preserve",
        );
        await sql`ROLLBACK`;
        const rollback23 = await readFile(
          new URL("rollback/0023_outcome_feedback.sql", directory),
          "utf8",
        );
        await sql.unsafe(rollback23);
        await sql.begin(async (tx) => {
          await tx.unsafe(await readFile(new URL(names[1], directory), "utf8"));
        });
        await sql`INSERT INTO feedback_receipts (id, team_id, learning_id, member_id, action, classification, before_state, after_state) VALUES ('fbr_fixture', 'team_fixture', 'lrn_fixture', 'mem_fixture', 'report', 'inconclusive', '{}', '{}')`;
        await expect(sql.unsafe(rollback23)).rejects.toThrow(
          "Export and preserve",
        );
        await sql`ROLLBACK`;
        expect(await sql`SELECT id FROM feedback_receipts`).toHaveLength(1);
        await sql`INSERT INTO learning_pushes (id, learning_id, team_id, member_id, source, merged, blocked, capture_key) VALUES ('psh_fixture', 'lrn_fixture', 'team_fixture', 'mem_fixture', 'manual', false, NULL, 'fixture-key')`;
        await expect(
          sql`INSERT INTO learning_pushes (id, learning_id, team_id, member_id, source, merged, capture_key) VALUES ('psh_duplicate', 'lrn_fixture', 'team_fixture', 'mem_fixture', 'manual', true, 'fixture-key')`,
        ).rejects.toMatchObject({ code: "23505" });
      } finally {
        await sql`SET search_path TO public`;
        if (/^capture_outcome_[0-9a-f]{32}$/.test(schema))
          await sql`DROP SCHEMA ${sql(schema)} CASCADE`;
        await sql.end();
      }
    }, 60000);
  },
);
