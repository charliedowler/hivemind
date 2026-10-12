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
describe.skipIf(!enabled)("digest database boundaries", { timeout: 20_000 }, () => {
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
    const before = new Date();
    await new Promise((r) => setTimeout(r, 5));
    await getSql()`UPDATE learnings SET lifecycle='confirmed' WHERE id=${cell}`;
    const confirmed = await getSql().begin((tx) =>
      gatherDigest(a.teamId, before, tx),
    );
    expect(confirmed.learnings[0]).toMatchObject({
      id: cell,
      state: "confirmed",
    });
    const s = await schedule();
    const sent = await postDigest(a.teamId, s.id, transport, true);
    expect(sent.status).toBe("posted");
    expect((await getSchedule(a.teamId, s.id)).lastCursor > s.lastCursor).toBe(
      true,
    );
    expect((await postDigest(a.teamId, s.id, transport, true)).status).toBe(
      "skipped_empty",
    );
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
      tool_choice: { name: "propose_digest" },
    });
    await expect(
      confirmDigestProposal(b.teamId, b.memberId, input.channelId, proposal.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      confirmDigestProposal(a.teamId, a.memberId, "COTHER1", proposal.id),
    ).rejects.toMatchObject({ status: 403 });
    const [first, second] = await Promise.all([
      confirmDigestProposal(a.teamId, a.memberId, input.channelId, proposal.id),
      confirmDigestProposal(a.teamId, a.memberId, input.channelId, proposal.id),
    ]);
    expect(first.id).toBe(second.id);
    await expect(
      proposeScheduleFromText(member.teamId, member.memberId, "every day", {
        channelId: input.channelId,
        timezone: input.timezone,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(model).toHaveBeenCalledTimes(1);
  });
});
