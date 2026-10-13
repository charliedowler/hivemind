import { respondToSlack } from "@/slack/respond";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { getSql } from "../db/client";
import { newId } from "../db/ids";
import {
  saveSchedule,
  listSchedules,
  getSchedule,
  disableSchedule,
} from "./store";
import { gatherDigest } from "./data";
import {
  claimDigest,
  postDigest,
  postNow,
  DigestDeliveryError,
  type DigestTransport,
} from "./runner";
import { parseScheduleInstruction } from "./parse-instruction";
import { digestInstruction, undoDigestFromWeb } from "./instructions";
import type { HiveContext } from "@hivemind/core";
const model = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: model };
  },
}));
vi.mock("./connection", () => ({
  slackMemberTimezone: async () => "Europe/London",
  digestChannel: async (_ctx: HiveContext, id: string) => ({
    id,
    name: "digest-fixture",
  }),
}));
const input = {
  channelId: "C123456",
  cadence: "weekly",
  weekday: 1,
  time: "09:00",
  timezone: "Europe/London",
};
const transport: DigestTransport = {
  authors: async () => new Map(),
  send: vi.fn(async () => ({
    ts: "1800000000.000001",
    permalink: "https://example.slack.com/archives/C123456/p1800000000000001",
  })),
};
const enabled = Boolean(process.env.HIVE_DIGEST_TEST_DATABASE_URL);
describe.skipIf(!enabled)(
  "digest database boundaries",
  { timeout: 20_000 },
  () => {
    const a: HiveContext = {
      teamId: newId("team"),
      memberId: newId("mem"),
      teamName: "A",
      memberName: "Admin",
    };
    const b: HiveContext = {
      teamId: newId("team"),
      memberId: newId("mem"),
      teamName: "B",
      memberName: "Other",
    };
    const member = { ...a, memberId: newId("mem"), memberName: "Member" };
    beforeAll(async () => {
      const url = new URL(process.env.HIVE_DIGEST_TEST_DATABASE_URL!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !url.pathname.includes("hive_digest")
      )
        throw new Error("Use the dedicated local digest database.");
      vi.stubEnv("DATABASE_URL", process.env.HIVE_DIGEST_TEST_DATABASE_URL!);
      vi.stubEnv("ANTHROPIC_API_KEY", "fixture");
      for (const ctx of [a, b]) {
        await getSql()`INSERT INTO teams(id,name,invite_code,invite_expires_at)VALUES(${ctx.teamId},${ctx.teamName},${newId("invite")},now()+interval '1 day')`;
        await getSql()`INSERT INTO members(id,name)VALUES(${ctx.memberId},${ctx.memberName})`;
        await getSql()`INSERT INTO hive_memberships(member_id,team_id,role)VALUES(${ctx.memberId},${ctx.teamId},'admin')`;
      }
      await getSql()`INSERT INTO members(id,name)VALUES(${member.memberId},'Member')`;
      await getSql()`INSERT INTO hive_memberships(member_id,team_id)VALUES(${member.memberId},${a.teamId})`;
    });
    afterEach(() => vi.useRealTimers());
    afterAll(async () => {
      const ids = [a.teamId, b.teamId];
      await getSql()`DELETE FROM slack_tool_actions WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM slack_digest_instructions WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM slack_decisions WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM slack_digest_proposals WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM slack_digest_receipts WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM slack_digest_posts WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM slack_digest_schedules WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM learning_pushes WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM learnings WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM members WHERE id IN (SELECT member_id FROM hive_memberships WHERE team_id=ANY(${ids}::text[]))`;
      await getSql()`DELETE FROM teams WHERE id=ANY(${ids}::text[])`;
      vi.unstubAllEnvs();
    });
    async function schedule() {
      return saveSchedule(a, input, { id: input.channelId, name: "fixture" });
    }
    it("isolates schedules and blocks every member mutation", async () => {
      const saved = await schedule();
      expect(await listSchedules(b.teamId)).toEqual([]);
      await expect(getSchedule(b.teamId, saved.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        saveSchedule(member, input, { id: input.channelId, name: "fixture" }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(disableSchedule(member, saved.id)).rejects.toMatchObject({
        status: 403,
      });
      await expect(postNow(member, saved.id, transport)).rejects.toMatchObject({
        status: 403,
      });
      await expect(disableSchedule(b, saved.id)).rejects.toMatchObject({
        status: 404,
      });
    });
    it("allows only one concurrent claim and no replay of a slot", async () => {
      const s = await schedule();
      await getSql()`UPDATE slack_digest_schedules SET next_due_at=now()-interval '1 minute' WHERE id=${s.id}`;
      const claims = await Promise.all([
        claimDigest(a.teamId, s.id),
        claimDigest(a.teamId, s.id),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      await expect(
        saveSchedule(a, input, { id: input.channelId, name: "fixture" }, s.id),
      ).rejects.toMatchObject({ status: 409 });
      await expect(disableSchedule(a, s.id)).rejects.toMatchObject({
        status: 409,
      });
      expect(await claimDigest(a.teamId, s.id, true)).toBeNull();
    });
    it("skips an empty update without changing its content watermark", async () => {
      const s = await schedule();
      const result = await postDigest(a.teamId, s.id, transport, true);
      expect(result.status).toBe("skipped_empty");
      expect((await getSchedule(a.teamId, s.id)).lastCursor).toBe(s.lastCursor);
    });
    it("includes new cells and confirmations while excluding another team's data", async () => {
      const cell = newId("lrn"),
        foreign = newId("lrn");
      for (const [ctx, id] of [
        [a, cell],
        [b, foreign],
      ] as const)
        await getSql()`INSERT INTO learnings(id,team_id,member_id,title,body,kind,source,confidence)VALUES(${id},${ctx.teamId},${ctx.memberId},'A verified fact','Body','learning','codex',0.9)`;
      const initial = await getSql().begin((tx) =>
        gatherDigest(a.teamId, new Date(Date.now() - 86400000), tx),
      );
      expect(initial.learnings.map((r) => r.id)).toEqual([cell]);
      await getSql()`UPDATE learnings SET created_at=now()-interval '2 days' WHERE id=${cell}`;
      await getSql()`UPDATE learning_versions SET created_at=now()-interval '2 days' WHERE learning_id=${cell} AND revision=1`;
      const before = (
        await getSql()`SELECT now()-interval '1 minute' AS boundary`
      )[0]!.boundary as Date;
      await getSql()`UPDATE learnings SET lifecycle='confirmed' WHERE id=${cell}`;
      const confirmed = await getSql().begin((tx) =>
        gatherDigest(a.teamId, before, tx),
      );
      expect(confirmed.learnings.find((r) => r.id === cell)).toMatchObject({
        id: cell,
        state: "confirmed",
      });
      const s = await schedule();
      const sent = await postDigest(a.teamId, s.id, transport, true);
      expect(sent.status).toBe("posted");
      expect(
        (await getSchedule(a.teamId, s.id)).lastCursor > s.lastCursor,
      ).toBe(true);
      expect((await postDigest(a.teamId, s.id, transport, true)).status).toBe(
        "skipped_empty",
      );
    });
    it("delivers a late commit that predates the last successful watermark", async () => {
      const saved = await schedule();
      expect(
        (await postDigest(a.teamId, saved.id, transport, true)).status,
      ).toBe("posted");
      const posted = await getSchedule(a.teamId, saved.id);
      const late = newId("lrn");
      const earlier = new Date(new Date(posted.lastCursor).getTime() - 60_000);
      await getSql()`INSERT INTO learnings(id,team_id,member_id,title,body,kind,source,confidence,created_at) VALUES(${late},${a.teamId},${a.memberId},'A transaction that committed late','Body','learning','codex',0.9,${earlier})`;
      expect(
        (await postDigest(a.teamId, saved.id, transport, true)).status,
      ).toBe("posted");
      const receipts =
        await getSql()`SELECT source_key FROM slack_digest_receipts WHERE team_id=${a.teamId} AND schedule_id=${saved.id} AND source_key=${late + ":1"}`;
      expect(receipts).toHaveLength(1);
      expect(
        (await postDigest(a.teamId, saved.id, transport, true)).status,
      ).toBe("skipped_empty");
    });
    it("keeps private Slack-sourced cells out of public digests", async () => {
      const privateCell = newId("lrn");
      await getSql()`INSERT INTO learnings(id,team_id,member_id,title,body,kind,source,confidence)VALUES(${privateCell},${a.teamId},${a.memberId},'Private source fixture','Body','insight','slack',0.9)`;
      const since = new Date(Date.now() - 86400000);
      const publicData = await getSql().begin((tx) =>
        gatherDigest(a.teamId, since, tx, new Map(), undefined, since, true),
      );
      const privateData = await getSql().begin((tx) =>
        gatherDigest(a.teamId, since, tx),
      );
      expect(publicData.insights.some((r) => r.id === privateCell)).toBe(false);
      expect(privateData.insights.some((r) => r.id === privateCell)).toBe(true);
    });
    it("keeps the watermark on failure and records uncertain sends", async () => {
      const s = await schedule();
      const failure = {
        ...transport,
        send: async () => {
          throw new DigestDeliveryError(false, "Rejected");
        },
      };
      expect((await postDigest(a.teamId, s.id, failure, true)).status).toBe(
        "failed",
      );
      expect((await getSchedule(a.teamId, s.id)).lastCursor).toBe(s.lastCursor);
      const unknown = {
        ...transport,
        send: async () => {
          throw new Error("Response lost");
        },
      };
      expect((await postDigest(a.teamId, s.id, unknown, true)).status).toBe(
        "uncertain",
      );
      expect((await getSchedule(a.teamId, s.id)).lastCursor).toBe(s.lastCursor);
    });
    it("reads one schema model result, acts once and undoes only in the owning thread", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-13T01:00:00Z"));
      vi.stubEnv("TYPESAFE_API_KEY", "");
      model.mockClear();
      const set = {
        action: "set",
        schedule: input,
        targetScheduleId: null,
        clearInstruction: true,
        enoughDetail: true,
        timeSpecified: true,
        missing: null,
      };
      const respond = (value: unknown) =>
        model.mockResolvedValue({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", name: "propose_digest", input: value }],
        });
      respond(set);
      const proposal = await parseScheduleInstruction(
        a.teamId,
        a.memberId,
        "post every Monday at 9",
        { channelId: input.channelId, timezone: input.timezone },
      );
      expect(proposal.restatement).toBe("Every Monday at 9am");
      expect(model).toHaveBeenCalledTimes(1);
      expect(model.mock.calls[0]![0]).toMatchObject({
        tool_choice: { type: "auto" },
        tools: [{ strict: true }],
      });
      const ctx = {
        teamId: a.teamId,
        memberId: a.memberId,
        isAdmin: true,
        channelId: input.channelId,
        threadTs: "1800000000.1",
        messageTs: "1800000000.2",
        requestText: "post every Monday at 9",
      };
      const [first, second] = await Promise.all([
        digestInstruction(ctx, ctx.requestText, input.timezone),
        digestInstruction(ctx, ctx.requestText, input.timezone),
      ]);
      expect(first.text).toBe(second.text);
      expect(first).toEqual({
        text: "Set. Every Monday at 9am in #digest-fixture (London time). First update Monday 19 October.",
      });
      expect(first).not.toHaveProperty("blocks");
      const audit = (
        await getSql()`SELECT * FROM slack_digest_instructions WHERE team_id=${a.teamId} AND message_ts=${ctx.messageTs}`
      )[0];
      expect(audit).toBeTruthy();
      const saved = await getSchedule(a.teamId, String(audit.schedule_id));
      expect(saved.enabled).toBe(true);
      respond({ ...set, clearInstruction: false, missing: "intent" });
      expect(
        (
          await digestInstruction(
            { ...ctx, messageTs: "1800000000.3", requestText: "maybe Mondays" },
            "maybe",
            input.timezone,
          )
        ).text,
      ).toBeUndefined();
      respond({
        ...set,
        schedule: null,
        timeSpecified: false,
        enoughDetail: false,
        missing: "time",
      });
      expect(
        (
          await digestInstruction(
            { ...ctx, messageTs: "1800000000.4" },
            "Monday",
            input.timezone,
          )
        ).text,
      ).toBe("What time should the update run?");
      respond(set);
      expect(
        (
          await digestInstruction(
            { ...ctx, memberId: member.memberId, messageTs: "1800000000.5" },
            "set",
            input.timezone,
          )
        ).text,
      ).toContain("Only hive admins");
      respond({
        action: "undo",
        schedule: null,
        targetScheduleId: null,
        clearInstruction: true,
        enoughDetail: true,
        timeSpecified: false,
        missing: null,
      });
      await expect(
        digestInstruction(
          {
            ...ctx,
            teamId: b.teamId,
            memberId: b.memberId,
            messageTs: "1800000000.6",
          },
          "undo",
          input.timezone,
        ),
      ).rejects.toMatchObject({ status: 410 });
      await expect(
        digestInstruction(
          { ...ctx, threadTs: "1800000001.1", messageTs: "1800000000.7" },
          "undo",
          input.timezone,
        ),
      ).rejects.toMatchObject({ status: 410 });
      const pointer = (
        await getSql()`SELECT inverse FROM slack_tool_actions WHERE team_id=${a.teamId} AND message_ts=${ctx.messageTs}`
      )[0];
      expect(pointer.inverse).toMatchObject({
        kind: "digest_instruction",
        payload: { instructionId: audit.id },
      });
      model.mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "undo_last_action", input: {} }],
      });
      expect(
        await respondToSlack(ctx, "undo", "1800000000.8", [
          { question: ctx.requestText, answer: first.text ?? "" },
        ]),
      ).toEqual({ text: "", react: "white_check_mark" });
      expect((await getSchedule(a.teamId, saved.id)).enabled).toBe(false);
      const saved2 = await schedule();
      expect(
        (await listSchedules(a.teamId)).some((s) => s.id === saved.id),
      ).toBe(false);
      respond({
        action: "disable",
        schedule: null,
        targetScheduleId: saved2.id,
        clearInstruction: true,
        enoughDetail: true,
        timeSpecified: false,
        missing: null,
      });
      await digestInstruction(
        {
          ...ctx,
          messageTs: "1800000000.9",
          requestText: "stop the Monday update",
        },
        "stop",
        input.timezone,
      );
      await getSql()`UPDATE slack_digest_instructions SET created_at=now()-interval '2 hours' WHERE team_id=${a.teamId} AND message_ts='1800000000.9'`;
      respond({
        action: "undo",
        schedule: null,
        targetScheduleId: null,
        clearInstruction: true,
        enoughDetail: true,
        timeSpecified: false,
        missing: null,
      });
      await expect(
        digestInstruction(
          { ...ctx, messageTs: "1800000000.10", requestText: "cancel that" },
          "undo",
          input.timezone,
        ),
      ).rejects.toMatchObject({ status: 410 });
    });
    it("refuses stale undo and another admin's web undo", async () => {
      vi.stubEnv("TYPESAFE_API_KEY", "");
      model.mockResolvedValue({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: "propose_digest",
            input: {
              action: "set",
              schedule: input,
              targetScheduleId: null,
              clearInstruction: true,
              enoughDetail: true,
              timeSpecified: true,
              missing: null,
            },
          },
        ],
      });
      const ctx = {
        teamId: a.teamId,
        memberId: a.memberId,
        isAdmin: true,
        channelId: input.channelId,
        threadTs: "1800000090.1",
        messageTs: "1800000090.2",
        requestText: "post every Monday at 9",
      };
      await digestInstruction(ctx, ctx.requestText, input.timezone);
      const audit = (
        await getSql()`SELECT * FROM slack_digest_instructions WHERE team_id=${a.teamId} AND message_ts=${ctx.messageTs}`
      )[0];
      expect(
        (await listSchedules(a.teamId, a.memberId)).find(
          (s) => s.id === audit.schedule_id,
        )?.undoId,
      ).toBe(audit.id);
      await expect(
        undoDigestFromWeb(b, String(audit.id)),
      ).rejects.toMatchObject({ status: 404 });
      await saveSchedule(
        a,
        { ...input, time: "10:00" },
        { id: input.channelId, name: "fixture" },
        String(audit.schedule_id),
      );
      await expect(
        undoDigestFromWeb(a, String(audit.id)),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await listSchedules(a.teamId, a.memberId)).find(
          (s) => s.id === audit.schedule_id,
        )?.undoId,
      ).toBeUndefined();
    });
    it("acts on a complete suggestion and retains a reaction-only receipt", async () => {
      vi.stubEnv("TYPESAFE_API_KEY", "");
      const scheduleInput = {
        ...input,
        weekday: (new Date().getUTCDay() + 1) % 7,
      };
      model.mockResolvedValue({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: "propose_digest",
            input: {
              action: "set",
              schedule: scheduleInput,
              targetScheduleId: null,
              clearInstruction: false,
              actionableSuggestion: true,
              defaultedDetails: false,
              enoughDetail: true,
              timeSpecified: true,
              missing: null,
            },
          },
        ],
      });
      const ctx = {
        teamId: a.teamId,
        memberId: a.memberId,
        isAdmin: true,
        channelId: input.channelId,
        threadTs: "1800000095.1",
        messageTs: "1800000095.2",
        requestText:
          "Maybe we should schedule a digest here tomorrow at 9am London time.",
      };
      const first = await digestInstruction(
        ctx,
        ctx.requestText,
        input.timezone,
      );
      expect(first).toEqual({ text: "", react: "+1" });
      expect(
        await digestInstruction(ctx, ctx.requestText, input.timezone),
      ).toEqual(first);
      const rows =
        await getSql()`SELECT schedule_id FROM slack_digest_instructions WHERE team_id=${a.teamId} AND message_ts=${ctx.messageTs}`;
      expect(
        (await getSchedule(a.teamId, String(rows[0].schedule_id))).enabled,
      ).toBe(true);
    });
  },
);
