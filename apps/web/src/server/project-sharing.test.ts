import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hivePushInput, type HiveContext } from "@hivemind/core";
import { getSql } from "./db/client";
import { newId } from "./db/ids";
import { createTeam } from "./auth";
import { memberContext } from "./identity/enrollment";
import { bindVerifiedOwner, followOwnerMemberships } from "./identity/legacy-owner-fixture";
import { captureOwner, delegateProjectSelection, ownerCapturePolicy, publishCell, publishProject, shareProjects, withdrawProject, withdrawPublication } from "./project-sharing";
import { getLearning, pushLearning, recentLearnings, searchLearnings, askHive, recordFeedback } from "./hive";
import { learningVersions, editLearning, listConflicts } from "./lifecycle";
import { conflictCell, listDecisions } from "./conflict-decisions";
import { feedbackHistory } from "./feedback";
import { browseKnowledge, readKnowledge, snapshotKnowledge, downloadKnowledge } from "./knowledge-tree";
import { createCaptureRule, listCaptureRules } from "./capture-rules";
import { captureRuleInputSchema } from "@hivemind/core";
import { gatherDigest } from "./digests/data";
import { moderateLearning } from "./identity/access";
import { mcpJoin } from "./identity/mcp-join";
import { generateJoinPhrase, pauseJoinPhrase, issueJoinCapability } from "./identity/join-phrases";
import { originFor, withOrigin } from "./analytics/events";
import { trustedProxyIp } from "./trusted-proxy";

const models = vi.hoisted(() => ({classify: vi.fn(), embed: vi.fn(), categories: vi.fn(), synthesize: vi.fn(), memory: vi.fn(), blobs: new Map<string, Buffer>()}));
vi.mock("server-only", () => ({}));
vi.mock("./classify", async original => ({...await original<typeof import("./classify")>(), classifyPush: models.classify, classifyAsk: async () => ({classification: null, decision: "answer"})}));
vi.mock("./capture-categories", () => ({classifyCaptureCategories: models.categories}));
vi.mock("./llm/embeddings", () => ({embedText: models.embed}));
vi.mock("./llm/tagger", () => ({suggestTags: async () => []}));
vi.mock("./llm/synthesize", () => ({synthesizeAnswer: models.synthesize, extractiveAnswer: (hits: any[]) => ({answer: hits.map(h => h.body).join("\n"), citations: hits.map(h => ({id: h.id, title: h.title, why: "Evidence"})), confidence: "high", gaps: null, synthesized: false})}));
vi.mock("./memory-judgments", () => ({judgeMemory: models.memory, rerankMemory: async (_query: string, hits: unknown[]) => hits}));
vi.mock("./blob-store", () => ({putPrivateObject: async (key: string, content: Buffer) => {models.blobs.set(key, Buffer.from(content));}, readPrivateObject: async (key: string) => models.blobs.get(key)!}));

it("trusts only Vercel's overwritten proxy IP at the request boundary", () => {
  vi.stubEnv("VERCEL", "1");
  expect(trustedProxyIp(new Request("https://gohive.dev", {headers: {"x-forwarded-for": "1.1.1.1", "x-vercel-forwarded-for": "198.18.1.2"}}))).toBe("198.18.1.2");
  expect(trustedProxyIp(new Request("https://gohive.dev", {headers: {"x-forwarded-for": "1.1.1.1"}}))).toBeNull();
  vi.unstubAllEnvs();
});

describe.skipIf(!process.env.DATABASE_URL)("private capture and publication audiences", {timeout: 60000}, () => {
  const suffix = randomBytes(6).toString("hex");
  const sql = getSql();
  const members: string[] = [];
  const teams: string[] = [];
  let owner: HiveContext, ownerOrg: HiveContext, orgA: HiveContext, orgB: HiveContext, agent: HiveContext, other: HiveContext;
  let cellId: string;
  const project = "github.com/selected/widget";
  const observation = "Audience canary: migration locks survive interrupted workers. Release the cancelled worker connection before retrying.";
  beforeAll(async () => {
    orgA = (await createTeam({teamName: `Audience A ${suffix}`, memberName: "Admin A"})).ctx;
    orgB = (await createTeam({teamName: `Audience B ${suffix}`, memberName: "Admin B"})).ctx;
    ownerOrg = (await createTeam({teamName: `Owner fixture ${suffix}`, memberName: "Owner"})).ctx;
    other = (await createTeam({teamName: `Other fixture ${suffix}`, memberName: "Other"})).ctx;
    for (const ctx of [orgA, orgB, ownerOrg, other]) {members.push(ctx.memberId); teams.push(ctx.teamId);}
    await sql`UPDATE members SET email = ${`owner-${suffix}@${suffix}.work.example.test`}, email_verified = true WHERE id = ${ownerOrg.memberId}`;
    owner = (await captureOwner(ownerOrg)).personal;
    await sql`INSERT INTO hive_memberships (member_id, team_id) VALUES (${owner.memberId}, ${orgA.teamId}), (${owner.memberId}, ${orgB.teamId})`;
    await sql.begin(tx => bindVerifiedOwner(tx, {sub: `owner-${suffix}`, email: `owner-${suffix}@${suffix}.work.example.test`}, true));
    const agentId = newId("mem"); members.push(agentId);
    await sql`INSERT INTO members (id, name, email, email_verified, actor_type) VALUES (${agentId}, 'Bound agent', ${`agent-${suffix}@agentmail.to`}, true, 'agent')`;
    await sql`INSERT INTO auth_accounts (id, user_id, account_id, provider_id, owner_sub, owner_email_verified) VALUES (${newId("auth")}, ${agentId}, ${agentId}, 'agentid', ${`owner-${suffix}`}, true)`;
    await sql.begin(tx => followOwnerMemberships(tx, owner.memberId));
    agent = (await memberContext(agentId, owner.teamId))!;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    models.classify.mockImplementation(async (input: any) => ({classification: null, decision: {action: "accept", kind: input.kind ?? "learning", tags: []}}));
    models.categories.mockImplementation(async (_input: unknown, categories: string[]) => Object.fromEntries(categories.map(c => [c, false])));
    models.embed.mockResolvedValue(null);
    models.synthesize.mockRejectedValue(new Error("Use extractive fixture"));
    models.memory.mockResolvedValue({tags: [], relations: []});
  });
  afterAll(async () => {
    await sql`DELETE FROM ask_log WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM feedback WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM feedback_receipts WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM learning_pushes WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM learnings WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM capture_rules WHERE created_by = ANY(${members}::text[])`;
    await sql`DELETE FROM api_keys WHERE member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM hive_join_capabilities WHERE team_id = ANY(${teams}::text[])`;
    await sql`DELETE FROM hive_join_phrases WHERE team_id = ANY(${teams}::text[])`;
    await sql`DELETE FROM team_domains WHERE team_id = ANY(${teams}::text[])`;
    await sql`DELETE FROM teams WHERE id = ANY(${teams}::text[])`;
    await sql`DELETE FROM owner_capture_policy_history WHERE owner_member_id = ANY(${members}::text[])`;
    await sql`DELETE FROM members WHERE id = ANY(${members}::text[])`;
    await sql.end();
  });
  const capture = (repo = project, extra = {}) => hivePushInput.parse({title: "Audience canary", body: observation, source: "codex", repo, ...extra});

  it("preserves organisation backfill and safely rolls back an unused migration", async () => {
    const directory = new URL("../../drizzle/", import.meta.url);
    const marker = new Error("Fixture rollback");
    await expect(sql.begin(async tx => {
      const schema = `r2_migration_${suffix}`;
      await tx`CREATE SCHEMA ${tx(schema)}`;
      await tx`SELECT set_config('search_path', ${schema + ',public'}, true)`;
      for (const file of (await readdir(directory)).filter(name => name.endsWith(".sql") && name < "0028").sort())
        await tx.unsafe(await readFile(new URL(file, directory), "utf8"));
      await tx`CREATE TABLE _migrations (name text PRIMARY KEY)`;
      await tx`INSERT INTO teams (id, name, invite_code) VALUES ('fixture_org', 'Organisation', 'fixture_invite')`;
      await tx`INSERT INTO members (id, team_id, name) VALUES ('fixture_owner', 'fixture_org', 'Owner')`;
      await tx`INSERT INTO learnings (id, team_id, member_id, title, body, kind, source, confidence) VALUES ('fixture_slack', 'fixture_org', 'fixture_owner', 'Existing cell', 'Original body', 'learning', 'slack', 1)`;
      const before = await tx`SELECT to_jsonb(l) AS cell FROM learnings l`;
      const versions = await tx`SELECT to_jsonb(v) AS version FROM learning_versions v`;
      const migration = await readFile(new URL("0028_project_sharing.sql", directory), "utf8");
      await tx.unsafe(migration);
      await tx.unsafe(migration);
      expect(await tx`SELECT to_jsonb(l) AS cell FROM learnings l`).toEqual(before);
      expect(await tx`SELECT to_jsonb(v) AS version FROM learning_versions v`).toEqual(versions);
      expect(await tx`SELECT learning_id FROM learning_shares`).toHaveLength(0);
      expect(await tx`SELECT id FROM learning_audience_cells`).toEqual([{id: "fixture_slack"}]);
      await tx.unsafe(await readFile(new URL("rollback/0028_project_sharing.sql", directory), "utf8"));
      expect(await tx`SELECT to_jsonb(l) AS cell FROM learnings l`).toEqual(before);
      expect((await tx`SELECT conname FROM pg_constraint WHERE conrelid = 'feedback'::regclass AND confrelid = 'learnings'::regclass AND cardinality(confkey) = 2`)).toHaveLength(1);
      throw marker;
    })).rejects.toBe(marker);
  });

  it("rejects unselected and unknown capture before classification or embeddings", async () => {
    await expect(pushLearning(agent, capture())).rejects.toThrow(/No projects selected/);
    expect(models.classify).not.toHaveBeenCalled();
    expect(models.embed).not.toHaveBeenCalled();
    expect(models.categories).not.toHaveBeenCalled();
    await expect(shareProjects(agent, {include: [project], revision: 0})).rejects.toThrow(/human's project selection/);
    await expect(pushLearning(agent, capture(project, {context: {repo: "github.com/other/repo"}}))).rejects.toMatchObject({status: 403});
    const policy = await shareProjects(agent, {include: ["https://secret:password@github.com/selected/widget.git"], exclude: [], revision: 0, humanInstruction: "Learn from selected/widget only."});
    expect(policy).toEqual({include: [project], exclude: [], revision: 1});
    expect((await sql`SELECT authority, human_instruction FROM owner_capture_policy_history WHERE owner_member_id = ${owner.memberId}`)[0]).toEqual({authority: "initial_instruction", human_instruction: "Learn from selected/widget only."});
    for (const input of [capture("github.com/unselected/widget"), hivePushInput.parse({observation}), capture(project, {remote: "git@github.com:other/widget.git"})]) await expect(pushLearning(agent, input)).rejects.toMatchObject({status: 403});
    expect(models.classify).not.toHaveBeenCalled();
    expect(await sql`SELECT id FROM learnings WHERE member_id = ${agent.memberId}`).toHaveLength(0);
  });

  it("stores selected agent captures privately and preserves owner attribution", async () => {
    const saved = await pushLearning({...agent, teamId: orgA.teamId}, capture());
    if (saved.dropped) throw new Error("Capture unexpectedly dropped");
    cellId = saved.id;
    expect((await sql`SELECT team_id, owner_member_id, member_id, repo FROM learnings WHERE id = ${cellId}`)[0]).toEqual({team_id: owner.teamId, owner_member_id: owner.memberId, member_id: agent.memberId, repo: project});
    expect(await getLearning(owner, cellId)).not.toBeNull();
    expect(await getLearning(orgA, cellId)).toBeNull();
    expect(await getLearning(orgB, cellId)).toBeNull();
    expect((await ownerCapturePolicy(ownerOrg)).revision).toBe(1);
  });

  it("refuses widening and stale revisions; consumes an exact human delegation once", async () => {
    await expect(shareProjects(agent, {include: [project, "github.com/second/widget"], revision: 1, humanInstruction: "The owner said yes"})).rejects.toMatchObject({status: 403});
    await expect(shareProjects(owner, {exclude: [], revision: 0})).rejects.toMatchObject({status: 409});
    await delegateProjectSelection(owner, agent.memberId, {include: [project, "github.com/second/widget"], exclude: [], revision: 1});
    expect((await shareProjects(agent, {include: [project, "github.com/second/widget"], exclude: [], revision: 1})).revision).toBe(2);
    expect((await sql`SELECT consumed_at FROM capture_policy_delegations WHERE owner_member_id = ${owner.memberId}`)[0].consumed_at).not.toBeNull();
    await expect(withOrigin(originFor(owner, "mcp", "api_key"), () => shareProjects(owner, {include: ["github.com/*/*"], revision: 2}))).rejects.toMatchObject({status: 403});
  });

  it("rejects a capture commit when project selection changes during classification", async () => {
    models.classify.mockImplementationOnce(async () => {
      await shareProjects(owner, {exclude: ["github.com/second/widget"], revision: 2});
      return {classification: null, decision: {action: "accept", kind: "learning", tags: []}};
    });
    await expect(pushLearning(agent, capture("github.com/second/widget", {title: "Race canary"}))).rejects.toMatchObject({status: 403});
    expect(await sql`SELECT id FROM learnings WHERE member_id = ${agent.memberId} AND title = 'Race canary'`).toHaveLength(0);
  });

  it("publishes only the chosen revision into one named organisation", async () => {
    const original = (await sql`SELECT revision FROM learnings WHERE id = ${cellId}`)[0];
    await editLearning(owner, cellId, {revision: original.revision, body: observation + " Public revision."});
    const revision = (await sql`SELECT revision FROM learnings WHERE id = ${cellId}`)[0].revision;
    expect(await publishCell(owner, cellId, orgA.teamId, revision)).toEqual({published: true});
    expect(await getLearning(orgA, cellId)).toMatchObject({revision, sessionRef: null, captureRuleIds: [], captureCategories: {}});
    expect(await getLearning(orgB, cellId)).toBeNull();
    const history = await learningVersions(orgA, cellId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({revision, diff: {}});
    expect(JSON.stringify(history)).not.toContain("capture_context");
    expect((await conflictCell(orgA, cellId))?.evidence).toEqual([]);
    expect(await listConflicts(orgA)).toEqual([]);
    expect(await listDecisions(orgA)).toEqual([]);
    expect((await searchLearnings(orgA, {query: "audience canary", limit: 20})).map(c => c.id)).toContain(cellId);
    expect((await recentLearnings(orgA, {since: "1d", limit: 50})).map(c => c.id)).toContain(cellId);
    expect((await askHive(orgA, {question: "audience canary", limit: 8} as any)).citations.map(c => c.id)).toContain(cellId);
  });

  it("deduplicates personal search across organisations without widening team MCP credentials", async () => {
    const revision = (await sql`SELECT revision FROM learnings WHERE id = ${cellId}`)[0].revision;
    await publishCell(owner, cellId, orgB.teamId, revision);
    const hits = await searchLearnings(owner, {query: "audience canary", limit: 20});
    expect(hits.filter(c => c.id === cellId)).toHaveLength(1);
    expect((await gatherDigest(owner.teamId, new Date(0))).learnings).toEqual([]);
    expect((await gatherDigest(orgA.teamId, new Date(0))).learnings.map(c => c.id)).toContain(cellId);
  });

  it("scopes votes and receipts to their audience and does not mutate private standing", async () => {
    const before = (await getLearning(owner, cellId))!.votes;
    const vote = await recordFeedback(orgA, {id: cellId, vote: "outdated", note: "The organisation needs to recheck this."});
    expect((await getLearning(orgA, cellId))?.votes.outdated).toBe(1);
    expect((await getLearning(orgB, cellId))?.votes.outdated).toBe(0);
    expect((await getLearning(owner, cellId))?.votes).toEqual(before);
    expect((await feedbackHistory(orgA, cellId)).map(r => r.receipt)).toContain(vote.receipt);
    expect(await feedbackHistory(orgB, cellId)).toEqual([]);
    await expect(recordFeedback(orgB, {id: cellId, withdraw: true, receipt: vote.receipt})).rejects.toMatchObject({status: 404});
  });

  it("withdraws every organisation read surface and invalidates issued snapshots", async () => {
    const listing = await browseKnowledge(orgA);
    expect(listing.entries.length).toBeGreaterThan(0);
    expect((await readKnowledge(orgA, "INDEX.md")).content).toContain(cellId);
    const snapshot = await snapshotKnowledge(orgA);
    const token = new URL(snapshot.url).searchParams.get("token")!;
    expect((await downloadKnowledge(token)).length).toBeGreaterThan(0);
    await withdrawPublication(orgA, cellId, orgA.teamId);
    expect(await getLearning(orgA, cellId)).toBeNull();
    expect(await searchLearnings(orgA, {query: "audience canary", limit: 20})).toEqual([]);
    expect((await recentLearnings(orgA, {since: "1d", limit: 50})).map(c => c.id)).not.toContain(cellId);
    await expect(learningVersions(orgA, cellId)).rejects.toMatchObject({status: 404});
    await expect(feedbackHistory(orgA, cellId)).rejects.toMatchObject({status: 404});
    expect(await conflictCell(orgA, cellId)).toBeNull();
    expect((await readKnowledge(orgA, "INDEX.md")).content).not.toContain(cellId);
    await expect(downloadKnowledge(token)).rejects.toMatchObject({status: 404});
    expect((await gatherDigest(orgA.teamId, new Date(0))).learnings.map(c => c.id)).not.toContain(cellId);
    expect(await getLearning(owner, cellId)).not.toBeNull();
    expect(await getLearning(orgB, cellId)).not.toBeNull();
  });

  it("lets organisation admins withdraw without deleting the personal original", async () => {
    await moderateLearning(orgB, cellId, "delete");
    expect(await getLearning(orgB, cellId)).toBeNull();
    expect((await getLearning(owner, cellId))?.lifecycle).not.toBe("retracted");
  });

  it("blocks restrictive organisation publication, hides private rules and withdraws project grants", async () => {
    const secret = await createCaptureRule(owner, captureRuleInputSchema.parse({name: "Owner private exclusion", kind: "keyword", pattern: "private-instruction", action: "drop"}));
    expect((await listCaptureRules(agent)).map(r => r.id)).toContain(secret.id);
    expect((await listCaptureRules(orgA)).map(r => r.id)).not.toContain(secret.id);
    const blocking = await createCaptureRule(orgA, captureRuleInputSchema.parse({name: "Organisation restriction", scope: "team", kind: "keyword", pattern: "Audience", action: "drop"}));
    const before = await getLearning(owner, cellId);
    expect((await publishProject(owner, orgA.teamId, project)).published).toBe(0);
    expect(await getLearning(owner, cellId)).toEqual(before);
    expect(blocking.scope).toBe("team");
    const grant = await publishProject(owner, orgB.teamId, project);
    expect(grant.published).toBe(1);
    await withdrawProject(orgB, grant.id, orgB.teamId);
    expect(await getLearning(orgB, cellId)).toBeNull();
    await pushLearning(agent, capture());
    expect(await getLearning(orgB, cellId)).toBeNull();
  });

  it("refuses cross-owner supersession even through low-level writes", async () => {
    const another = newId("lrn");
    await sql`INSERT INTO learnings (id, team_id, member_id, title, body, kind, source, confidence) VALUES (${another}, ${other.teamId}, ${other.memberId}, 'Other owner', 'Other body', 'learning', 'manual', 1)`;
    await expect(sql`INSERT INTO learning_supersessions (id, team_id, older_id, newer_id, older_revision, newer_revision, relation, confidence, reason) VALUES (${newId("sup")}, ${owner.teamId}, ${cellId}, ${another}, 1, 1, 'update', 1, 'Forbidden')`).rejects.toMatchObject({code: "23514"});
  });

  it("joins with a human token or a live granted capability; otherwise returns only the human link", async () => {
    await sql`DELETE FROM rate_limits WHERE bucket LIKE 'join-phrase-%'`;
    await sql`INSERT INTO team_domains (team_id, domain, created_by) VALUES (${orgA.teamId}, ${`${suffix}.work.example.test`}, ${orgA.memberId}) ON CONFLICT DO NOTHING`;
    const phrase = await generateJoinPhrase(orgA);
    await pauseJoinPhrase(orgA, false);
    const options = {trustedProxyIp: "198.18.1.90", sessionKind: "oauth"};
    expect(await mcpJoin(agent, phrase.phrase, options)).toEqual({status: "needs_human", joinUrl: `https://gohive.dev/j/${phrase.phrase}`});
    expect((await mcpJoin(owner, phrase.phrase, options)).status).toBe("joined");
    await issueJoinCapability(owner, phrase.phrase, agent.memberId, options);
    expect((await mcpJoin(agent, phrase.phrase, options)).status).toBe("joined");
    expect(await sql`SELECT learning_id FROM learning_shares WHERE withdrawn_at IS NULL AND team_id = ${orgA.teamId}`).toHaveLength(0);
  });

  it("withdraws publication and mixed snapshots when the publisher leaves an organisation", async () => {
    const grant = await publishProject(owner, orgB.teamId, project);
    expect(grant.published).toBeGreaterThanOrEqual(1);
    const snapshot = await snapshotKnowledge(orgB);
    const token = new URL(snapshot.url).searchParams.get("token")!;
    await sql`UPDATE hive_memberships SET removed_at = now() WHERE member_id = ${owner.memberId} AND team_id = ${orgB.teamId}`;
    expect(await getLearning(orgB, cellId)).toBeNull();
    await expect(downloadKnowledge(token)).rejects.toMatchObject({status: 404});
    expect((await sql`SELECT withdrawn_at FROM project_sharing_grants WHERE id = ${grant.id}`)[0].withdrawn_at).not.toBeNull();
    expect(await getLearning(owner, cellId)).not.toBeNull();
  });

  it("replays migration and refuses lossy rollback after grants and policy audit exist", async () => {
    await sql.begin(tx => tx.unsafe(awaitReadMigration));
    const rollback = await readFile(new URL("../../drizzle/rollback/0028_project_sharing.sql", import.meta.url), "utf8");
    await expect(sql.begin(tx => tx.unsafe(rollback))).rejects.toThrow(/Refuse lossy rollback/);
  });
  let awaitReadMigration: string;
  beforeAll(async () => {awaitReadMigration = await readFile(new URL("../../drizzle/0028_project_sharing.sql", import.meta.url), "utf8");});
});
