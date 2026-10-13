import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { getSql } from "../db/client";
import { hashToken, newId } from "../db/ids";
import { createAgentCredential } from "./agent-credentials";
vi.mock("server-only", () => ({}));

it.skipIf(!process.env.DATABASE_URL)("retires only legacy provider agents and preserves humans, current agents, memberships and cell history", async () => {
  const sql = getSql();
  const rollback = new Error("rollback fixture");
  await expect(sql.begin(async tx => {
    const owner = newId("mem"), legacy = newId("mem"), cell = newId("lrn");
    await tx`INSERT INTO members(id,name,email,email_verified) VALUES (${owner},'Human',${`${owner}@example.test`},true)`;
    const current = await createAgentCredential(tx, owner, "Codex", "Fixture", `ha_${"x".repeat(43)}`);
    const team = (await tx`SELECT id FROM teams WHERE personal_owner_member_id=${owner}`)[0].id;
    await tx`INSERT INTO members(id,name,actor_type,email_verified) VALUES (${legacy},'Legacy agent','agent',true)`;
    await tx`INSERT INTO auth_accounts(id,user_id,account_id,provider_id) VALUES (${newId("auth")},${legacy},${legacy},'agentid')`;
    await tx`INSERT INTO hive_memberships(member_id,team_id,role) VALUES (${legacy},${team},'member')`;
    await tx`INSERT INTO web_sessions(id,member_id,team_id,token_hash,expires_at) VALUES (${newId("auth")},${legacy},${team},${hashToken(legacy)},now()+interval '1 day')`;
    await tx`INSERT INTO learnings(id,member_id,team_id,title,body,kind,source,confidence) VALUES (${cell},${owner},${team},'Preserved cell','Preserved body','learning','manual',1)`;
    const humans = await tx`SELECT to_jsonb(m) AS value FROM members m WHERE id=${owner}`;
    const memberships = await tx`SELECT to_jsonb(h) AS value FROM hive_memberships h WHERE team_id=${team} ORDER BY member_id`;
    const cells = await tx`SELECT to_jsonb(l) AS value FROM learnings l WHERE id=${cell}`;
    const history = await tx`SELECT to_jsonb(v) AS value FROM learning_versions v WHERE learning_id=${cell}`;
    await tx.unsafe(await readFile(new URL("../../../drizzle/0033_retire_agentid.sql", import.meta.url), "utf8"));
    expect((await tx`SELECT disabled_at FROM members WHERE id=${legacy}`)[0].disabled_at).not.toBeNull();
    expect((await tx`SELECT disabled_at FROM members WHERE id=${current}`)[0].disabled_at).toBeNull();
    expect(await tx`SELECT id FROM web_sessions WHERE member_id=${legacy}`).toHaveLength(0);
    expect(await tx`SELECT to_jsonb(m) AS value FROM members m WHERE id=${owner}`).toEqual(humans);
    expect(await tx`SELECT to_jsonb(h) AS value FROM hive_memberships h WHERE team_id=${team} ORDER BY member_id`).toEqual(memberships);
    expect(await tx`SELECT to_jsonb(l) AS value FROM learnings l WHERE id=${cell}`).toEqual(cells);
    expect(await tx`SELECT to_jsonb(v) AS value FROM learning_versions v WHERE learning_id=${cell}`).toEqual(history);
    throw rollback;
  })).rejects.toBe(rollback);
});
