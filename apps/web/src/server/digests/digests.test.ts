import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
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
import { proposeScheduleFromText, confirmDigestProposal } from "./proposal";
import { digestTools } from "@/slack/tools/digests";
import type { HiveContext } from "@hivemind/core";
const model = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: model };
  },
}));
vi.mock("./connection", () => ({
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
        await getSql()`INSERT INTO members(id,team_id,name,role)VALUES(${ctx.memberId},${ctx.teamId},${ctx.memberName},'admin')`;
      }
      await getSql()`INSERT INTO members(id,team_id,name,role)VALUES(${member.memberId},${a.teamId},'Member','member')`;
    });
    afterAll(async () => {
      const ids = [a.teamId, b.teamId];
      await getSql()`DELETE FROM slack_digest_proposals WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM slack_digest_receipts WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM slack_digest_posts WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM slack_digest_schedules WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM learning_pushes WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM learnings WHERE team_id=ANY(${ids}::text[])`;
      await getSql()`DELETE FROM members WHERE team_id=ANY(${ids}::text[])`;
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
    it("turns text into a proposal with one model call and confirms once", async () => {
      model.mockResolvedValue({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "propose_digest", input }],
      });
      const proposal = await proposeScheduleFromText(
        a.teamId,
        a.memberId,
        "post an update every Monday at 9 in here",
        { channelId: input.channelId, timezone: input.timezone },
      );
      expect(proposal.schedule).toMatchObject(input);
      expect(proposal.restatement).toContain(
        "every Monday at 09:00 (Europe/London)",
      );
      expect(model).toHaveBeenCalledTimes(1);
      expect(model.mock.calls[0]![0]).toMatchObject({
        model: "claude-sonnet-5-5",
        tool_choice: { type: "auto" },
      });
      await expect(
        confirmDigestProposal(
          b.teamId,
          b.memberId,
          input.channelId,
          proposal.id,
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        confirmDigestProposal(a.teamId, a.memberId, "COTHER1", proposal.id),
      ).rejects.toMatchObject({ status: 403 });
      const [first, second] = await Promise.all([
        confirmDigestProposal(
          a.teamId,
          a.memberId,
          input.channelId,
          proposal.id,
        ),
        confirmDigestProposal(
          a.teamId,
          a.memberId,
          input.channelId,
          proposal.id,
        ),
      ]);
      expect(first.id).toBe(second.id);
      await expect(
        proposeScheduleFromText(member.teamId, member.memberId, "every day", {
          channelId: input.channelId,
          timezone: input.timezone,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(model).toHaveBeenCalledTimes(1);
      expect(model.mock.calls[0]![0].tools[0]).toMatchObject({ strict: true });
      expect(
        model.mock.calls[0]![0].tools[0].input_schema.properties.weekday,
      ).not.toHaveProperty("minimum");
      const result = await digestTools
        .find((t) => t.name === "hive_schedule_digest")!
        .handler(
          {
            teamId: member.teamId,
            memberId: member.memberId,
            isAdmin: true,
            channelId: input.channelId,
            threadTs: "1800000000.1",
          },
          { text: "every day at 9" },
        );
      expect(result.text).toBe("Only a team admin can do this.");
      expect(model).toHaveBeenCalledTimes(1);
    });
  },
);
