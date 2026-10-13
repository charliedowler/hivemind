import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {captureRuleInputSchema, type HiveContext} from "@hivemind/core";
import {createTeam, joinTeam} from "./auth";
import {getSql} from "./db/client";
import {newId} from "./db/ids";
import * as captureRules from "./capture-rules";
import {decideCaptureRuleInstruction, runCaptureRuleInstructionJob, runPendingCaptureRuleInstructions, setCaptureRuleFromText, undoCaptureRuleInstruction, type CaptureRuleInstructionContext} from "./capture-rule-instructions";
import {originFor, withOrigin, type EventRow} from "./analytics/events";

const models = vi.hoisted(() => ({create: vi.fn(), systemOne: vi.fn(), jevOptions: vi.fn(), proposalOptions: vi.fn(), after: vi.fn()}));
vi.mock("@anthropic-ai/sdk", () => ({default: class {constructor(options: unknown) {models.proposalOptions(options);} messages = {create: models.create};}}));
vi.mock("@typesafe-ai/sdk", () => ({TypeSafeClient: class {constructor(options: unknown) {models.jevOptions(options);} systemOne = models.systemOne;}, noul: (instructions: string) => ({type: "noul", instructions})}));
vi.mock("next/server", () => ({after: models.after}));
vi.mock("./classify", () => ({jevModel: "jev-1.13.0"}));
vi.mock("./capture-categories", () => ({classifyCaptureCategories: vi.fn(async (_input: unknown, categories: string[]) => Object.fromEntries(categories.map(category => [category, true])))}));
vi.mock("./knowledge-tree", () => ({scheduleKnowledge: vi.fn()}));

const judgement = {clearInstruction: true, requiredDetails: true, allowedScope: true};
const answers = (values = [1, 1, 1]) => Object.fromEntries(Object.keys(judgement).map((key, index) => [key, {type: "noul", noul: values[index]}]));
const input = (extra: Record<string, unknown> = {}) => captureRuleInputSchema.parse({name: "Private marker", kind: "keyword", pattern: "private-marker", action: "drop", scope: "member", source: "mcp", naturalText: "Model provenance", ...extra});
const proposal = (rule: unknown = input(), extra: Record<string, unknown> = {}) => ({model: "claude-sonnet-5-5", usage: {}, content: [{type: "tool_use", name: "propose_rule", id: "fixture", input: {rule, restatement: "Exclude captures with private-marker.", question: null, judgement, ...extra}}]});
const web = {source: "web" as const};
const slack = {source: "slack" as const, channelId: "C_CAPTURE", threadTs: "1800000000.001", messageTs: "1800000000.003"};

describe("capture instruction pure decision", () => {
  it.each([[answers(), "save"], [answers([0, 1, 1]), "question"], [answers([1, 0, 1]), "question"], [answers([1, 1, 0]), "question"], [answers([0.5, 1, 1]), "fallback"], [answers([1, 0.89, 1]), "fallback"], [null, "fallback"], [answers([NaN, 1, 1]), "fallback"]])("decides from validated independent probabilities", (value, expected) => {
    expect(decideCaptureRuleInstruction(value)).toBe(expected);
  });
});

const enabled = process.env.DATABASE_URL?.startsWith("postgres://hivemind:hivemind@127.0.0.1:54329/hive_capture_rules_");
describe.skipIf(!enabled)("direct capture instructions", {timeout: 60000}, () => {
  let admin: HiveContext, member: HiveContext, other: HiveContext, elsewhere: HiveContext;
  const teams: string[] = [];
  const save = (ctx = member, context: CaptureRuleInstructionContext = web) => setCaptureRuleFromText(ctx, "Do not save private-marker", context);
  const audits = () => getSql()`SELECT * FROM capture_rule_instructions WHERE team_id = ${member.teamId} ORDER BY created_at, id`;
  const actions = () => getSql()`SELECT * FROM slack_tool_actions WHERE team_id = ${member.teamId} ORDER BY created_at, id`;
  const slackUndo = {source: slack.source, channelId: slack.channelId, threadTs: slack.threadTs};
  const cell = async (ctx = member, extra: Record<string, unknown> = {}) => {
    const id = newId("lrn");
    const data = {id, team_id: ctx.teamId, member_id: ctx.memberId, title: "Private marker fixture", body: "A finding with private-marker.", kind: "learning", source: "manual", confidence: 1, ...extra};
    await getSql()`INSERT INTO learnings ${getSql()(data)}`;
    return id;
  };
  const read = async (id: string) => (await getSql()`SELECT * FROM learnings WHERE id = ${id}`)[0];
  const drain = async () => {
    for (let i = 0; i < 20; i++) {
      const result = await runPendingCaptureRuleInstructions();
      if (!result.pending) return result;
    }
    throw new Error("Fixture job did not finish within bounded rounds");
  };

  beforeAll(async () => {
    const first = await createTeam({teamName: "Work", memberName: "Admin"});
    admin = first.ctx;
    member = (await joinTeam({inviteCode: first.inviteCode, memberName: "Owner"}))!.ctx;
    other = (await joinTeam({inviteCode: first.inviteCode, memberName: "Other"}))!.ctx;
    elsewhere = (await createTeam({teamName: "Elsewhere", memberName: "Other admin"})).ctx;
    teams.push(admin.teamId, elsewhere.teamId);
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("ANTHROPIC_API_KEY", "fixture");
    vi.stubEnv("TYPESAFE_API_KEY", "fixture");
    models.create.mockResolvedValue(proposal());
    models.systemOne.mockResolvedValue({model: "jev-1.13.0", answers: answers()});
    models.after.mockImplementation(() => {throw new Error("No request context in test");});
    await getSql()`UPDATE members SET removed_at = NULL, role = CASE WHEN id = ${admin.memberId} THEN 'admin' ELSE 'member' END WHERE team_id = ${admin.teamId}`;
    for (const table of ["slack_tool_actions", "capture_rule_applications", "capture_rule_previews", "capture_rule_instructions", "capture_rules", "learning_evidence", "learning_pushes", "learnings"])
      await getSql()`DELETE FROM ${getSql()(table)} WHERE team_id = ANY(${teams}::text[])`;
  });
  afterEach(() => {vi.unstubAllEnvs(); vi.restoreAllMocks();});
  afterAll(async () => {
    const sql = getSql();
    for (const table of ["slack_tool_actions", "capture_rule_applications", "capture_rule_previews", "capture_rule_instructions", "capture_rules", "learning_evidence", "learning_pushes", "learnings", "api_keys", "web_sessions", "members", "teams"]) {
      if (table === "teams") await sql`DELETE FROM teams WHERE id = ANY(${teams}::text[])`;
      else await sql`DELETE FROM ${sql(table)} WHERE team_id = ANY(${teams}::text[])`;
    }
    await sql.end();
  });

  it("immediately saves a clear instruction, auto applies and audits content-free decision joins", async () => {
    const id = await cell();
    const rows: EventRow[] = [];
    const result = await withOrigin(originFor(member, "web", "web_session"), () => save(), async row => {rows.push(row);});
    expect(result).toMatchObject({status: "saved", rule: {memberId: member.memberId, createdBy: member.memberId, source: "web", naturalText: "Do not save private-marker"}, counts: {scanned: 1, matched: 1, applied: 1, skipped: 0, pending: false, stopped: false}});
    expect(new Date(result.undoUntil!).getTime() - Date.now()).toBeGreaterThan(3590000);
    expect((await read(id)).lifecycle).toBe("retracted");
    const [audit] = await audits();
    expect(audit.decision).toEqual({...judgement, engine: "jev"});
    expect(audit).toMatchObject({outcome: "saved", job_status: "complete", rule_id: result.rule!.id});
    expect(models.create).toHaveBeenCalledTimes(1);
    expect(models.systemOne).toHaveBeenCalledTimes(1);
    expect(models.jevOptions).toHaveBeenCalledWith({timeout: 500, retry: {maxRetries: 0}, logLevel: "off"});
    expect(models.proposalOptions).toHaveBeenCalledWith({timeout: 15000, maxRetries: 0});
    expect(models.create.mock.calls[0][0]).not.toHaveProperty("tool_choice");
    const decision = rows.find(row => row.event_name === "capture.rule_instruction_decided")!;
    expect(decision.properties).toMatchObject({captureInstructionId: audit.id, ruleId: result.rule!.id, instructionClear: true, instructionSpecific: true, instructionScopeAllowed: true, instructionSource: "web", instructionDecision: "save"});
    expect(JSON.stringify(rows)).not.toContain("private-marker");
    expect((await getSql()`SELECT to_regclass('capture_rule_proposals') AS name`)[0].name).toBeNull();
  });

  it("saves a bound generic Slack pointer with the private audit and server source provenance", async () => {
    await cell();
    const saved = await save(member, slack);
    const [audit] = await audits();
    const [pointer] = await actions();
    expect(audit).toMatchObject({source: "slack", channel_id: slack.channelId, thread_ts: slack.threadTs, decision: {messageTs: slack.messageTs}, rule_id: saved.rule!.id});
    expect(saved.rule).toMatchObject({source: "slack", naturalText: "Do not save private-marker"});
    expect(pointer).toMatchObject({team_id: member.teamId, member_id: member.memberId, channel_id: slack.channelId, thread_ts: slack.threadTs, message_ts: slack.messageTs, tool_name: "hive_set_capture_rule", inverse: {kind: "capture_instruction", reversible: true, payload: {instructionId: audit.id}}, reply: "Saved your capture rule.", undone_at: null});
    expect(pointer.created_at).toEqual(audit.created_at);
    expect(pointer.expires_at).toEqual(audit.undo_until);
    expect(new Date(pointer.expires_at).getTime() - new Date(pointer.created_at).getTime()).toBeGreaterThan(3590000);
    expect(JSON.stringify(pointer)).not.toMatch(/private-marker|crule_|natural_text|restatement/);
    expect(pointer.reply).not.toMatch(/Done|undo/i);
    const columns = await getSql()`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'slack_tool_actions'`;
    expect(columns.map(column => column.column_name)).not.toContain("payload");
    expect(columns.map(column => column.column_name)).not.toContain("reversible");
  });

  it("rolls back the actual SQL rule and audit when the generic pointer unique insert fails", async () => {
    const id = await cell();
    const insert = captureRules.insertCaptureRule;
    vi.spyOn(captureRules, "insertCaptureRule").mockImplementationOnce(async (tx, ctx, rule) => {
      const saved = await insert(tx, ctx, rule);
      await tx`INSERT INTO slack_tool_actions (id, team_id, member_id, channel_id, thread_ts, message_ts, tool_name, inverse, reply) VALUES (${newId("sact")}, ${ctx.teamId}, ${ctx.memberId}, ${slack.channelId}, ${slack.threadTs}, ${slack.messageTs}, 'fixture_collision', '{}'::jsonb, 'Fixture')`;
      return saved;
    });
    await expect(save(member, slack)).rejects.toMatchObject({code: "23505", table_name: "slack_tool_actions"});
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
    expect(await actions()).toHaveLength(0);
    expect((await read(id)).lifecycle).toBe("fresh");
    expect(await getSql()`SELECT id FROM capture_rule_applications WHERE team_id = ${member.teamId}`).toHaveLength(0);
    expect((await save(member, slack)).status).toBe("saved");
  });

  it("replays the saved snapshot and committed counts without another model call or audit", async () => {
    await cell();
    const saved = await save(member, slack);
    await captureRules.updateCaptureRule(member, saved.rule!.id, input({pattern: "later-marker"}));
    const replay = await setCaptureRuleFromText(member, "An edited delivery must not create another rule", slack);
    expect(replay).toEqual(saved);
    expect(await audits()).toHaveLength(1);
    expect(await actions()).toHaveLength(1);
    expect(await captureRules.effectiveRules(member)).toHaveLength(1);
    expect(models.systemOne).toHaveBeenCalledTimes(1);
    expect(models.create).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping deliveries before model work and writes only one rule, audit and pointer", async () => {
    await cell();
    const results = await Promise.all([save(member, slack), save(member, slack), save(member, slack), save(member, slack)]);
    expect(results.every(result => result.rule!.id === results[0].rule!.id)).toBe(true);
    expect(results.every(result => result.counts!.applied === 1)).toBe(true);
    expect(await audits()).toHaveLength(1);
    expect(await actions()).toHaveLength(1);
    expect(await captureRules.effectiveRules(member)).toHaveLength(1);
    expect(models.systemOne).toHaveBeenCalledTimes(1);
    expect(models.create).toHaveBeenCalledTimes(1);
  });

  it("deduplicates a Slack question audit without inventing a reversible action", async () => {
    models.create.mockResolvedValue(proposal(null, {question: "Which repositories?", judgement: {...judgement, requiredDetails: false}}));
    const question = await save(member, slack);
    expect(question.status).toBe("question");
    expect(await save(member, slack)).toEqual(question);
    expect(await audits()).toHaveLength(1);
    expect(await actions()).toHaveLength(0);
    expect(models.systemOne).toHaveBeenCalledTimes(1);
    expect(models.create).toHaveBeenCalledTimes(1);
    await expect(save(other, slack)).rejects.toMatchObject({status: 409});
    await expect(save(member, {...slack, threadTs: "1800000000.099"})).rejects.toMatchObject({status: 409});
    expect(await audits()).toHaveLength(1);
    expect(models.create).toHaveBeenCalledTimes(1);
  });

  it.each(["actor", "thread", "tool", "pointer", "source", "receipt"])("refuses a saved Slack replay with a conflicting %s before model work", async mismatch => {
    await save(member, slack);
    if (mismatch === "tool") await getSql()`UPDATE slack_tool_actions SET tool_name = 'hive_pause_digest' WHERE team_id = ${member.teamId}`;
    if (mismatch === "pointer") await getSql()`UPDATE slack_tool_actions SET inverse = '{"kind":"capture_instruction","reversible":true,"payload":{"instructionId":"cinstr_missing"}}'::jsonb WHERE team_id = ${member.teamId}`;
    if (mismatch === "source") {
      await save();
      const webAudit = (await audits()).find(audit => audit.source === "web")!;
      await getSql()`UPDATE slack_tool_actions SET inverse = ${getSql().json({kind: "capture_instruction", reversible: true, payload: {instructionId: webAudit.id}})} WHERE team_id = ${member.teamId}`;
    }
    if (mismatch === "receipt") await getSql()`UPDATE capture_rule_instructions SET decision = decision || '{"messageTs":"1800000000.999"}'::jsonb WHERE team_id = ${member.teamId}`;
    const before = await audits();
    const callCount = models.create.mock.calls.length;
    const person = mismatch === "actor" ? other : member;
    const context = mismatch === "thread" ? {...slack, threadTs: "1800000000.099"} : slack;
    await expect(save(person, context)).rejects.toMatchObject({status: mismatch === "actor" ? 403 : 409});
    expect(await audits()).toEqual(before);
    expect(models.create).toHaveBeenCalledTimes(callCount);
    expect(models.systemOne).toHaveBeenCalledTimes(callCount);
  });

  it("rechecks a conflicting generic action created while model work is in flight without capture writes", async () => {
    models.create.mockImplementationOnce(async () => {
      await getSql()`INSERT INTO slack_tool_actions (id, team_id, member_id, channel_id, thread_ts, message_ts, tool_name, inverse, reply) VALUES (${newId("sact")}, ${member.teamId}, ${other.memberId}, ${slack.channelId}, ${slack.threadTs}, ${slack.messageTs}, 'hive_pause_digest', '{}'::jsonb, 'Fixture')`;
      return proposal();
    });
    await expect(save(member, slack)).rejects.toMatchObject({status: 403});
    expect(await audits()).toHaveLength(0);
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
    expect(await actions()).toHaveLength(1);
  });

  it("returns a concurrently committed authorized receipt from the transaction recheck without duplicate writes", async () => {
    models.create.mockImplementationOnce(async () => {
      await getSql().begin(async tx => {
        const rule = await captureRules.insertCaptureRule(tx, member, input({source: "slack", action: "flag"}));
        const id = newId("cinstr");
        const [audit] = await tx`INSERT INTO capture_rule_instructions (id, team_id, member_id, source, channel_id, thread_ts, decision, outcome, rule_id, rule_revision, rule_snapshot, restatement, natural_text, undo_until) VALUES (${id}, ${member.teamId}, ${member.memberId}, 'slack', ${slack.channelId}, ${slack.threadTs}, ${tx.json({...judgement, messageTs: slack.messageTs})}, 'saved', ${rule.id}, 1, ${tx.json(rule)}, 'Keep matching captures private.', 'Concurrent receipt fixture', clock_timestamp() + interval '1 hour') RETURNING *`;
        await tx`INSERT INTO slack_tool_actions (id, team_id, member_id, channel_id, thread_ts, message_ts, tool_name, inverse, reply, expires_at) VALUES (${newId("sact")}, ${member.teamId}, ${member.memberId}, ${slack.channelId}, ${slack.threadTs}, ${slack.messageTs}, 'hive_set_capture_rule', ${tx.json({kind: "capture_instruction", reversible: true, payload: {instructionId: id}})}, 'Saved your capture rule.', ${audit.undo_until})`;
      });
      return proposal();
    });
    const result = await save(member, slack);
    expect(result).toMatchObject({status: "saved", rule: {action: "flag"}, restatement: "Keep matching captures private.", counts: {scanned: 0, applied: 0, pending: false}});
    expect(await audits()).toHaveLength(1);
    expect(await actions()).toHaveLength(1);
    expect(await captureRules.effectiveRules(member)).toHaveLength(1);
    expect(models.create).toHaveBeenCalledTimes(1);
  });

  it("rechecks current membership and current team-admin scope before exposing a replay", async () => {
    models.create.mockResolvedValue(proposal(input({scope: "team"})));
    await save(admin, slack);
    await getSql()`UPDATE members SET role = 'member' WHERE id = ${admin.memberId}`;
    await expect(save(admin, slack)).rejects.toMatchObject({status: 403});
    await getSql()`UPDATE members SET role = 'admin', removed_at = now() WHERE id = ${admin.memberId}`;
    await expect(save(admin, slack)).rejects.toMatchObject({status: 404});
    expect(models.create).toHaveBeenCalledTimes(1);
    expect(await audits()).toHaveLength(1);
    expect(await actions()).toHaveLength(1);
  });

  it("does not create generic actions for web or MCP instructions", async () => {
    await save();
    await save(member, {source: "mcp"});
    expect(await actions()).toHaveLength(0);
    expect((await audits()).map(audit => audit.source)).toEqual(["web", "mcp"]);
  });

  it.each(["Maybe stop saving private-marker", "Should Hive exclude private-marker?"])("does not save tentative or question text even if the proposal model says yes: %s", async text => {
    models.systemOne.mockResolvedValue({answers: answers([0, 1, 1])});
    const result = await setCaptureRuleFromText(member, text, web);
    expect(result.status).toBe("question");
    expect(result.question).toBe("Which exact capture rule should Hive add?");
    expect(await captureRules.effectiveRules(member)).toEqual([]);
    expect((await audits())[0].decision.clearInstruction).toBe(false);
  });

  it("asks exactly one genuinely missing detail and saves only after receiving the original request and answer", async () => {
    models.create.mockResolvedValue(proposal(null, {question: "Which repositories? What action?", judgement: {...judgement, requiredDetails: false}}));
    const first = await setCaptureRuleFromText(member, "Exclude these repos", web);
    expect(first.question).toBe("Which repositories?");
    expect(first.status).toBe("question");
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
    models.create.mockResolvedValue(proposal(input({kind: "repo_match", pattern: "work/private"})));
    expect((await setCaptureRuleFromText(member, "Exclude these repos\nRequired detail: work/private", web)).status).toBe("saved");
  });

  it("never adds a confirmation step to a complete instruction", async () => {
    models.create.mockResolvedValue(proposal(input(), {question: "Confirm this rule?"}));
    expect((await save()).status).toBe("saved");
  });

  it.each(["uncertain", "timeout", "unconfigured"])("uses the one proposal call's independent structured judgement on Jev %s", async failure => {
    if (failure === "timeout") models.systemOne.mockRejectedValue(new Error("Timeout"));
    else if (failure === "unconfigured") vi.stubEnv("TYPESAFE_API_KEY", "");
    else models.systemOne.mockResolvedValue({answers: answers([0.5, 1, 1])});
    expect((await save()).status).toBe("saved");
    expect(models.create).toHaveBeenCalledTimes(1);
    expect((await audits())[0].decision.engine).toBe("proposal");
  });

  it("does not accept model decisiveness inferred from a typed rule alone on fallback", async () => {
    models.systemOne.mockRejectedValue(new Error("Timeout"));
    models.create.mockResolvedValue(proposal(input(), {judgement: undefined}));
    expect((await save()).status).toBe("question");
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
  });

  it("honours the fallback model's own tentative judgement", async () => {
    models.systemOne.mockRejectedValue(new Error("Timeout"));
    models.create.mockResolvedValue(proposal(input(), {judgement: {...judgement, clearInstruction: false}}));
    expect((await save()).status).toBe("question");
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
  });

  it.each(["failed", "malformed", "multiple"])("does not save an unavailable or malformed model proposal: %s", async failure => {
    if (failure === "failed") models.create.mockRejectedValue(new Error("Provider failure"));
    else if (failure === "malformed") models.create.mockResolvedValue({content: [{type: "text", text: "Saved"}]});
    else models.create.mockResolvedValue({...proposal(), content: [...proposal().content, ...proposal().content]});
    expect((await save()).status).toBe("question");
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
    expect(models.create).toHaveBeenCalledTimes(1);
  });

  it("redacts secrets in audit and provenance and preserves the durable audit if analytics fail", async () => {
    const request = "Do not save private-marker sk-ant-api03-" + "A".repeat(100);
    const result = await withOrigin(originFor(member), () => setCaptureRuleFromText(member, request, web), async () => {throw new Error("Analytics offline");});
    expect(result.status).toBe("saved");
    expect((await audits())[0].outcome).toBe("saved");
    expect(JSON.stringify(await audits())).not.toContain("A".repeat(100));
    expect(result.rule!.naturalText).not.toContain("A".repeat(100));
  });

  it("uses known repos in Jev, does not invent owners from bare names, and accepts one known work organisation", async () => {
    await cell(member, {repo: "personal/scratch"});
    await cell(member, {repo: "work/repo"});
    await cell(member, {repo: "billing-cutoff"});
    await cell(other, {repo: "hidden/repo", capture_flagged: true});
    await cell(elsewhere, {repo: "outside/repo"});
    models.create.mockResolvedValue(proposal(input({kind: "repo_owner", owners: ["work"], mode: "only_allow"})));
    const result = await setCaptureRuleFromText(member, "don't include anything from my personal repos on gh", web);
    expect(result).toMatchObject({status: "saved", rule: {kind: "repo_owner", owners: ["work"], mode: "only_allow"}});
    expect(models.systemOne.mock.calls[0][0].state.knownRepos).toEqual(["billing-cutoff", "personal/scratch", "work/repo"]);
    expect(models.create.mock.calls[0][0].system).not.toContain("confirm that list");
  });

  it("converts a personal-owner deny proposal to an unambiguous known work allow list", async () => {
    await cell(member, {repo: "personal/scratch"});
    await cell(member, {repo: "work/repo"});
    models.create.mockResolvedValue(proposal(input({kind: "repo_owner", owners: ["personal"], mode: "deny"})));
    expect(await setCaptureRuleFromText(member, "Exclude my personal repos", web)).toMatchObject({status: "saved", rule: {owners: ["work"], mode: "only_allow"}});
  });

  it("asks one work-org detail when several possible work organisations remain", async () => {
    for (const repo of ["personal/scratch", "work-a/repo", "work-b/repo"]) await cell(member, {repo});
    models.create.mockResolvedValue(proposal(input({kind: "repo_owner", owners: ["personal"], mode: "deny"})));
    const result = await setCaptureRuleFromText(member, "Exclude my personal repos", web);
    expect(result).toMatchObject({status: "question", question: "Which work organisations should Hive keep captures from?"});
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
  });

  it("rejects removed membership and rechecks an admin downgrade during model work", async () => {
    await getSql()`UPDATE members SET removed_at = now() WHERE id = ${member.memberId}`;
    await expect(save()).rejects.toMatchObject({status: 404});
    expect(models.create).not.toHaveBeenCalled();
    models.create.mockImplementation(async () => {
      await getSql()`UPDATE members SET role = 'member' WHERE id = ${admin.memberId}`;
      return proposal(input({scope: "team"}));
    });
    await expect(save(admin)).rejects.toMatchObject({status: 403});
    expect(await audits()).toHaveLength(0);
    expect(await captureRules.effectiveRules(admin)).toHaveLength(0);
  });

  it("does not trust AI or caller admin booleans to authorize team rules", async () => {
    models.create.mockResolvedValue(proposal(input({scope: "team"})));
    const result = await save({...member, isAdmin: true} as HiveContext);
    expect(result.status).toBe("question");
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
    expect(JSON.parse(models.create.mock.calls[0][0].messages[0].content).admin).toBe(false);
  });

  it("rechecks membership removed while the proposal is in flight", async () => {
    models.create.mockImplementation(async () => {
      await getSql()`UPDATE members SET removed_at = now() WHERE id = ${member.memberId}`;
      return proposal();
    });
    await expect(save()).rejects.toMatchObject({status: 404});
    expect(await getSql()`SELECT id FROM capture_rules WHERE team_id = ${member.teamId}`).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it.each(["drop", "redact"])("auto applies %s to own captures and undo restores without an admin", async action => {
    const id = await cell();
    const otherId = await cell(other);
    models.create.mockResolvedValue(proposal(input({action})));
    const result = await save();
    expect(result.counts!.applied).toBe(1);
    expect((await read(otherId)).capture_rule_ids).toEqual([]);
    const undone = await undoCaptureRuleInstruction(member, web);
    expect(undone).toMatchObject({status: "undone", counts: {restored: 1, retained: 0, pending: false}});
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
    expect(await read(id)).toMatchObject({body: "A finding with private-marker.", capture_flagged: false, capture_redacted: false, lifecycle: "fresh", capture_rule_ids: []});
    await expect(undoCaptureRuleInstruction(member, web)).rejects.toMatchObject({status: 400});
  });

  it("keeps a member flag instruction on future captures and does not flag old own captures", async () => {
    const existing = await cell();
    models.create.mockResolvedValue(proposal(input({action: "flag"})));
    const saved = await save();
    expect(saved.counts).toMatchObject({scanned: 0, matched: 0, applied: 0, pending: false});
    expect((await read(existing)).capture_flagged).toBe(false);
    expect(await captureRules.enforceCaptureRules(member, {title: "Fixture", body: "private-marker"})).toMatchObject({action: "flag", flagged: true});
    expect((await undoCaptureRuleInstruction(member, web)).counts).toMatchObject({restored: 0, retained: 0, pending: false});
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
  });

  it("retroactively flags team captures including private captures without returning their content", async () => {
    const existing = await cell(member);
    const privateId = await cell(other, {capture_flagged: true});
    models.create.mockResolvedValue(proposal(input({scope: "team", action: "flag"})));
    const saved = await save(admin);
    expect(saved.counts).toMatchObject({scanned: 2, matched: 2, applied: 2, pending: false});
    expect((await read(existing)).capture_flagged).toBe(true);
    expect((await read(privateId)).capture_flagged).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("A finding with");
    expect((await undoCaptureRuleInstruction(admin, web)).counts!.restored).toBe(2);
    expect((await read(existing)).capture_flagged).toBe(false);
    expect((await read(privateId)).capture_flagged).toBe(true);
  });

  it("auto applies team scope to all team data including another owner's private capture, and requires a current admin for undo", async () => {
    const own = await cell(member);
    const privateId = await cell(other, {capture_flagged: true});
    const external = await cell(elsewhere);
    models.create.mockResolvedValue(proposal(input({scope: "team"})));
    const result = await save(admin);
    expect(result.counts).toMatchObject({scanned: 2, matched: 2, applied: 2});
    expect((await read(privateId)).lifecycle).toBe("retracted");
    expect((await read(external)).lifecycle).toBe("fresh");
    expect(await getSql()`SELECT id FROM capture_rule_applications WHERE team_id = ${admin.teamId}`).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("A finding with");
    await getSql()`UPDATE members SET role = 'member' WHERE id = ${admin.memberId}`;
    await expect(undoCaptureRuleInstruction(admin, web)).rejects.toMatchObject({status: 403});
    expect(await getSql()`SELECT id FROM capture_rules WHERE id = ${result.rule!.id}`).toHaveLength(1);
    expect((await read(own)).lifecycle).toBe("retracted");
    await getSql()`UPDATE members SET role = 'admin' WHERE id = ${admin.memberId}`;
    expect((await undoCaptureRuleInstruction(admin, web)).counts).toMatchObject({restored: 2, retained: 0});
    expect((await read(own)).lifecycle).toBe("fresh");
    expect(await read(privateId)).toMatchObject({lifecycle: "fresh", capture_flagged: true});
  });

  it("rechecks current team-admin authorization on every undo continuation page", async () => {
    for (let i = 0; i < 20; i++) await cell(other);
    models.create.mockResolvedValue(proposal(input({scope: "team", kind: "content_category", category: "personal_info"})));
    await save(admin);
    await drain();
    expect((await undoCaptureRuleInstruction(admin, web)).counts).toMatchObject({restored: 16, pending: true});
    await getSql()`UPDATE members SET role = 'member' WHERE id = ${admin.memberId}`;
    expect(await runPendingCaptureRuleInstructions()).toMatchObject({restored: 0, pending: 1, failed: 1});
    expect((await audits())[0].counts.restored).toBe(16);
    await getSql()`UPDATE members SET role = 'admin' WHERE id = ${admin.memberId}`;
    expect(await runPendingCaptureRuleInstructions()).toMatchObject({restored: 4, pending: 0, failed: 0});
  });

  it("uses stored team scope to authorize undo even when the rule was already deleted", async () => {
    const id = await cell(other);
    models.create.mockResolvedValue(proposal(input({scope: "team"})));
    const saved = await save(admin);
    await captureRules.deleteCaptureRule(admin, saved.rule!.id);
    await getSql()`UPDATE members SET role = 'member' WHERE id = ${admin.memberId}`;
    await expect(undoCaptureRuleInstruction(admin, web)).rejects.toMatchObject({status: 403});
    expect((await read(id)).lifecycle).toBe("retracted");
    expect((await audits())[0].undo_started_at).toBeNull();
    await getSql()`UPDATE members SET role = 'admin' WHERE id = ${admin.memberId}`;
    expect((await undoCaptureRuleInstruction(admin, web)).counts!.restored).toBe(1);
  });

  it("undo restores canonical content, historical versions, evidence and capture sidecars after redaction", async () => {
    const id = await cell(member, {repo: "work/repo", paths: ["private-marker.txt"], tags: ["private-marker"], workaround: "private-marker", session_ref: "private-marker"});
    const pushId = newId("push");
    await getSql()`INSERT INTO learning_pushes(id, learning_id, team_id, member_id, source, session_ref, merged) VALUES (${pushId}, ${id}, ${member.teamId}, ${member.memberId}, 'manual', 'private-marker', false)`;
    await getSql()`INSERT INTO learning_evidence(push_id, team_id, learning_id, payload, object_key, digest, bytes) VALUES (${pushId}, ${member.teamId}, ${id}, '{"text":"private-marker evidence"}'::jsonb, 'fixture/private-marker', 'fixture', 1)`;
    models.create.mockResolvedValue(proposal(input({action: "redact"})));
    await save();
    expect(await getSql()`SELECT * FROM learning_evidence WHERE learning_id = ${id}`).toHaveLength(0);
    expect(await read(id)).toMatchObject({repo: null, tags: [], paths: [], session_ref: null});
    expect((await undoCaptureRuleInstruction(member, web)).counts!.restored).toBe(1);
    expect(await read(id)).toMatchObject({repo: "work/repo", tags: ["private-marker"], paths: ["private-marker.txt"], session_ref: "private-marker"});
    expect((await getSql()`SELECT payload FROM learning_evidence WHERE learning_id = ${id}`)[0].payload).toEqual({text: "private-marker evidence"});
    expect((await getSql()`SELECT session_ref FROM learning_pushes WHERE id = ${pushId}`)[0].session_ref).toBe("private-marker");
    expect((await getSql()`SELECT content FROM learning_versions WHERE learning_id = ${id} AND revision = 1`)[0].content.body).toBe("A finding with private-marker.");
  });

  it("matches content in evidence sidecars during automatic retrospective application", async () => {
    const id = await cell(member, {title: "Technical fact", body: "A technical fact"});
    const pushId = newId("push");
    await getSql()`INSERT INTO learning_pushes(id, learning_id, team_id, member_id, source, merged) VALUES (${pushId}, ${id}, ${member.teamId}, ${member.memberId}, 'manual', false)`;
    await getSql()`INSERT INTO learning_evidence(push_id, team_id, learning_id, payload, object_key, digest, bytes) VALUES (${pushId}, ${member.teamId}, ${id}, '{"text":"private-marker"}'::jsonb, 'fixture', 'fixture', 1)`;
    expect((await save()).counts!.applied).toBe(1);
    expect((await read(id)).lifecycle).toBe("retracted");
  });

  it("expires undo at the database clock after one hour, including time spent waiting for the lock", async () => {
    await save();
    await getSql()`UPDATE capture_rule_instructions SET undo_until = clock_timestamp() - interval '1 second' WHERE member_id = ${member.memberId}`;
    await expect(undoCaptureRuleInstruction(member, web)).rejects.toMatchObject({status: 400});
    expect(await captureRules.effectiveRules(member)).toHaveLength(1);
    await getSql()`UPDATE capture_rule_instructions SET undo_until = clock_timestamp() + interval '150 milliseconds' WHERE member_id = ${member.memberId}`;
    const connection = await getSql().reserve();
    try {
      await connection`BEGIN`;
      await connection`SELECT pg_advisory_xact_lock(hashtext(${member.teamId}), 7291)`;
      const pending = undoCaptureRuleInstruction(member, web);
      const refusal = expect(pending).rejects.toMatchObject({status: 400});
      await connection`SELECT pg_sleep(0.3)`;
      await connection`COMMIT`;
      await refusal;
    } finally {await connection`ROLLBACK`; connection.release();}
    expect(await captureRules.effectiveRules(member)).toHaveLength(1);
  });

  it.each(["owner", "team", "source", "channel", "thread"])("binds undo to the exact %s", async mismatch => {
    await setCaptureRuleFromText(member, "Do not save private-marker", slack);
    const person = mismatch === "owner" ? other : mismatch === "team" ? elsewhere : member;
    const context = mismatch === "source" ? web : {...slack, ...(mismatch === "channel" ? {channelId: "C_OTHER"} : mismatch === "thread" ? {threadTs: "1800000000.002"} : {})};
    await expect(undoCaptureRuleInstruction(person, context)).rejects.toMatchObject({status: 400});
    expect(await captureRules.effectiveRules(member)).toHaveLength(1);
    expect((await undoCaptureRuleInstruction(member, slack)).status).toBe("undone");
  });

  it("selects only the latest matching saved instruction and does not use an older record to bypass expiry", async () => {
    const first = await save();
    models.create.mockResolvedValue(proposal(input({pattern: "second-marker"})));
    const second = await save();
    await getSql()`UPDATE capture_rule_instructions SET undo_until = clock_timestamp() - interval '1 second' WHERE rule_id = ${second.rule!.id}`;
    await expect(undoCaptureRuleInstruction(member, web)).rejects.toMatchObject({status: 400});
    expect((await captureRules.effectiveRules(member)).map(rule => rule.id).sort()).toEqual([first.rule!.id, second.rule!.id].sort());
  });

  it("dispatches the persisted exact latest pointer without an undo message timestamp and marks it undone", async () => {
    await cell();
    await save(member, slack);
    const [pointer] = await actions();
    const instructionId = pointer.inverse.payload.instructionId;
    const result = await undoCaptureRuleInstruction(member, slackUndo, instructionId);
    expect(result).toMatchObject({status: "undone", counts: {restored: 1, retained: 0, pending: false}});
    const [audit] = await audits();
    expect((await actions())[0].undone_at).toEqual(audit.undo_started_at);
    expect(await captureRules.effectiveRules(member)).toHaveLength(0);
    expect(await save(member, slack)).toMatchObject({status: "undone", counts: {restored: 1}});
    expect(await audits()).toHaveLength(1);
    expect(await actions()).toHaveLength(1);
    expect(models.create).toHaveBeenCalledTimes(1);
  });

  it.each(["older", "member", "team", "web", "channel", "thread", "missing"])("refuses a dispatched pointer aimed at a different %s instruction with no writes", async target => {
    await save(member, slack);
    const [latest] = await audits();
    let expectedInstructionId = newId("cinstr");
    if (target === "older") {
      expectedInstructionId = latest.id;
      await save(member, {...slack, messageTs: "1800000000.004"});
    } else if (target !== "missing") {
      const person = target === "member" ? other : target === "team" ? elsewhere : member;
      const context = target === "web" ? web : {...slack, ...(target === "channel" ? {channelId: "C_OTHER"} : target === "thread" ? {threadTs: "1800000000.099"} : {}), messageTs: "1800000000.004"};
      const saved = await save(person, context);
      const [audit] = await getSql()`SELECT id FROM capture_rule_instructions WHERE rule_id = ${saved.rule!.id}`;
      expectedInstructionId = audit.id;
    }
    const beforeAudits = await audits();
    const beforeActions = await actions();
    const beforeRules = await captureRules.effectiveRules(member);
    await expect(undoCaptureRuleInstruction(member, slackUndo, expectedInstructionId)).rejects.toMatchObject({status: 409});
    expect(await audits()).toEqual(beforeAudits);
    expect(await actions()).toEqual(beforeActions);
    expect(await captureRules.effectiveRules(member)).toEqual(beforeRules);
  });

  it("uses the latest capture audit's one-hour window even if the generic pointer claims a later expiry", async () => {
    await save(member, slack);
    await save(member, {...slack, messageTs: "1800000000.004"});
    const [first, latest] = await audits();
    await getSql()`UPDATE capture_rule_instructions SET undo_until = clock_timestamp() - interval '1 second' WHERE id = ${latest.id}`;
    await getSql()`UPDATE slack_tool_actions SET expires_at = clock_timestamp() + interval '1 day' WHERE team_id = ${member.teamId}`;
    await expect(undoCaptureRuleInstruction(member, slackUndo, latest.id)).rejects.toMatchObject({status: 400});
    await expect(undoCaptureRuleInstruction(member, slackUndo, first.id)).rejects.toMatchObject({status: 409});
    expect(await captureRules.effectiveRules(member)).toHaveLength(2);
    expect((await audits()).every(audit => !audit.undo_started_at)).toBe(true);
    expect((await actions()).every(action => !action.undone_at)).toBe(true);
  });

  it("does not fall through an already-undone latest instruction to an older persisted pointer", async () => {
    await save(member, slack);
    await save(member, {...slack, messageTs: "1800000000.004"});
    const [first, latest] = await audits();
    await undoCaptureRuleInstruction(member, slackUndo, latest.id);
    await expect(undoCaptureRuleInstruction(member, slackUndo, first.id)).rejects.toMatchObject({status: 409});
    await expect(undoCaptureRuleInstruction(member, slackUndo, latest.id)).rejects.toMatchObject({status: 400});
    expect(await captureRules.effectiveRules(member)).toHaveLength(1);
    expect((await audits())[0].undo_started_at).toBeNull();
  });

  it("keeps current team-admin authorization for guarded Slack undo even after the live rule was deleted", async () => {
    const id = await cell(other);
    models.create.mockResolvedValue(proposal(input({scope: "team"})));
    const saved = await save(admin, slack);
    const [pointer] = await actions();
    await captureRules.deleteCaptureRule(admin, saved.rule!.id);
    await getSql()`UPDATE members SET role = 'member' WHERE id = ${admin.memberId}`;
    await expect(undoCaptureRuleInstruction(admin, slackUndo, pointer.inverse.payload.instructionId)).rejects.toMatchObject({status: 403});
    expect((await actions())[0].undone_at).toBeNull();
    expect((await read(id)).lifecycle).toBe("retracted");
    await getSql()`UPDATE members SET role = 'admin' WHERE id = ${admin.memberId}`;
    expect((await undoCaptureRuleInstruction(admin, slackUndo, pointer.inverse.payload.instructionId)).counts!.restored).toBe(1);
  });

  it("allows only one simultaneous undo and preserves its owner authorization", async () => {
    await cell();
    await save();
    const results = await Promise.allSettled([undoCaptureRuleInstruction(member, web), undoCaptureRuleInstruction(member, web)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await audits())[0].counts.restored).toBe(1);
  });

  it("does not overwrite a later canonical edit or later evidence push", async () => {
    const edited = await cell();
    const pushed = await cell();
    await save();
    await getSql()`UPDATE learnings SET body = 'Later changed content' WHERE id = ${edited}`;
    await getSql()`UPDATE learnings SET push_count = push_count + 1 WHERE id = ${pushed}`;
    const result = await undoCaptureRuleInstruction(member, web);
    expect(result.counts).toMatchObject({restored: 0, retained: 2});
    expect((await read(edited)).body).toBe("Later changed content");
    expect((await read(pushed)).lifecycle).toBe("retracted");
  });

  it("preserves a later rule revision rather than deleting someone else's edit", async () => {
    const saved = await save();
    await captureRules.updateCaptureRule(member, saved.rule!.id, input({pattern: "later-marker"}));
    await expect(undoCaptureRuleInstruction(member, web)).rejects.toMatchObject({status: 409});
    expect((await captureRules.effectiveRules(member))[0]).toMatchObject({pattern: "later-marker"});
    expect((await audits())[0].undo_started_at).toBeNull();
  });

  it("retains privacy required by another applicable rule and restores cells unrelated to it", async () => {
    const retained = await cell(member, {body: "private-marker other-marker"});
    const restored = await cell();
    await save();
    const otherRule = await captureRules.createCaptureRule(member, input({pattern: "other-marker", action: "redact"}));
    expect((await undoCaptureRuleInstruction(member, web)).counts).toMatchObject({restored: 1, retained: 1});
    expect((await read(retained)).lifecycle).toBe("retracted");
    expect((await read(restored)).lifecycle).toBe("fresh");
    expect((await captureRules.effectiveRules(member)).map(rule => rule.id)).toEqual([otherRule.id]);
  });

  it("does not restore a dropped cell when another rule matches only its unchanged evidence", async () => {
    const id = await cell();
    const pushId = newId("push");
    await getSql()`INSERT INTO learning_pushes(id, learning_id, team_id, member_id, source, merged) VALUES (${pushId}, ${id}, ${member.teamId}, ${member.memberId}, 'manual', false)`;
    await getSql()`INSERT INTO learning_evidence(push_id, team_id, learning_id, payload, object_key, digest, bytes) VALUES (${pushId}, ${member.teamId}, ${id}, '{"text":"other-marker"}'::jsonb, 'fixture', 'fixture', 1)`;
    await save();
    await captureRules.createCaptureRule(member, input({pattern: "other-marker", action: "redact"}));
    expect((await undoCaptureRuleInstruction(member, web)).counts).toMatchObject({restored: 0, retained: 1});
    expect((await read(id)).lifecycle).toBe("retracted");
  });

  it("paginates across nonmatches, persists meaningful counts and resumes safely through the recovery runner", async () => {
    await getSql()`INSERT INTO learnings(id, team_id, member_id, title, body, kind, source, confidence) SELECT 'lrn_' || translate(lpad(i::text, 12, '0'), '0123456789', 'abcdefghij'), ${member.teamId}, ${member.memberId}, 'Fixture', CASE WHEN i = 202 THEN 'private-marker' ELSE 'Technical content' END, 'learning', 'manual', 1 FROM generate_series(1, 202) i`;
    const result = await save();
    expect(result.counts).toMatchObject({scanned: 200, matched: 0, applied: 0, pending: true});
    const newId = await cell(member, {body: "private-marker newer capture"});
    const recovered = await runPendingCaptureRuleInstructions();
    expect(recovered).toMatchObject({instructions: 1, scanned: 2, matched: 1, applied: 1, pending: 0, failed: 0});
    expect((await audits())[0].counts).toMatchObject({scanned: 202, matched: 1, applied: 1});
    expect((await read(newId)).lifecycle).toBe("fresh");
    expect(JSON.stringify(recovered)).not.toMatch(/member|team|repo|private-marker|cinstr_/);
  });

  it("bounds category pages and recovers a partially completed undo past the initiation expiry", async () => {
    for (let i = 0; i < 20; i++) await cell();
    models.create.mockResolvedValue(proposal(input({kind: "content_category", category: "personal_info"})));
    const saved = await save();
    expect(saved.counts).toMatchObject({scanned: 16, applied: 16, pending: true});
    await drain();
    expect((await audits())[0].counts.applied).toBe(20);
    const undone = await undoCaptureRuleInstruction(member, web);
    expect(undone.counts).toMatchObject({restored: 16, pending: true});
    await getSql()`UPDATE capture_rule_instructions SET undo_until = undo_started_at + interval '1 millisecond' WHERE rule_id = ${saved.rule!.id}`;
    expect((await runPendingCaptureRuleInstructions()).restored).toBe(4);
    expect((await audits())[0]).toMatchObject({job_status: "undone", counts: {restored: 20}});
  });

  it("does not duplicate applications or recovery counts when two workers race on the same cursor", async () => {
    for (let i = 0; i < 20; i++) await cell();
    models.create.mockResolvedValue(proposal(input({kind: "content_category", category: "personal_info"})));
    await save();
    const recovered = await Promise.all([runPendingCaptureRuleInstructions(), runPendingCaptureRuleInstructions()]);
    expect(recovered.reduce((sum, result) => sum + result.applied, 0)).toBe(4);
    expect((await audits())[0].counts).toMatchObject({scanned: 20, matched: 20, applied: 20});
    expect(await getSql()`SELECT id FROM capture_rule_applications WHERE team_id = ${member.teamId}`).toHaveLength(20);
  });

  it("marks rule-change interruption as stopped and does not describe it as completed", async () => {
    for (let i = 0; i < 20; i++) await cell();
    models.create.mockResolvedValue(proposal(input({kind: "content_category", category: "personal_info"})));
    const saved = await save();
    await captureRules.updateCaptureRule(member, saved.rule!.id, input({enabled: false}));
    const [audit] = await audits();
    await expect(runCaptureRuleInstructionJob(member, audit.id)).rejects.toMatchObject({status: 409});
    expect((await audits())[0].job_status).toBe("stopped");
    expect((await audits())[0].counts.applied).toBe(16);
  });

  it("skips cells edited between scan and automatic change while advancing counts and cursor", async () => {
    const id = await cell();
    const apply = captureRules.applyInstructionCells;
    vi.spyOn(captureRules, "applyInstructionCells").mockImplementationOnce(async (...args) => {
      await getSql()`UPDATE learnings SET body = 'Later body' WHERE id = ${id}`;
      return apply(...args);
    });
    const saved = await save();
    expect(saved.counts).toMatchObject({scanned: 1, matched: 1, applied: 0, skipped: 1, pending: false});
    expect((await read(id)).body).toBe("Later body");
  });

  it("refuses an instruction owner removed before undo or job recovery", async () => {
    await save();
    await getSql()`UPDATE members SET removed_at = now() WHERE id = ${member.memberId}`;
    await expect(undoCaptureRuleInstruction(member, web)).rejects.toMatchObject({status: 404});
    expect(await getSql()`SELECT id FROM capture_rules WHERE team_id = ${member.teamId}`).toHaveLength(1);
  });

  it("validates source context and request without model work", async () => {
    for (const context of [{source: "slack"}, {...slack, messageTs: undefined}, {...slack, messageTs: "bad"}, {...slack, threadTs: "bad"}, {...web, channelId: "C_FORGED"}, {...web, messageTs: slack.messageTs}, {...slack, payload: {instructionId: "forged"}}])
      await expect(setCaptureRuleFromText(member, "Exclude private-marker", context as typeof web)).rejects.toMatchObject({status: 400});
    await expect(setCaptureRuleFromText(member, " ", web)).rejects.toMatchObject({status: 400});
    expect(models.create).not.toHaveBeenCalled();
    expect(models.systemOne).not.toHaveBeenCalled();
  });
});
