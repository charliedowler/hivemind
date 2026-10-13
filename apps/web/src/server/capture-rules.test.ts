import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {captureRuleInputSchema, hivePushInput, type HiveContext} from "@hivemind/core";
import {createTeam, joinTeam} from "./auth";
import {getSql} from "./db/client";
import {newId} from "./db/ids";
import {createCaptureRule, updateCaptureRule, deleteCaptureRule, listCaptureRules, effectiveRules, previewCaptureRule, applyCaptureRule, listCaptureRuleApplications, reverseCaptureRuleApplication, confirmFlaggedCapture, proposeRuleFromText} from "./capture-rules";
import {pushLearning, getLearning, searchLearnings, recentLearnings, askHive} from "./hive";
import {learningVersions} from "./lifecycle";
import {originFor, withOrigin, type EventRow} from "./analytics/events";
import {classifyCaptureCategories} from "./capture-categories";
import {embedText} from "./llm/embeddings";

const models = vi.hoisted(() => ({create: vi.fn(), classify: vi.fn(), synthesize: vi.fn()}));
vi.mock("@anthropic-ai/sdk", () => ({default: class {messages = {create: models.create};}}));
vi.mock("./capture-categories", () => ({classifyCaptureCategories: vi.fn(async (_input, categories: string[]) => Object.fromEntries(categories.map(category => [category, true])))}));
vi.mock("./classify", async original => ({...await original<typeof import("./classify")>(), classifyPush: models.classify, classifyAsk: vi.fn(async () => ({classification: null, decision: "gap"})), classificationJson: (value: unknown) => value}));
vi.mock("./llm/embeddings", () => ({embedText: vi.fn(async () => null)}));
vi.mock("./llm/synthesize", () => ({synthesizeAnswer: models.synthesize, extractiveAnswer: vi.fn()}));
vi.mock("./memory-judgments", () => ({judgeMemory: vi.fn(async () => ({tags: [], relations: []})), rerankMemory: vi.fn(async (_question, hits) => hits)}));
vi.mock("./conflict-decisions", () => ({prepareConflicts: vi.fn(async () => []), retryRelatedConflicts: vi.fn(async () => []), recordConflictEvent: vi.fn(), applyConflictDecision: vi.fn()}));
vi.mock("./knowledge-tree", () => ({scheduleKnowledge: vi.fn(), ensureKnowledge: vi.fn(), queueEvidence: vi.fn()}));

const enabled = Boolean(process.env.DATABASE_URL);
describe.skipIf(!enabled)("capture rule storage and ingress", {timeout: 60000}, () => {
  let a: HiveContext, member: HiveContext, other: HiveContext, b: HiveContext;
  const teams: string[] = [];
  beforeAll(async () => {
    const connections = await Promise.all([getSql().reserve(), getSql().reserve(), getSql().reserve()]);
    for (const connection of connections) await connection`SET synchronous_commit = off`;
    for (const connection of connections) connection.release();
    const first = await createTeam({teamName: "Capture A", memberName: "Admin"});
    a = first.ctx;
    member = (await joinTeam({inviteCode: first.inviteCode, memberName: "Owner"}))!.ctx;
    other = (await joinTeam({inviteCode: first.inviteCode, memberName: "Other"}))!.ctx;
    b = (await createTeam({teamName: "Capture B", memberName: "Other admin"})).ctx;
    teams.push(a.teamId, b.teamId);
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    models.classify.mockImplementation(async input => ({classification: null, decision: {action: "accept", kind: input.kind ?? "learning", tags: []}}));
    await getSql()`DELETE FROM capture_rule_applications WHERE team_id = ANY(${teams}::text[])`;
    await getSql()`DELETE FROM feedback WHERE team_id = ANY(${teams}::text[])`;
    await getSql()`DELETE FROM learning_pushes WHERE team_id = ANY(${teams}::text[])`;
    await getSql()`DELETE FROM ask_log WHERE team_id = ANY(${teams}::text[])`;
    await getSql()`DELETE FROM learnings WHERE team_id = ANY(${teams}::text[])`;
    await getSql()`DELETE FROM capture_rules WHERE team_id = ANY(${teams}::text[])`;
  });
  afterAll(async () => {
    const sql = getSql();
    for (const table of ["capture_rule_applications", "capture_rule_previews", "capture_rules", "feedback", "learning_pushes", "ask_log", "learnings", "api_keys", "web_sessions", "members", "teams"]) {
      if (table === "teams") await sql`DELETE FROM teams WHERE id = ANY(${teams}::text[])`;
      else await sql`DELETE FROM ${sql(table)} WHERE team_id = ANY(${teams}::text[])`;
    }
    await sql.end();
  });
  const ruleInput = (extra: Record<string, unknown> = {}) => captureRuleInputSchema.parse({name: "Capture pattern", kind: "keyword", pattern: "private-marker", action: "drop", ...extra});
  const accepted = async (ctx: HiveContext, input: Record<string, unknown>) => {
    const result = await pushLearning(ctx, hivePushInput.parse(input));
    if (result.dropped) throw new Error("Expected an accepted fixture.");
    return result;
  };

  it("keeps team and own member rules isolated, stores provenance and enforces admin scope", async () => {
    const own = await createCaptureRule(member, ruleInput({naturalText: "Do not save the marker", source: "mcp"}));
    const team = await createCaptureRule(a, ruleInput({scope: "team", pattern: "team-marker"}));
    const theirs = await createCaptureRule(other, ruleInput({pattern: "other-marker"}));
    await createCaptureRule(b, ruleInput({scope: "team"}));
    expect((await effectiveRules(member)).map(rule => rule.id).sort()).toEqual([own.id, team.id].sort());
    expect((await effectiveRules(a)).map(rule => rule.id)).toEqual([team.id]);
    expect(own).toMatchObject({source: "mcp", naturalText: "Do not save the marker", createdBy: member.memberId});
    await expect(createCaptureRule(member, ruleInput({scope: "team"}))).rejects.toMatchObject({status: 403});
    await expect(updateCaptureRule(member, team.id, ruleInput({scope: "team"}))).rejects.toMatchObject({status: 403});
    await expect(deleteCaptureRule(member, theirs.id)).rejects.toMatchObject({status: 403});
    await expect(deleteCaptureRule(a, own.id)).rejects.toMatchObject({status: 403});
    await expect(updateCaptureRule(b, own.id, ruleInput())).rejects.toMatchObject({status: 404});
    const disabled = await updateCaptureRule(member, own.id, ruleInput({enabled: false}));
    expect(disabled.enabled).toBe(false);
    expect((await effectiveRules(member)).map(rule => rule.id)).toEqual([team.id]);
    expect((await listCaptureRules(member)).map(rule => rule.id)).toContain(own.id);
    await deleteCaptureRule(member, own.id);
  });

  it.each(["mcp", "web", "slack", "hook"] as const)("drops %s input before enrichment or durable content", async ingress => {
    const rule = await createCaptureRule(member, ruleInput());
    await createCaptureRule(a, ruleInput({scope: "team", kind: "content_category", category: "personal_info"}));
    const events: EventRow[] = [];
    const result = await withOrigin(originFor(member, ingress), () => pushLearning(member, hivePushInput.parse({title: `private-marker ${ingress}`, body: "A fact.", source: "codex"})), async event => {events.push(event);});
    expect(result).toEqual({dropped: true, rule: "keyword"});
    expect(models.classify).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
    expect(classifyCaptureCategories).not.toHaveBeenCalled();
    expect(await getSql()`SELECT id FROM learnings WHERE team_id = ${a.teamId} AND title LIKE ${`private-marker ${ingress}%`}`).toHaveLength(0);
    const dropped = events.find(event => event.event_name === "capture.rule_dropped")!;
    expect(dropped.properties).toMatchObject({ruleId: rule.id, ruleKind: "keyword"});
    const applied = events.find(event => event.event_name === "capture.rule_applied")!;
    expect(applied.properties).toMatchObject({ruleKind: "keyword", ruleAction: "drop", ingress, agent: "codex"});
    expect(JSON.stringify(events)).not.toContain("private-marker");
  });

  it.each([
    {kind: "repo_owner", owners: ["team"], mode: "only_allow", input: {repo: "personal/repo"}},
    {kind: "repo_owner", owners: ["personal", "private"], mode: "deny", input: {remote: "git@github.com:private/repo.git"}},
    {kind: "repo_match", pattern: "https://github.com/private/*.git", input: {remote: "https://github.com/private/repo.git"}},
    {kind: "path_match", pattern: "~/personal/**", input: {cwd: "/Users/fixture/personal/work", home: "/Users/fixture"}},
    {kind: "agent_or_client", sessionType: "personal", input: {agent: "codex", sessionType: "personal"}},
    {kind: "keyword", pattern: "secret-[0-9]{2}", regex: true, input: {body: "secret-42"}},
    {kind: "content_category", category: "non_work", input: {body: "A private activity"}},
  ])("matches $kind before storage and captures relevant context", async ({input, ...config}) => {
    const rule = await createCaptureRule(member, ruleInput(config));
    const result = await pushLearning(member, hivePushInput.parse({title: "Rule input fixture", body: "A work fact", ...input}));
    expect(result).toEqual({dropped: true, rule: rule.kind});
    expect(models.classify).not.toHaveBeenCalled();
    expect(embedText).not.toHaveBeenCalled();
    expect(await getSql()`SELECT id FROM learnings WHERE team_id = ${a.teamId}`).toHaveLength(0);
  });

  it("persists capture context for metadata-only retroactive matching", async () => {
    const cell = await accepted(member, {title: "Context fixture", body: "A technical fact", remote: "https://github.com/private/repo.git", cwd: "/Users/fixture/personal/repo", home: "/Users/fixture", agent: "codex", sessionType: "personal"});
    const context = await getSql()`SELECT capture_context FROM learnings WHERE id = ${cell.id} AND team_id = ${a.teamId}`;
    expect(context[0].capture_context).toMatchObject({agent: "codex", sessionType: "personal", home: "/Users/fixture"});
    for (const config of [{kind: "repo_match", pattern: "https://github.com/private/*.git"}, {kind: "path_match", pattern: "~/personal/**"}, {kind: "agent_or_client", sessionType: "personal"}]) {
      const rule = await createCaptureRule(member, ruleInput(config));
      expect((await previewCaptureRule(member, rule.id)).count).toBe(1);
      await deleteCaptureRule(member, rule.id);
    }
  });

  it("checks evidence before models, redacts spans and removes raw sidecars", async () => {
    await createCaptureRule(member, ruleInput());
    expect(await pushLearning(member, hivePushInput.parse({title: "Evidence gate", body: "Work fact", evidence: {diff: "private-marker"}}))).toMatchObject({dropped: true});
    expect(models.classify).not.toHaveBeenCalled();
    const rules = await listCaptureRules(member);
    await updateCaptureRule(member, rules[0].id, ruleInput({action: "redact"}));
    const result = await accepted(member, {title: "Redaction case", body: "Before private-marker after", paths: ["src/private-marker.ts"], tags: ["private-marker"], workaround: "private-marker", evidence: {diff: "private-marker"}});
    expect(result.learning).toMatchObject({body: "Before [removed] after", captureRedacted: true, paths: [], tags: [], repo: null, workaround: null});
    expect(JSON.stringify(models.classify.mock.calls)).not.toContain("private-marker");
  });

  it("persists requested category verdicts and reuses them for preview", async () => {
    const rule = await createCaptureRule(member, ruleInput({kind: "content_category", category: "customer_data", action: "flag"}));
    const cell = await accepted(member, {title: "Categorised fixture", body: "Observed work fixture"});
    expect(cell.learning.captureFlagged).toBe(true);
    const stored = await getSql()`SELECT capture_categories FROM learnings WHERE id = ${cell.id} AND team_id = ${a.teamId}`;
    expect(stored[0].capture_categories).toEqual({customer_data: true});
    vi.mocked(classifyCaptureCategories).mockClear();
    const preview = await previewCaptureRule(member, rule.id);
    expect(preview.count).toBeGreaterThan(0);
    expect(classifyCaptureCategories).not.toHaveBeenCalled();
  });

  it("keeps flag duplicates separate and excludes owner-private content from answers and Slack", async () => {
    const input = {title: "Flag privacy zebra", body: "Private zebra fact", kind: "insight", repo: "team/privacy"};
    const shared = await accepted(member, input);
    const rule = await createCaptureRule(member, ruleInput({pattern: "zebra", action: "flag"}));
    const flagged = await accepted(member, input);
    const duplicate = await accepted(member, input);
    expect(flagged.id).not.toBe(shared.id);
    expect(duplicate.id).toBe(flagged.id);
    expect(await getLearning(other, flagged.id)).toBeNull();
    expect(await getLearning(a, flagged.id)).toBeNull();
    expect((await getLearning(member, flagged.id))?.canConfirmCapture).toBe(true);
    expect(await getLearning(b, flagged.id)).toBeNull();
    expect((await searchLearnings(member, {query: "zebra", limit: 25})).map(cell => cell.id)).toContain(flagged.id);
    expect((await searchLearnings(other, {query: "zebra", limit: 25})).map(cell => cell.id)).not.toContain(flagged.id);
    expect((await recentLearnings(a, {since: "1d", limit: 50})).map(cell => cell.id)).not.toContain(flagged.id);
    const slack = await withOrigin(originFor(member, "slack"), () => searchLearnings(member, {query: "zebra", limit: 25}));
    expect(slack.map(cell => cell.id)).not.toContain(flagged.id);
    for (const entrypoint of ["slack", "scheduled"] as const) {
      const recent = await withOrigin(originFor(member, entrypoint), () => recentLearnings(member, {since: "1d", limit: 50}));
      expect(recent.map(cell => cell.id)).not.toContain(flagged.id);
      expect(await withOrigin(originFor(member, entrypoint), () => getLearning(member, flagged.id))).toBeNull();
      await expect(withOrigin(originFor(member, entrypoint), () => learningVersions(member, flagged.id))).rejects.toMatchObject({status: 404});
    }
    const answer = await askHive(member, {question: "Private zebra fact", repo: "team/privacy"});
    expect(answer.citations.map(cell => cell.id)).not.toContain(flagged.id);
    await expect(confirmFlaggedCapture(a, flagged.id)).rejects.toMatchObject({status: 404});
    await expect(confirmFlaggedCapture(other, flagged.id)).rejects.toMatchObject({status: 404});
    await deleteCaptureRule(member, rule.id);
    await confirmFlaggedCapture(member, flagged.id);
    expect((await getLearning(other, flagged.id))?.captureFlagged).toBe(false);
  });

  it.each(["drop", "redact", "flag"] as const)("applies %s with revision guards, private history and admin reversal", async action => {
    const marker = `retro-${action}-marker`;
    const cell = await accepted(member, {title: `Retro ${action}`, body: `Before ${marker} after`, kind: "friction", area: "tool", cost: 4});
    const rule = await createCaptureRule(member, ruleInput({pattern: marker, action}));
    const preview = await previewCaptureRule(member, rule.id);
    expect(preview.count).toBe(1);
    await expect(applyCaptureRule(other, rule.id, preview.token)).rejects.toMatchObject({status: 404});
    await getSql()`INSERT INTO knowledge_snapshots (token_hash, team_id, member_id, revision, object_key, expires_at) VALUES (${newId("snapshot")}, ${a.teamId}, ${other.memberId}, 0, 'fixture-private-snapshot', now() + interval '1 hour')`;
    const applied = await applyCaptureRule(member, rule.id, preview.token);
    expect(await getSql()`SELECT token_hash FROM knowledge_snapshots WHERE team_id = ${a.teamId}`).toHaveLength(0);
    expect(applied.applied).toBe(1);
    const own = await getLearning(member, cell.id);
    if (action === "drop") {
      expect(own).toMatchObject({lifecycle: "retracted", captureFlagged: true});
      expect(await getLearning(other, cell.id)).toBeNull();
      expect((await searchLearnings(other, {query: marker, include_history: true, limit: 25})).map(hit => hit.id)).not.toContain(cell.id);
      await expect(learningVersions(other, cell.id)).rejects.toMatchObject({status: 404});
    } else if (action === "redact") {
      expect(own).toMatchObject({lifecycle: "fresh", body: "Before [removed] after", captureRedacted: true});
      expect(JSON.stringify(await learningVersions(other, cell.id))).not.toContain(marker);
      expect(await getSql()`SELECT push_id FROM learning_evidence WHERE learning_id = ${cell.id} AND team_id = ${a.teamId}`).toHaveLength(0);
    } else {
      expect(own).toMatchObject({lifecycle: "fresh", captureFlagged: true});
      expect(await getLearning(a, cell.id)).toBeNull();
    }
    const ownHistory = await listCaptureRuleApplications(member);
    expect(ownHistory.map(log => log.id)).toContain(applied.logIds[0]);
    expect(JSON.stringify(ownHistory)).not.toContain("before_snapshot");
    expect((await listCaptureRuleApplications(other)).map(log => log.id)).not.toContain(applied.logIds[0]);
    const adminHistory = await listCaptureRuleApplications(a);
    if (action !== "redact") expect(adminHistory.find(log => log.id === applied.logIds[0])?.title).toBe("Private capture");
    await expect(reverseCaptureRuleApplication(member, applied.logIds[0], "Restore fixture")).rejects.toMatchObject({status: 403});
    await reverseCaptureRuleApplication(a, applied.logIds[0], "Restore fixture");
    const restored = await getLearning(member, cell.id);
    expect(restored?.body).toContain(marker);
    expect(restored?.lifecycle).toBe("fresh");
    if (action !== "redact") expect(await getLearning(other, cell.id)).toBeNull();
    await expect(reverseCaptureRuleApplication(a, applied.logIds[0], "Repeat reversal")).rejects.toMatchObject({status: 409});
    await expect(applyCaptureRule(member, rule.id, preview.token)).rejects.toMatchObject({status: 404});
  });

  it("rejects stale rule and cell previews without partial writes", async () => {
    const cell = await accepted(member, {title: "Revision preview", body: "revision-marker fact"});
    const rule = await createCaptureRule(member, ruleInput({pattern: "revision-marker"}));
    const staleRule = await previewCaptureRule(member, rule.id);
    await updateCaptureRule(member, rule.id, ruleInput({pattern: "revision-marker", name: "Edited"}));
    await expect(applyCaptureRule(member, rule.id, staleRule.token)).rejects.toMatchObject({status: 409});
    const staleCell = await previewCaptureRule(member, rule.id);
    await getSql()`UPDATE learnings SET body = 'A changed body' WHERE id = ${cell.id} AND team_id = ${a.teamId}`;
    await expect(applyCaptureRule(member, rule.id, staleCell.token)).rejects.toMatchObject({status: 409});
    expect((await getLearning(member, cell.id))?.lifecycle).toBe("fresh");
  });

  it("pages past 500 nonmatching cells", async () => {
    const sql = getSql();
    const prefix = newId("x").slice(2, 5);
    const rows = Array.from({length: 501}, (_, index) => ({id: `lrn_${prefix}${index.toString(2).padStart(9, "0").replaceAll("0", "a").replaceAll("1", "b")}`, team_id: b.teamId, member_id: b.memberId, title: "Unmatched batch", body: index === 500 ? "later-match" : "No match", kind: "learning", source: "manual", confidence: 0.7}));
    await sql`INSERT INTO learnings ${sql(rows)} ON CONFLICT (id) DO NOTHING`;
    const rule = await createCaptureRule(b, ruleInput({pattern: "later-match"}));
    const first = await previewCaptureRule(b, rule.id);
    expect(first).toMatchObject({count: 0, scanned: 500, truncated: true});
    expect(first.nextCursor).toBeTruthy();
    const second = await previewCaptureRule(b, rule.id, first.nextCursor!);
    expect(second).toMatchObject({count: 1, scanned: 1, truncated: false});
    expect((await applyCaptureRule(b, rule.id, second.token)).applied).toBe(1);
  });

  it("makes one proposal tool call without forced tool choice or invented owner context", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "fixture");
    models.create.mockResolvedValue({model: "claude-sonnet-5-5", usage: {}, content: [{type: "tool_use", name: "propose_rule", id: "fixture", input: {rule: ruleInput({kind: "repo_owner", owners: ["team"], mode: "only_allow"}), restatement: "Only save work from team repositories.", question: null}}]});
    const proposed = await proposeRuleFromText(a.teamId, a.memberId, "Only save team repos");
    expect(proposed.rule).toMatchObject({kind: "repo_owner", owners: ["team"], naturalText: "Only save team repos"});
    expect(models.create).toHaveBeenCalledTimes(1);
    expect(models.create.mock.calls[0][0].tool_choice).toBeUndefined();
    expect(models.create.mock.calls[0][0].tools).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it("proposes an unambiguous work allow list when the model excludes personal repo owners", async () => {
    await accepted(member, {title: "Work repo context", body: "A work fixture.", repo: "team/widget"});
    await accepted(member, {title: "Personal repo context", body: "A personal fixture.", repo: "personal/scratch"});
    await accepted(member, {title: "Bare repo name", body: "An ownerless fixture.", repo: "scratch"});
    vi.stubEnv("ANTHROPIC_API_KEY", "fixture");
    models.create.mockResolvedValue({model: "claude-sonnet-5-5", usage: {}, content: [{type: "tool_use", name: "propose_rule", id: "fixture", input: {rule: ruleInput({kind: "repo_owner", owners: ["personal"], mode: "deny"}), restatement: "Drop personal repositories.", question: null}}]});
    const proposed = await proposeRuleFromText(member.teamId, member.memberId, "don't include anything from my personal repos on gh");
    expect(proposed.rule).toMatchObject({kind: "repo_owner", owners: ["team"], mode: "only_allow", scope: "member"});
    expect(proposed.question).toBeNull();
    expect(proposed.restatement).toContain("team");
    expect(models.create).toHaveBeenCalledTimes(1);
    expect(await listCaptureRules(member)).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});
