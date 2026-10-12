import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import postgres from "postgres";
import { newId } from "../db/ids";
const url = process.env.HIVE_DIGEST_TEST_DATABASE_URL;
const forward = () =>
  readFile(
    new URL("../../../drizzle/0016_slack_digests.sql", import.meta.url),
    "utf8",
  );
const rollback = () =>
  readFile(
    new URL(
      "../../../drizzle/rollback/0016_slack_digests.sql",
      import.meta.url,
    ),
    "utf8",
  );
async function dryRun(populated: boolean) {
  if (
    !url ||
    new URL(url).hostname !== "127.0.0.1" ||
    !new URL(url).pathname.includes("hive_digest")
  )
    throw new Error("Use the dedicated local digest database.");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      const schema = newId("digest_migration");
      await tx`CREATE SCHEMA ${tx(schema)}`;
      await tx`SELECT set_config('search_path',${schema + ",public"},true)`;
      await tx`CREATE TABLE _migrations(name text PRIMARY KEY)`;
      await tx.unsafe(await forward());
      await tx.unsafe(await forward());
      if (populated) {
        const team = newId("team"),
          member = newId("mem");
        await tx`INSERT INTO public.teams(id,name,invite_code,invite_expires_at)VALUES(${team},'Migration fixture',${newId("invite")},now()+interval '1 day')`;
        await tx`INSERT INTO public.members(id,team_id,name,role)VALUES(${member},${team},'Admin','admin')`;
        await tx`INSERT INTO slack_digest_schedules(id,team_id,channel_id,channel_name,cadence,local_time,timezone,next_due_at,created_by) VALUES(${newId("dgs")},${team},'CFIXTURE','fixture','daily','09:00','UTC',now(),${member})`;
      }
      await tx.unsafe(await rollback());
      throw new Error("Empty rollback passed.");
    });
  } finally {
    await sql.end();
  }
}
it.skipIf(!url)(
  "applies the final migration twice and rolls back empty tables",
  async () => {
    await expect(dryRun(false)).rejects.toThrow("Empty rollback passed.");
  },
);
it.skipIf(!url)("refuses to remove populated digest history", async () => {
  await expect(dryRun(true)).rejects.toThrow("Digest records exist.");
});
