import { afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { getSql } from "./db/client";
import { newId } from "./db/ids";
import { enrollMember } from "./identity/enrollment";
import { listCaptureRules, updateCaptureRule } from "./capture-rules";
import { captureDefaults, defaultCaptureRuleId } from "@/lib/capture-defaults";

const enabled = process.env.DATABASE_URL?.includes("127.0.0.1:54329/hive_capture_rules_");
describe.skipIf(!enabled)("default capture exclusions", () => {
  const teams: string[] = [];
  const members: string[] = [];
  async function enroll() {
    const id = newId("mem"); members.push(id);
    await getSql()`INSERT INTO members (id, name, email, email_verified) VALUES (${id}, 'Owner', ${`${id}@example.test`}, true)`;
    const ctx = await enrollMember(id, {intent: "create", teamName: "Default test"});
    if (!ctx) throw new Error("Enrollment failed");
    teams.push(ctx.teamId); return ctx;
  }
  afterAll(async () => {
    const sql = getSql();
    for (const table of ["capture_rules", "web_sessions", "members"]) await sql`DELETE FROM ${sql(table)} WHERE team_id = ANY(${teams}::text[])`;
    await sql`DELETE FROM teams WHERE id = ANY(${teams}::text[])`;
    await sql`DELETE FROM members WHERE id = ANY(${members}::text[])`;
    await sql.end();
  });
  it("creates all three exclusions on when a verified owner creates a team", async () => {
    const ctx = await enroll();
    const rules = await listCaptureRules(ctx);
    expect(rules).toHaveLength(3);
    for (const item of captureDefaults) expect(rules).toContainEqual(expect.objectContaining({id: defaultCaptureRuleId(ctx.teamId, item.category), scope: "team", kind: "content_category", category: item.category, action: "drop", enabled: true, createdBy: ctx.memberId}));
    await enrollMember(ctx.memberId);
    expect(await listCaptureRules(ctx)).toHaveLength(3);
  });
  it("backfills existing teams once and preserves an owner's disabled choice on replay", async () => {
    const ctx = await enroll();
    await getSql()`DELETE FROM capture_rules WHERE team_id = ${ctx.teamId}`;
    const migration = await readFile(new URL("../../drizzle/0024_default_capture_rules.sql", import.meta.url), "utf8");
    await getSql().begin(tx => tx.unsafe(migration));
    const rules = await listCaptureRules(ctx); expect(rules).toHaveLength(3);
    await updateCaptureRule(ctx, rules[0].id, {...rules[0], enabled: false});
    await getSql().begin(tx => tx.unsafe(migration));
    const after = await listCaptureRules(ctx);
    expect(after).toHaveLength(3); expect(after.find(rule => rule.id === rules[0].id)?.enabled).toBe(false);
    const rollback = await readFile(new URL("../../drizzle/rollback/0024_default_capture_rules.sql", import.meta.url), "utf8");
    await expect(getSql().begin(tx => tx.unsafe(rollback))).rejects.toThrow("rollback refused");
    expect(await listCaptureRules(ctx)).toHaveLength(3);
  });
});
