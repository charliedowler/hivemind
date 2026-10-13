import { writeFile } from "node:fs/promises";
import { getSql } from "../src/server/db/client";
import { hashToken, newId } from "../src/server/db/ids";
import { saveSchedule } from "../src/server/digests/store";
import { digestPreview } from "../src/server/digests/data";
const url = new URL(process.env.DATABASE_URL ?? "");
if (url.hostname !== "127.0.0.1" || !url.pathname.includes("hive_digest"))
  throw new Error("Use the dedicated local digest database.");
async function main() {
  const ctx = {
    teamId: newId("team"),
    memberId: newId("mem"),
    teamName: "Digest preview",
    memberName: "Fixture admin",
  };
  const sql = getSql();
  await sql`INSERT INTO teams(id,name,invite_code,invite_expires_at) VALUES(${ctx.teamId},${ctx.teamName},${newId("invite")},now()+interval '1 day')`;
  await sql`INSERT INTO members(id,team_id,name,role) VALUES(${ctx.memberId},${ctx.teamId},${ctx.memberName},'admin')`;
  await sql`INSERT INTO web_sessions(id,team_id,member_id,token_hash,expires_at) VALUES(${newId("ses")},${ctx.teamId},${ctx.memberId},${hashToken("digest-local-fixture-session")},now()+interval '1 day')`;
  const cells = [
    [
      "learning",
      "The migration runner records each applied SQL file",
      "Apply reviewed migrations before the code deploys.",
      null,
      null,
    ],
    [
      "insight",
      "Repeated reports reveal where setup takes time",
      "Count each observation, including reports merged into an existing cell.",
      null,
      null,
    ],
    [
      "friction",
      "A stale client can block local checks",
      "Regenerate it after schema changes.",
      "environment",
      12,
    ],
  ] as const;
  await Promise.all(
    cells.map(async ([kind, title, body, area, cost]) => {
      const id = newId("lrn");
      await sql`INSERT INTO learnings(id,team_id,member_id,title,body,kind,source,confidence,area,cost,blocked,workaround) VALUES(${id},${ctx.teamId},${ctx.memberId},${title},${body},${kind},'codex',0.9,${area},${cost},${kind === "friction"},${kind === "friction" ? "Regenerate the local client." : null})`;
      await sql`INSERT INTO learning_pushes(id,team_id,learning_id,member_id,source,merged,area,cost,blocked) VALUES(${newId("psh")},${ctx.teamId},${id},${ctx.memberId},'codex',false,${area},${cost},${kind === "friction"})`;
    }),
  );
  const schedule = await saveSchedule(
    ctx,
    {
      channelId: "CFIXTURE1",
      cadence: "weekly",
      time: "09:00",
      timezone: "Europe/London",
    },
    { id: "CFIXTURE1", name: "team-learnings" },
  );
  await saveSchedule(
    ctx,
    {
      channelId: "CFIXTURE2",
      cadence: "weekdays",
      time: "16:30",
      timezone: "America/Los_Angeles",
      enabled: false,
    },
    { id: "CFIXTURE2", name: "engineering" },
  );
  const preview = await digestPreview(
    ctx.teamId,
    new Date(schedule.lastCursor),
    schedule,
    schedule.timezone,
  );
  await writeFile(
    "/tmp/hive-digest/fixture-preview.json",
    JSON.stringify(preview),
  );
  await writeFile("/tmp/hive-digest/fixture-team.json", JSON.stringify(ctx));
  await sql.end();
}
main().catch(() => {
  console.error("Local digest fixture failed.");
  process.exitCode = 1;
});
