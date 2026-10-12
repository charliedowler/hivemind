import { readFile, readdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { hashToken } from "../src/server/db/ids";
import {
  fixtureTeam,
  fixtureMember,
  fixtureOtherTeam,
  fixtureOtherMember,
  seedFixture,
} from "../src/server/analytics/fixtures";

async function main() {
  const url = process.env.HIVE_ANALYTICS_TEST_DATABASE_URL;
  if (!url)
    throw new Error(
      "Set HIVE_ANALYTICS_TEST_DATABASE_URL to the local test database",
    );
  const target = new URL(url);
  if (
    target.hostname !== "127.0.0.1" ||
    target.port !== "54329" ||
    target.pathname !== "/hivemind"
  )
    throw new Error("Use the dedicated local PostgreSQL endpoint");
  const schema = `hive_analytics_demo_${Date.now()}`;
  const control = postgres(url, { max: 1, onnotice: () => {} });
  await control`CREATE SCHEMA ${control(schema)}`;
  await control.end();
  const sql = postgres(url, {
    max: 1,
    connection: { search_path: `${schema},public` },
    onnotice: () => {},
  });
  try {
    const directory = new URL("../drizzle/", import.meta.url);
    await sql`CREATE TABLE _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    for (const name of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      await sql.begin(async (tx) => {
        await tx.unsafe(await readFile(new URL(name, directory), "utf8"));
        await tx`INSERT INTO _migrations (name) VALUES (${name})`;
      });
    }
    await sql`INSERT INTO teams (id, name, invite_code) VALUES (${fixtureTeam}, 'Analytics fixture', 'fixture-invite-a'), (${fixtureOtherTeam}, 'Other fixture', 'fixture-invite-b')`;
    await sql`INSERT INTO members (id, team_id, name, role) VALUES (${fixtureMember}, ${fixtureTeam}, 'Fixture admin', 'admin'), (${fixtureOtherMember}, ${fixtureOtherTeam}, 'Other admin', 'admin'), ('mem_cccccccccccc', ${fixtureTeam}, 'Fixture member', 'member')`;
    await sql`INSERT INTO web_sessions (id, member_id, team_id, token_hash, expires_at) VALUES ('ses_aaaaaaaaaaaa', ${fixtureMember}, ${fixtureTeam}, ${hashToken("analytics-local-fixture-session")}, now() + interval '1 day'), ('ses_cccccccccccc', 'mem_cccccccccccc', ${fixtureTeam}, ${hashToken("analytics-local-fixture-member")}, now() + interval '1 day')`;
    await sql`INSERT INTO early_access (id, email, source) VALUES ('ea_aaaaaaaaaaaa', 'fixture@example.invalid', 'waitlist')`;
    await seedFixture(sql);
    target.searchParams.set("options", `-c search_path=${schema},public`);
    await writeFile(
      new URL("../.env.local", import.meta.url),
      `DATABASE_URL=${target}\nPUBLIC_URL=http://localhost:3017\nHIVE_ANALYTICS_TRAFFIC=synthetic\n`,
      { mode: 0o600, flag: "wx" },
    );
    await writeFile("/tmp/hive-analytics-fixture-schema", schema);
    console.log(`Prepared isolated local schema ${schema}`);
  } finally {
    await sql.end();
  }
}
main().catch(() => {
  console.error("Local analytics fixture setup failed");
  process.exitCode = 1;
});
