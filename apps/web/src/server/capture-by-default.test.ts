import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hivePushInput, type HiveContext } from "@hivemind/core";
import { getSql } from "./db/client";
import { createTeam } from "./auth";
import { captureOwner, ownerCapturePolicy, shareProjects } from "./project-sharing";
import { pushLearning } from "./hive";
import { shareAfterJoin, shareOnJoinOffer, shareOnJoinSettings } from "./share-on-join";

const models = vi.hoisted(() => ({ classify: vi.fn(), embed: vi.fn(), categories: vi.fn(), memory: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./classify", async (original) => ({ ...(await original<typeof import("./classify")>()), classifyPush: models.classify }));
vi.mock("./capture-categories", () => ({ classifyCaptureCategories: models.categories }));
vi.mock("./llm/embeddings", () => ({ embedText: models.embed }));
vi.mock("./llm/tagger", () => ({ suggestTags: async () => [] }));
vi.mock("./memory-judgments", () => ({ judgeMemory: models.memory, rerankMemory: async (_query: string, hits: unknown[]) => hits }));

describe.skipIf(!process.env.DATABASE_URL)("capture by default", { timeout: 60000 }, () => {
  const suffix = randomBytes(6).toString("hex");
  const sql = getSql();
  const members: string[] = [];
  const teams: string[] = [];
  let owner: HiveContext, orgA: HiveContext, orgB: HiveContext;
  const capture = (repo: string, body: string, extra = {}) => hivePushInput.parse({ title: `Default capture ${body.slice(0, 20)}`, body, source: "codex", repo, ...extra });
  beforeAll(async () => {
    orgA = (await createTeam({ teamName: `Default A ${suffix}`, memberName: "Admin A" })).ctx;
    orgB = (await createTeam({ teamName: `Default B ${suffix}`, memberName: "Admin B" })).ctx;
    const ownerOrg = (await createTeam({ teamName: `Default owner ${suffix}`, memberName: "Owner" })).ctx;
    for (const ctx of [orgA, orgB, ownerOrg]) { members.push(ctx.memberId); teams.push(ctx.teamId); }
    await sql`UPDATE members SET email = ${`owner-${suffix}@${suffix}.work.example.test`}, email_verified = true WHERE id = ${ownerOrg.memberId}`;
    owner = (await captureOwner(ownerOrg)).personal;
    teams.push(owner.teamId);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    models.classify.mockImplementation(async (input: { kind?: string }) => ({ classification: null, decision: { action: "accept", kind: input.kind ?? "learning", tags: [] } }));
    models.categories.mockImplementation(async (_input: unknown, categories: string[]) => Object.fromEntries(categories.map((c) => [c, false])));
    models.embed.mockResolvedValue(null);
    models.memory.mockResolvedValue({ tags: [], relations: [] });
  });
  afterAll(async () => {
    await sql`DELETE FROM learning_shares WHERE owner_member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM project_sharing_grants WHERE owner_member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM join_share_offers WHERE owner_member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM learning_pushes WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM learnings WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM capture_rules WHERE created_by = ANY(${members}::text[])`;
    await sql`DELETE FROM api_keys WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM teams WHERE id = ANY(${teams}::text[])`;
    await sql`DELETE FROM owner_capture_policy_history WHERE owner_member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM members WHERE id = ANY(${members}::text[])`;
    await sql.end();
  });

  it("captures into the personal hive without a selection and keeps excluded, remote-less and home-directory sessions out", async () => {
    expect(await ownerCapturePolicy(owner)).toEqual({ mode: "everything", include: [], exclude: [], workAreas: "", revision: 0 });
    const saved = await pushLearning(owner, capture("github.com/anywhere/widget", "Retry the queue worker after the lock is released.", { cwd: "/work/widget", home: "/Users/fixture" }));
    if (saved.dropped) throw new Error("Capture unexpectedly dropped");
    expect((await sql`SELECT team_id, repo FROM learnings WHERE id = ${saved.id}`)[0]).toEqual({ team_id: owner.teamId, repo: "github.com/anywhere/widget" });
    const policy = await shareProjects(owner, { exclude: ["github.com/anywhere/private-*"], revision: 0 });
    expect(policy).toMatchObject({ mode: "everything", exclude: ["github.com/anywhere/private-*"], revision: 1 });
    models.classify.mockClear();
    models.categories.mockClear();
    await expect(pushLearning(owner, capture("github.com/anywhere/private-notes", "Private repo finding about the lock."))).rejects.toThrow(/excluded from capture/);
    await expect(pushLearning(owner, hivePushInput.parse({ observation: "A finding with no repository at all." }))).rejects.toThrow(/Git repository with a remote/);
    await expect(pushLearning(owner, capture("github.com/anywhere/widget", "Home directory finding.", { cwd: "/Users/fixture", home: "/Users/fixture" }))).rejects.toThrow(/home directory/);
    expect(models.classify).not.toHaveBeenCalled();
    expect(models.categories).not.toHaveBeenCalled();
    expect((await sql`SELECT capture_mode, exclude_patterns, authority FROM owner_capture_policy_history WHERE owner_member_id = ${owner.memberId} AND revision = 1`)[0]).toEqual({ capture_mode: "everything", exclude_patterns: ["github.com/anywhere/private-*"], authority: "human" });
  });

  it("stores work areas at the next revision and uses them to tag and weight captures without limiting capture", async () => {
    await expect(shareProjects(owner, { workAreas: "frontend React", revision: 0 })).rejects.toMatchObject({ status: 409 });
    const policy = await shareProjects(owner, { workAreas: "frontend React, dbt models ghp_abcdefghijklmnopqrstuvwxyz0123456789", revision: 1, humanInstruction: "I work on frontend React and dbt models." });
    expect(policy.revision).toBe(2);
    expect(policy.workAreas).toContain("frontend React, dbt models");
    expect(policy.workAreas).not.toContain("ghp_");
    expect((await sql`SELECT work_areas, human_instruction, capture_mode FROM owner_capture_policy_history WHERE owner_member_id = ${owner.memberId} AND revision = 2`)[0]).toEqual({ work_areas: policy.workAreas, human_instruction: "I work on frontend React and dbt models.", capture_mode: "everything" });
    await shareProjects(owner, { workAreas: "frontend React, dbt models", revision: 2, humanInstruction: "I work on frontend React and dbt models." });
    const tagged = await pushLearning(owner, capture("github.com/anywhere/web", "React hydration warnings came from formatting dates on the client."));
    if (tagged.dropped) throw new Error("Capture unexpectedly dropped");
    expect(models.classify).toHaveBeenCalledWith(expect.objectContaining({ workAreas: "frontend React, dbt models" }));
    expect((await sql`SELECT tags FROM learnings WHERE id = ${tagged.id}`)[0].tags).toContain("frontend-react");
    const outside = await pushLearning(owner, capture("github.com/anywhere/ops", "Terraform plans need the state bucket region set explicitly."));
    if (outside.dropped) throw new Error("Capture outside work areas must still be saved");
    expect((await sql`SELECT tags FROM learnings WHERE id = ${outside.id}`)[0].tags).not.toContain("frontend-react");
  });

  it("offers every captured repo with a work-area question and records the join step's answer", async () => {
    await sql`INSERT INTO hive_memberships (member_id, team_id) VALUES (${owner.memberId}, ${orgA.teamId}), (${owner.memberId}, ${orgB.teamId})`;
    await sql`INSERT INTO join_share_offers (owner_member_id, team_id) VALUES (${owner.memberId}, ${orgA.teamId}), (${owner.memberId}, ${orgB.teamId})`;
    const offer = await shareOnJoinOffer(owner, orgA.teamId);
    expect(offer).toMatchObject({ mode: "everything", question: `Share your learnings about frontend React and dbt models with ${orgA.teamName}?` });
    expect(offer?.explanation).toContain("now and in future");
    expect(offer?.projects.map((project) => project.pattern).sort()).toEqual(["github.com/anywhere/ops", "github.com/anywhere/web", "github.com/anywhere/widget"]);
    expect(await shareAfterJoin(owner, orgA.teamId, orgA.teamName, { share: true })).toEqual({ decision: "yes", published: 3 });
    expect((await shareOnJoinSettings(owner, orgA.teamId))?.decision).toBe("yes");
    expect((await sql`SELECT human_instruction FROM join_share_offers WHERE owner_member_id = ${owner.memberId} AND team_id = ${orgA.teamId}`)[0].human_instruction).toContain("now and in future");
    const later = await pushLearning(owner, capture("github.com/anywhere/new", "The new service needs the shared lint config before CI passes."));
    if (later.dropped) throw new Error("Capture unexpectedly dropped");
    expect(await sql`SELECT learning_id FROM learning_shares WHERE learning_id = ${later.id} AND team_id = ${orgA.teamId} AND withdrawn_at IS NULL`).toHaveLength(1);
    expect((await sql`SELECT team_id FROM learnings WHERE id = ${later.id}`)[0].team_id).toBe(owner.teamId);
    expect(await shareAfterJoin(owner, orgB.teamId, orgB.teamName, { share: false, workAreas: "infra" })).toEqual({ decision: "not_now", published: 0 });
    expect(await sql`SELECT id FROM project_sharing_grants WHERE owner_member_id = ${owner.memberId} AND team_id = ${orgB.teamId} AND withdrawn_at IS NULL`).toHaveLength(0);
    expect(await sql`SELECT learning_id FROM learning_shares WHERE owner_member_id = ${owner.memberId} AND team_id = ${orgB.teamId}`).toHaveLength(0);
    expect((await ownerCapturePolicy(owner)).workAreas).toBe("infra");
  });

  it("switches to selected projects only and back to every repo with human authority", async () => {
    const current = await ownerCapturePolicy(owner);
    const selected = await shareProjects(owner, { mode: "selected", include: ["github.com/anywhere/web"], revision: current.revision, humanInstruction: "Only learn from web." });
    expect(selected.mode).toBe("selected");
    await expect(pushLearning(owner, capture("github.com/anywhere/ops", "Ops finding while selected only."))).rejects.toMatchObject({ status: 403 });
    expect(await sql`SELECT learning_id FROM learning_shares WHERE owner_member_id = ${owner.memberId} AND team_id = ${orgA.teamId} AND withdrawn_at IS NULL`).toHaveLength(1);
    const everything = await shareProjects(owner, { mode: "everything", revision: selected.revision, humanInstruction: "Learn from every repo again." });
    expect(everything).toMatchObject({ mode: "everything", include: ["github.com/anywhere/web"] });
    expect(await sql`SELECT learning_id FROM learning_shares WHERE owner_member_id = ${owner.memberId} AND team_id = ${orgA.teamId} AND withdrawn_at IS NULL`).toHaveLength(1);
  });

  it("gives existing owners with a project list selected-only mode and everyone else capture by default", async () => {
    const directory = new URL("../../drizzle/", import.meta.url);
    const marker = new Error("Fixture rollback");
    await expect(sql.begin(async (tx) => {
      await tx`UPDATE owner_capture_policy_history SET capture_mode = 'selected', work_areas = ''`;
      await tx`UPDATE owner_capture_policies SET work_areas = ''`;
      await tx.unsafe(await readFile(new URL("rollback/0035_capture_by_default.sql", directory), "utf8"));
      await tx`UPDATE owner_capture_policies SET include_patterns = '{github.com/listed/repo}' WHERE owner_member_id = ${owner.memberId}`;
      await tx`INSERT INTO owner_capture_policies (owner_member_id) VALUES (${orgA.memberId})`;
      await tx.unsafe(await readFile(new URL("0035_capture_by_default.sql", directory), "utf8"));
      expect((await tx`SELECT capture_mode FROM owner_capture_policies WHERE owner_member_id = ${owner.memberId}`)[0].capture_mode).toBe("selected");
      expect((await tx`SELECT capture_mode, work_areas FROM owner_capture_policies WHERE owner_member_id = ${orgA.memberId}`)[0]).toEqual({ capture_mode: "everything", work_areas: "" });
      await tx`UPDATE owner_capture_policies SET work_areas = 'frontend' WHERE owner_member_id = ${orgA.memberId}`;
      await expect(tx.unsafe(await readFile(new URL("rollback/0035_capture_by_default.sql", directory), "utf8"))).rejects.toThrow(/discard their choice/);
      throw marker;
    })).rejects.toBe(marker);
  });
});
