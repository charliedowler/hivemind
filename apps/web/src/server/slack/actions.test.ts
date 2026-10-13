import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import { createTeam } from "../auth";
import { saveSchedule } from "../digests/store";
import { createCaptureRule } from "../capture-rules";
import {
  runReversibleAction,
  undoLastAction,
  hasThreadAction,
} from "./actions";
import type { SlackToolContext } from "@/slack/tools";
import type { HiveContext } from "@hivemind/core";
describe.skipIf(!process.env.DATABASE_URL)("Atomic Slack admin actions", () => {
  let actor: HiveContext, other: HiveContext;
  let ctx: SlackToolContext;
  beforeAll(async () => {
    actor = (
      await createTeam({ teamName: "Undo fixture", memberName: "Admin" })
    ).ctx;
    other = (
      await createTeam({ teamName: "Other fixture", memberName: "Other" })
    ).ctx;
    ctx = {
      ...actor,
      isAdmin: true,
      channelId: "CUNDOTEST",
      threadTs: "1800000000.1",
      messageTs: "1800000000.2",
    };
  }, 30000);
  afterAll(async () => {
    const sql = getSql();
    const teams = [actor?.teamId, other?.teamId].filter(Boolean);
    for (const table of [
      "slack_tool_actions",
      "slack_digest_schedules",
      "capture_rules",
      "api_keys",
      "web_sessions",
      "members",
    ])
      await sql`DELETE FROM ${sql(table)} WHERE team_id=ANY(${teams}::text[])`;
    await sql`DELETE FROM teams WHERE id=ANY(${teams}::text[])`;
  }, 30000);
  async function schedule(messageTs: string, threadTs = messageTs) {
    const context = { ...ctx, messageTs, threadTs };
    let id = "";
    const result = await runReversibleAction(
      context,
      "hive_schedule_digest",
      async (tx) => {
        const s = await saveSchedule(
          actor,
          {
            channelId: "CUNDOTEST",
            cadence: "weekly",
            time: "09:00",
            timezone: "Europe/London",
          },
          { id: "CUNDOTEST", name: "fixture" },
          undefined,
          tx,
        );
        id = s.id;
        const rows =
          await tx`SELECT updated_at::text AS version FROM slack_digest_schedules WHERE team_id=${actor.teamId} AND id=${id}`;
        return {
          text: "Schedule saved.",
          undo: "pause this schedule",
          inverse: {
            kind: "digest",
            id,
            expectedUpdatedAt: String(rows[0].version),
            enabled: false,
          },
        };
      },
    );
    return { id, context, result };
  }
  it("commits a change and undo receipt together, and retries once", async () => {
    const s = await schedule("1800000010.1");
    expect(s.result.text).toBe("Schedule saved.");
    expect(s.result.text).not.toContain("Reply undo");
    const retry = await runReversibleAction(
      s.context,
      "hive_schedule_digest",
      async () => {
        throw new Error("must not mutate twice");
      },
    );
    expect(retry).toEqual(s.result);
    expect(
      await hasThreadAction(actor.teamId, "CUNDOTEST", s.context.threadTs),
    ).toBe(true);
    await undoLastAction(s.context);
    expect(
      (
        await getSql()`SELECT enabled FROM slack_digest_schedules WHERE id=${s.id}`
      )[0].enabled,
    ).toBe(false);
    expect((await undoLastAction(s.context)).text).toContain("already undone");
  });
  it("rolls back the mutation if no valid inverse can be written", async () => {
    const id = newId("dgs");
    await expect(
      runReversibleAction(
        { ...ctx, messageTs: "1800000020.1" },
        "fixture",
        async (tx) => {
          await tx`INSERT INTO capture_rules(id,team_id,created_by,name,scope,kind,action,config)VALUES(${id},${actor.teamId},${actor.memberId},'fixture','team','keyword','drop','{}')`;
          throw new Error("receipt failed");
        },
      ),
    ).rejects.toThrow("receipt failed");
    expect(
      (await getSql()`SELECT id FROM capture_rules WHERE id=${id}`).length,
    ).toBe(0);
  });
  it("isolates teams and threads", async () => {
    const s = await schedule("1800000030.1");
    expect((await undoLastAction({ ...s.context, ...other })).text).toContain(
      "no reversible",
    );
    expect(
      (await undoLastAction({ ...s.context, threadTs: "1800000030.2" })).text,
    ).toContain("no reversible");
  });
  it("refuses expired receipts and later edits", async () => {
    const s = await schedule("1800000040.1");
    await getSql()`UPDATE slack_tool_actions SET expires_at=now()-interval '1 second' WHERE team_id=${actor.teamId} AND message_ts=${s.context.messageTs!}`;
    expect((await undoLastAction(s.context)).text).toContain(
      "window has ended",
    );
    const changed = await schedule("1800000040.2");
    await getSql()`UPDATE slack_digest_schedules SET updated_at=updated_at+interval '1 second' WHERE id=${changed.id}`;
    await expect(undoLastAction(changed.context)).rejects.toThrow(
      "changed after",
    );
  });
  it("only undoes the latest action, without walking older receipts", async () => {
    const first = await schedule("1800000050.1", "1800000050.0");
    const second = await schedule("1800000050.2", "1800000050.0");
    await undoLastAction(second.context);
    await undoLastAction(first.context);
    expect(
      (
        await getSql()`SELECT enabled FROM slack_digest_schedules WHERE id=${first.id}`
      )[0].enabled,
    ).toBe(true);
  });
  it("removes a newly created capture rule and keeps existing captures", async () => {
    const context = {
      ...ctx,
      messageTs: "1800000060.1",
      threadTs: "1800000060.0",
    };
    let id = "";
    await runReversibleAction(context, "hive_set_capture_rule", async (tx) => {
      const rule = await createCaptureRule(
        actor,
        {
          name: "Synthetic fixture",
          scope: "team",
          kind: "keyword",
          pattern: "synthetic-test",
          regex: false,
          caseSensitive: false,
          action: "drop",
          enabled: true,
          source: "slack",
        },
        tx,
      );
      id = rule.id;
      return {
        text: "Rule saved.",
        undo: "remove this rule",
        inverse: { kind: "capture_created", id, revision: 1 },
      };
    });
    await undoLastAction(context);
    expect(
      (await getSql()`SELECT id FROM capture_rules WHERE id=${id}`).length,
    ).toBe(0);
  });
  it("refuses another admin in the same team", async () => {
    const s = await schedule("1800000065.1");
    const memberId = newId("mem");
    await getSql()`INSERT INTO members(id,team_id,name,role) VALUES(${memberId},${actor.teamId},'Second admin','admin')`;
    await expect(undoLastAction({ ...s.context, memberId })).rejects.toThrow(
      "Only the admin who made",
    );
  });
  it("refuses to remove a capture rule edited after creation", async () => {
    const context = {
      ...ctx,
      messageTs: "1800000066.1",
      threadTs: "1800000066.0",
    };
    let id = "";
    await runReversibleAction(context, "hive_set_capture_rule", async (tx) => {
      const rule = await createCaptureRule(
        actor,
        {
          name: "Edited fixture",
          scope: "team",
          kind: "keyword",
          pattern: "synthetic-test",
          regex: false,
          caseSensitive: false,
          action: "drop",
          enabled: true,
          source: "slack",
        },
        tx,
      );
      id = rule.id;
      return {
        text: "Rule saved.",
        undo: "remove this rule",
        inverse: { kind: "capture_created", id, revision: 1 },
      };
    });
    await getSql()`UPDATE capture_rules SET revision=revision+1 WHERE id=${id} AND team_id=${actor.teamId}`;
    await expect(undoLastAction(context)).rejects.toThrow("changed after");
  });
  it("rechecks admin permission even with a forged isAdmin flag", async () => {
    await getSql()`UPDATE members SET role='member' WHERE id=${actor.memberId}`;
    await expect(
      runReversibleAction(
        { ...ctx, messageTs: "1800000070.1" },
        "fixture",
        async () => {
          throw new Error("unreachable");
        },
      ),
    ).rejects.toThrow("admin");
    await expect(undoLastAction(ctx)).rejects.toThrow("admin");
    await getSql()`UPDATE members SET role='admin' WHERE id=${actor.memberId}`;
  });
});
