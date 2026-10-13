import { expect, it } from "vitest";
import postgres from "postgres";
import { newId } from "../db/ids";
import { gatherDigest } from "./data";
const url = process.env.HIVE_DIGEST_TEST_DATABASE_URL;
it.skipIf(!url)(
  "omits every flagged record and masks flagged successors after the column appears",
  async () => {
    if (
      !url ||
      new URL(url).hostname !== "127.0.0.1" ||
      !new URL(url).pathname.includes("hive_digest")
    )
      throw new Error("Use the dedicated local digest database.");
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    const rollback = new Error("Fixture rollback");
    try {
      await expect(
        sql.begin(async (tx) => {
          const schema = newId("capture_digest");
          await tx`CREATE SCHEMA ${tx(schema)}`;
          await tx`SELECT set_config('search_path',${schema + ",public"},true)`;
          for (const table of [
            "teams",
            "members",
            "learnings",
            "learning_versions",
            "learning_pushes",
            "learning_supersessions",
            "conflict_decisions",
            "slack_digest_receipts",
          ])
            await tx`CREATE TABLE ${tx(table)} (LIKE ${tx("public." + table)} INCLUDING ALL)`;
          await tx`ALTER TABLE learnings DROP COLUMN IF EXISTS owner_member_id, DROP COLUMN IF EXISTS capture_flagged`;
          await tx`CREATE VIEW learning_audience_cells AS SELECT l.*, l.team_id AS storage_team_id, false AS is_share FROM learnings l`;
          const team = newId("team"),
            member = newId("mem");
          await tx`INSERT INTO teams (id, name, invite_code) VALUES (${team}, 'Digest fixture', ${newId("invite")})`;
          await tx`INSERT INTO members(id,team_id,name)VALUES(${member},${team},'Fixture contributor')`;
          const visible = newId("lrn");
          await tx`INSERT INTO learnings(id,team_id,member_id,title,body,kind,source,confidence)VALUES(${visible},${team},${member},'Visible learning','Body','learning','codex',0.9)`;
          const since = new Date(Date.now() - 86400000);
          const before = await gatherDigest(team, since, tx);
          expect(before.learnings.map((r) => r.id)).toContain(visible);
          await tx`DROP VIEW learning_audience_cells`;
          await tx`ALTER TABLE learnings ADD COLUMN capture_flagged boolean NOT NULL DEFAULT false`;
          await tx`CREATE VIEW learning_audience_cells AS SELECT l.*, l.team_id AS storage_team_id, false AS is_share FROM learnings l`;
          const cell = async (
            title: string,
            kind: string,
            flagged: boolean,
          ) => {
            const id = newId("lrn");
            await tx`INSERT INTO learnings(id,team_id,member_id,title,body,kind,source,confidence,capture_flagged,area,workaround)VALUES(${id},${team},${member},${title},'Body',${kind},'codex',0.9,${flagged},'tool','Fixture workaround')`;
            return id;
          };
          const learning = await cell("Flagged learning", "learning", true);
          const insight = await cell("Flagged insight", "insight", true);
          const friction = await cell("Flagged friction", "friction", true);
          const safeFriction = await cell(
            "Visible friction",
            "friction",
            false,
          );
          for (const [id, cost] of [
            [friction, 900],
            [safeFriction, 12],
          ] as const)
            await tx`INSERT INTO learning_pushes(id,learning_id,team_id,member_id,source,merged,area,cost,blocked)VALUES(${newId("psh")},${id},${team},${member},'codex',false,'tool',${cost},true)`;
          const decision = async (oldFlag: boolean, newFlag: boolean) => {
            const older = await cell("Earlier fixture", "learning", oldFlag),
              newer = await cell("Newer fixture", "learning", newFlag),
              edge = newId("edge");
            await tx`INSERT INTO learning_supersessions(id,team_id,older_id,newer_id,older_revision,newer_revision,relation,confidence,status,reason)VALUES(${edge},${team},${older},${newer},1,1,'update',0.99,'accepted','Fixture')`;
            await tx`INSERT INTO conflict_decisions(id,team_id,edge_id,decision,reason,confidence,model,latency_ms,pushed_by,before_state,after_state)VALUES(${newId("dec")},${team},${edge},'supersede','Fixture',0.99,'claude-sonnet-5-5',1,${member},'[]','[]')`;
            return { older, newer };
          };
          await decision(true, false);
          const flaggedNew = await decision(false, true);
          const allowed = await decision(false, false);
          await tx`UPDATE learnings SET lifecycle='superseded',superseded_by=${flaggedNew.newer} WHERE id=${flaggedNew.older}`;
          const after = await gatherDigest(team, since, tx);
          expect(after.learnings.some((r) => r.id === learning)).toBe(false);
          expect(after.insights.some((r) => r.id === insight)).toBe(false);
          expect(after.friction.map((r) => r.id)).toEqual([safeFriction]);
          expect(
            after.friction.reduce((sum, r) => sum + (r.minutes ?? 0), 0),
          ).toBe(12);
          expect(after.decisions.map((r) => r.id)).toEqual([allowed.newer]);
          expect(
            after.learnings.find((r) => r.id === flaggedNew.older)
              ?.replacementId,
          ).toBeNull();
          await tx`UPDATE learnings SET capture_flagged=true WHERE id=${visible}`;
          expect(
            (await gatherDigest(team, since, tx)).learnings.some(
              (r) => r.id === visible,
            ),
          ).toBe(false);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await sql.end();
    }
  },
);
