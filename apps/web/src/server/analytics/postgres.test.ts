import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eventRow, originFor, type EventRow } from "./events";
import {
  fixtureContext,
  fixtureOtherTeam,
  fixtureTeam,
  seedFixture,
} from "./fixtures";
import { analyticsReports, reportNames } from "./reports";
import { requireAdmin } from "../identity/access";

const url = process.env.HIVE_ANALYTICS_TEST_DATABASE_URL;
const schema = `hive_analytics_test_${randomUUID().replaceAll("-", "")}`;
let sql: postgres.Sql, control: postgres.Sql;
vi.mock("../db/client", () => ({ getSql: () => sql }));
const migration = new URL(
  "../../../drizzle/0013_analytics_events.sql",
  import.meta.url,
);
describe.skipIf(!url)("analytics on local PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      target.hostname !== "127.0.0.1" ||
      target.port !== "54329" ||
      target.pathname !== "/hivemind"
    )
      throw new Error("Use the dedicated local PostgreSQL endpoint");
    control = postgres(url!, { max: 1, onnotice: () => {} });
    await control`CREATE SCHEMA ${control(schema)}`;
    sql = postgres(url!, {
      max: 1,
      connection: { search_path: schema },
      onnotice: () => {},
    });
    await sql`CREATE TABLE members (id text, team_id text, role text, removed_at timestamptz)`;
    await sql`INSERT INTO members VALUES (${fixtureContext.memberId}, ${fixtureTeam}, 'admin', NULL), ('mem_cccccccccccc', ${fixtureTeam}, 'member', NULL), ('mem_dddddddddddd', ${fixtureOtherTeam}, 'admin', NULL)`;
    const body = await readFile(migration, "utf8");
    await sql.begin((tx) => tx.unsafe(body));
    await seedFixture(sql);
    await sql.begin((tx) => tx.unsafe(body));
  });
  afterAll(async () => {
    if (sql) await sql.end();
    if (control) {
      await control`DROP SCHEMA ${control(schema)} CASCADE`;
      await control.end();
    }
  });
  it("preserves append-only events on a repeated migration and on duplicate delivery", async () => {
    const row = eventRow({
      name: "learning.viewed",
      key: "immutable-fixture",
      origin: originFor(fixtureContext),
    });
    const insert = async (value: EventRow) =>
      sql`INSERT INTO analytics_events ${sql({ ...value, properties: sql.json(value.properties) })} ON CONFLICT DO NOTHING`;
    await insert(row);
    await insert({ ...row, outcome: "failed" });
    expect(
      (
        await sql`SELECT outcome FROM analytics_events WHERE event_key = ${row.event_key}`
      )[0].outcome,
    ).toBe("completed");
    for (const statement of [
      "UPDATE analytics_events SET outcome = 'failed'",
      "DELETE FROM analytics_events",
      "TRUNCATE analytics_events",
    ])
      await expect(sql.unsafe(statement)).rejects.toThrow("append-only");
  });
  it("gives the reporting role only SELECT on the ledger", async () => {
    const [row] =
      await sql`SELECT has_table_privilege('hive_reporting', ${schema + ".analytics_events"}, 'SELECT') AS readable, has_table_privilege('hive_reporting', ${schema + ".analytics_events"}, 'INSERT,UPDATE,DELETE,TRUNCATE') AS writable, has_table_privilege('hive_reporting', ${schema + ".members"}, 'SELECT') AS members_readable`;
    expect(row).toEqual({
      readable: true,
      writable: false,
      members_readable: false,
    });
  });
  it("runs all five reports with known counts and writes the seeded output", async () => {
    const reports = await analyticsReports(fixtureContext);
    expect(
      reports.usage.find(
        (row) => row.traffic === "synthetic" && row.entrypoint === "mcp",
      ),
    ).toMatchObject({ interactions: 5, active_members: 1, active_teams: 1 });
    expect(reports.usage.some((row) => row.traffic === "unclassified")).toBe(
      true,
    );
    expect(reports.usage.some((row) => row.traffic === "real")).toBe(true);
    expect(reports.funnel[0]).toMatchObject({
      waitlisted_signups: 1,
      signups: 1,
      key_or_oauth: 1,
      first_push: 1,
      first_ask: 1,
    });
    expect(
      reports.knowledge.filter((row) => row.kind === "friction")[0],
    ).toMatchObject({
      pushes: 2,
      merges: 1,
      friction_minutes: "12",
      unmeasured_friction: 1,
    });
    expect(
      reports.knowledge.reduce(
        (sum, row) => sum + Number(row.supersessions),
        0,
      ),
    ).toBe(1);
    expect(
      reports.quality.find(
        (row) => row.event_name === "ask.performed" && row.entrypoint === "web",
      ),
    ).toMatchObject({ ask_gap_percent: "100.0", p50_ms: 300 });
    expect(reports.quality.some((row) => row.sensitive_refusals === 1)).toBe(
      true,
    );
    expect(
      reports.stalls.filter((row) => row.stall === "missing_completion"),
    ).toHaveLength(2);
    expect(
      reports.stalls.filter((row) => row.stall === "observed_failure"),
    ).toHaveLength(1);
    await writeFile(
      "/tmp/hive-analytics-sql-output.json",
      JSON.stringify(reports, null, 2),
    );
    for (const name of reportNames)
      console.log(`${name}: ${JSON.stringify(reports[name])}`);
    for (const name of reportNames)
      expect(
        (
          await readFile(
            new URL(`../../../analytics/${name}.sql`, import.meta.url),
            "utf8",
          )
        ).length,
      ).toBeGreaterThan(100);
  });
  it("denies members, removed admins and admins from another team", async () => {
    await expect(
      analyticsReports({ ...fixtureContext, memberId: "mem_cccccccccccc" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      analyticsReports({ ...fixtureContext, memberId: "mem_dddddddddddd" }),
    ).rejects.toMatchObject({ status: 403 });
    const reports = await analyticsReports({
      ...fixtureContext,
      memberId: "mem_dddddddddddd",
      teamId: fixtureOtherTeam,
    });
    expect(reports.usage).toHaveLength(1);
    expect(reports.funnel).toEqual([]);
    expect(reports.stalls).toEqual([]);
    await sql`UPDATE members SET removed_at = now() WHERE id = ${fixtureContext.memberId}`;
    await expect(requireAdmin(fixtureContext)).rejects.toMatchObject({
      status: 403,
    });
    await sql`UPDATE members SET removed_at = NULL WHERE id = ${fixtureContext.memberId}`;
  });
  it("rejects schema rollback with recorded history", async () => {
    const rollback = await readFile(
      new URL(
        "../../../drizzle/rollback/0013_analytics_events.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await expect(sql.unsafe(rollback)).rejects.toThrow("Retain or archive");
    await sql`ROLLBACK`;
    expect(
      (await sql`SELECT count(*)::int AS count FROM analytics_events`)[0].count,
    ).toBeGreaterThan(0);
  });
});
