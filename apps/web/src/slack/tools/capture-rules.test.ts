import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { captureRuleInputSchema, type CaptureRule } from "@hivemind/core";
import { captureRuleTools } from "./capture-rules";
import { dispatchSlackAction, slackTools, type SlackToolContext } from "./index";
import { respondToSlack } from "../respond";

const { set, undo, effective, sql, route, createRule } = vi.hoisted(() => ({
  set: vi.fn(),
  undo: vi.fn(),
  effective: vi.fn(),
  sql: vi.fn(),
  route: vi.fn(),
  createRule: vi.fn(),
}));

vi.mock("../../server/capture-rule-instructions", () => ({
  setCaptureRuleFromText: set,
  undoCaptureRuleInstruction: undo,
}));
vi.mock("@/server/capture-rules", () => ({
  effectiveRules: effective,
  createCaptureRule: createRule,
}));
vi.mock("@/server/db/client", () => ({ getSql: () => sql }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function () {
    return { messages: { create: route } };
  }),
}));

const ctx: SlackToolContext = {
  teamId: "team_fixture",
  memberId: "member_fixture",
  isAdmin: false,
  channelId: "C_FIXTURE",
  threadTs: "1800000000.001",
};
const member = { teamId: ctx.teamId, memberId: ctx.memberId, memberName: "Member fixture", teamName: "Team fixture" };
const location = { source: "slack", channelId: ctx.channelId, threadTs: ctx.threadTs };
const setTool = captureRuleTools.find(tool => tool.name === "hive_set_capture_rule")!;
const listTool = captureRuleTools.find(tool => tool.name === "hive_list_capture_rules")!;

function rule(fields: Record<string, unknown> = {}): CaptureRule {
  return {
    ...captureRuleInputSchema.parse({
      name: "Private capture rule name",
      kind: "path_match",
      action: "drop",
      pattern: "/private/owner/documents/**",
      scope: "member",
      ...fields,
    }),
    id: "crule_fixture",
    teamId: ctx.teamId,
    memberId: ctx.memberId,
    createdBy: ctx.memberId,
    createdAt: "2026-10-13T10:00:00.000Z",
    updatedAt: "2026-10-13T10:00:00.000Z",
  };
}

const counts = { scanned: 12, matched: 3, applied: 2, skipped: 1, restored: 0, retained: 0, pending: false };
function saved(fields: Record<string, unknown> = {}) {
  return {
    status: "saved",
    rule: rule(),
    restatement: "I will exclude captures from /private/owner/documents for you.",
    counts,
    undoUntil: "2026-10-13T11:00:00.000Z",
    ...fields,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  sql.mockResolvedValue([{name: member.memberName, team_name: member.teamName}]);
  set.mockResolvedValue(saved());
  undo.mockResolvedValue({status: "undone", rule: rule(), restatement: "Removed the rule for /private/owner/documents.", counts: {...counts, restored: 2, retained: 1}});
  effective.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("Slack direct capture instructions", () => {
  it("registers one set tool and one unchanged list tool with strict schemas", () => {
    expect(slackTools.filter(tool => tool.name === setTool.name)).toEqual([setTool]);
    expect(slackTools.filter(tool => tool.name === listTool.name)).toEqual([listTool]);
    expect(setTool.input_schema).toMatchObject({required: ["text"], additionalProperties: false});
    expect(listTool.input_schema).toMatchObject({additionalProperties: false});
    expect(setTool.description).toContain("immediately");
    expect(setTool.description).toContain("undo");
    expect(setTool.description).toContain("reconstruct the original instruction");
    expect(setTool.description).toContain("\nRequired detail: ");
    expect(setTool.description).toContain("never just the answer");
    expect(setTool.description).not.toMatch(/confirm|proposal|press/i);
  });

  it("saves directly once with server provenance and no buttons or confirmation action", async () => {
    const result = await setTool.handler(ctx, {text: "  Exclude my private documents  "});
    expect(set).toHaveBeenCalledExactlyOnceWith(member, "Exclude my private documents", location);
    expect(undo).not.toHaveBeenCalled();
    expect(createRule).not.toHaveBeenCalled();
    expect(result.text).toBe("Done. Hive now skips memories from matching paths for you. Checked 12 existing captures: 3 matched, 2 updated and 1 skipped because they changed.");
    expect(result.blocks?.every(block => block.type === "section")).toBe(true);
    expect(JSON.stringify(result.blocks)).not.toMatch(/button|actions|confirm|proposal/);
    expect(setTool.handleAction).toBeUndefined();
    await expect(dispatchSlackAction(ctx, "tool:hive_set_capture_rule:confirm", "old-reference")).rejects.toThrow("unavailable");
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("routes a full instruction through the registry without a second create or model reply", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic");
    route.mockResolvedValue({stop_reason: "tool_use", content: [{type: "tool_use", name: setTool.name, input: {text: "Exclude my private documents"}}]});
    const result = await respondToSlack(ctx, "Exclude my private documents", ctx.threadTs, []);
    expect(result.text).not.toContain("Reply undo to remove it.");
    expect(route).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledExactlyOnceWith(member, "Exclude my private documents", location);
    expect(createRule).not.toHaveBeenCalled();
    expect(route.mock.calls[0][0].tools.find((tool: {name: string}) => tool.name === setTool.name)).toMatchObject({input_schema: setTool.input_schema});
  });

  it("refuses ambiguous multiple routed mutations before executing a save", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic");
    route.mockResolvedValue({stop_reason: "tool_use", content: [
      {type: "tool_use", name: setTool.name, input: {text: "Exclude private documents"}},
      {type: "tool_use", name: setTool.name, input: {text: "Exclude private documents"}},
    ]});
    await respondToSlack(ctx, "Exclude private documents", ctx.threadTs, []);
    expect(set).not.toHaveBeenCalled();
    expect(createRule).not.toHaveBeenCalled();
  });

  it("passes the original instruction and explicit clarification answer together", async () => {
    const instruction = "Exclude captures from my private documents";
    const answer = "Only for me";
    const text = `${instruction}\nRequired detail: ${answer}`;
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic");
    route.mockResolvedValue({stop_reason: "tool_use", content: [{type: "tool_use", name: setTool.name, input: {text}}]});
    await respondToSlack(ctx, answer, "1800000000.002", [{question: instruction, answer: "Should this apply to you or the whole team?"}]);
    expect(set).toHaveBeenCalledExactlyOnceWith(member, text, location);
    expect(route).toHaveBeenCalledTimes(1);
    const routingContext = JSON.parse(route.mock.calls[0][0].messages[0].content);
    expect(routingContext.history).toEqual([{question: instruction, answer: "Should this apply to you or the whole team?"}]);
    expect(routingContext.message).toBe(answer);
    expect(createRule).not.toHaveBeenCalled();
  });

  it.each(["undo", "  UNDO  "])("routes %s to undo with the exact caller and conversation", async text => {
    const result = await setTool.handler(ctx, {text});
    expect(undo).toHaveBeenCalledExactlyOnceWith(member, location);
    expect(set).not.toHaveBeenCalled();
    expect(createRule).not.toHaveBeenCalled();
    expect(result.text).toBe("Removed your latest capture rule instruction in this conversation. Restored 2 existing captures and kept 1 with later edits or other rules.");
    expect(result.text).not.toContain("/private");
    expect(result.text).not.toContain("Reply undo");
    expect(result.blocks?.every(block => block.type === "section")).toBe(true);
  });

  it("routes an undo reply through the same conversational tool", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic");
    route.mockResolvedValue({stop_reason: "tool_use", content: [{type: "tool_use", name: setTool.name, input: {text: "undo"}}]});
    await respondToSlack(ctx, "undo", ctx.threadTs, [{question: "Exclude private documents", answer: "Reply undo to remove it."}]);
    expect(undo).toHaveBeenCalledExactlyOnceWith(member, location);
    expect(set).not.toHaveBeenCalled();
    expect(route).toHaveBeenCalledTimes(1);
  });

  it.each([
    {channelId: "D_OTHER"},
    {threadTs: "1800000001.002"},
    {teamId: "team_other"},
    {memberId: "member_other"},
  ])("passes the exact changed context $channelId $threadTs $teamId $memberId to undo", async changed => {
    const conversation = {...ctx, ...changed};
    await setTool.handler(conversation, {text: "undo"});
    expect(undo).toHaveBeenCalledExactlyOnceWith({...member, teamId: conversation.teamId, memberId: conversation.memberId}, {...location, channelId: conversation.channelId, threadTs: conversation.threadTs});
    expect(effective).not.toHaveBeenCalled();
  });

  it("propagates expired undo and scope authorization refusals without creating a rule", async () => {
    undo.mockRejectedValueOnce(new Error("The undo window has expired."));
    await expect(setTool.handler(ctx, {text: "undo"})).rejects.toThrow("expired");
    set.mockRejectedValueOnce(new Error("A team admin is needed."));
    await expect(setTool.handler({...ctx, isAdmin: true}, {text: "Exclude these for the team"})).rejects.toThrow("admin");
    expect(createRule).not.toHaveBeenCalled();
  });

  it("asks only the service's missing-detail question in a DM", async () => {
    set.mockResolvedValue({status: "question", rule: rule(), restatement: "This is incomplete. Which paths?", question: "Should this apply to you or the whole team?"});
    const result = await setTool.handler({...ctx, channelId: "D_FIXTURE"}, {text: "Exclude those documents"});
    expect(result.text).toBe("Should this apply to you or the whole team?");
    expect(result.text.match(/\?/g)).toHaveLength(1);
    expect(result.text).not.toMatch(/undo|saved|incomplete/i);
    expect(set).toHaveBeenCalledTimes(1);
    expect(createRule).not.toHaveBeenCalled();
  });

  it("asks one static question in channels without echoing private details", async () => {
    set.mockResolvedValue({status: "question", restatement: "/private/owner/documents", question: "Should private-owner or secret-owner match /private/owner/documents?"});
    const result = await setTool.handler(ctx, {text: "Exclude /private/owner/documents"});
    expect(result.text.match(/\?/g)).toHaveLength(1);
    expect(result.text).toBe("Which repository owners should Hive keep captures from?");
    expect(result.text).not.toMatch(/private-owner|secret-owner|\/private\/owner\/documents|Reply undo/);
    expect(result.blocks?.every(block => block.type === "section")).toBe(true);
  });

  it.each([
    {kind: "repo_owner", owners: ["private-owner"], mode: "only_allow"},
    {kind: "repo_owner", owners: ["private-owner"], mode: "deny"},
    {kind: "repo_match", pattern: "private-owner/private-repository"},
    {kind: "path_match", pattern: "/private/owner/documents/**"},
    {kind: "keyword", pattern: "private-sensitive-keyword"},
    {kind: "agent_or_client", agent: "private-agent"},
  ])("keeps exact $kind matches private in both public and private channels", async fields => {
    set.mockResolvedValue(saved({rule: rule(fields), restatement: "Exclude private-owner/private-repository /private/owner/documents private-sensitive-keyword private-agent."}));
    for (const channelId of ["C_PUBLIC", "G_PRIVATE"]) {
      const result = await setTool.handler({...ctx, channelId}, {text: "Exclude the private matches"});
      expect(JSON.stringify(result)).not.toMatch(/private-owner|private-repository|\/private\/owner|private-sensitive-keyword|private-agent|Private capture rule name/);
      expect(result.text).not.toContain("Reply undo to remove it.");
    }
  });

  it.each(["drop", "redact", "flag"])("reports automatic application counts for a team %s rule", async action => {
    set.mockResolvedValue(saved({rule: rule({action, scope: "team"}), counts: {...counts, pending: true}}));
    const result = await setTool.handler(ctx, {text: "Apply this for the whole team"});
    expect(result.text).toContain("for the whole team");
    expect(result.text).toContain("12 existing captures: 3 matched, 2 updated and 1 skipped");
    expect(result.text).toContain("More existing captures still need to be processed.");
    expect(result.text).not.toMatch(/all existing captures|complete|finished/i);
    expect(set.mock.calls[0][0]).not.toHaveProperty("isAdmin");
  });

  it("shows one actual escaped restatement in a DM and strips provider names and emoji", async () => {
    const restatement = "I will exclude <private> & @here <@U123> captures from Anthropic, OpenAI, Claude, Jev, TypeSafe, Gemini and GPT-6.1 :bee: 🐝 🇵🇹!";
    set.mockResolvedValue(saved({restatement, counts: undefined}));
    const result = await setTool.handler({...ctx, channelId: "D_FIXTURE"}, {text: "Exclude my private captures"});
    expect(result.text).toContain("I will exclude &lt;private&gt; &amp; @\u200bhere &lt;@\u200bU123&gt;");
    expect(result.text.match(/I will exclude/g)).toHaveLength(1);
    expect(result.text).not.toContain("Reply undo to remove it.");
    expect(result.text).not.toMatch(/Anthropic|OpenAI|Claude|Jev|TypeSafe|Gemini|GPT-6\.1|:bee:|🐝|🇵🇹|!/i);
    expect(result.blocks?.[0]).toMatchObject({type: "section", text: {type: "mrkdwn", verbatim: true, text: result.text}});
  });
  it("reports a stopped automatic scan", async () => {
    set.mockResolvedValue(saved({ counts: { ...counts, pending: false, stopped: true } }));
    const result = await setTool.handler(ctx, { text: "Exclude private captures" });
    expect(result.text).toContain("The scan stopped because the rule or permissions changed.");
    expect(result.text).not.toMatch(/complete|finished/i);
  });

  it("escapes DM questions and undo restatements", async () => {
    const dm = {...ctx, channelId: "D_FIXTURE"};
    set.mockResolvedValue({status: "question", restatement: "Ignored", question: "Should <private> & @channel captures be excluded?"});
    expect((await setTool.handler(dm, {text: "Exclude this"})).text).toBe("Should &lt;private&gt; &amp; @\u200bchannel captures be excluded?");
    undo.mockResolvedValue({status: "undone", restatement: "Removed the <private> & @here rule."});
    expect((await setTool.handler(dm, {text: "undo"})).text).toBe("Removed the &lt;private&gt; &amp; @\u200bhere rule.");
  });

  it("bounds escaped sections without splitting an entity", async () => {
    set.mockResolvedValue(saved({restatement: "<&>".repeat(1000), counts: undefined}));
    const result = await setTool.handler({...ctx, channelId: "D_FIXTURE"}, {text: "Exclude my private captures"});
    expect(result.blocks!.length).toBeGreaterThan(1);
    const copies = result.blocks!.map(block => (block.text as {text: string}).text);
    expect(copies.every(copy => copy.length <= 2900 && !/&(?:am?|l|g|lt|gt)$/.test(copy))).toBe(true);
    expect(copies.join("")).toBe(result.text);
  });

  it.each([{text: ""}, {text: "   "}, {text: "x".repeat(4001)}, {text: "Exclude this", rule: {}}, {text: "undo", id: "forged"}])("rejects malformed input before any service call", async input => {
    await expect(setTool.handler(ctx, input)).rejects.toThrow();
    expect(set).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
  });

  it("refuses removed members before saving or undoing", async () => {
    sql.mockResolvedValue([]);
    await expect(setTool.handler(ctx, {text: "Exclude my private captures"})).rejects.toThrow("no longer active");
    await expect(setTool.handler(ctx, {text: "undo"})).rejects.toThrow("no longer active");
    expect(set).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });
});

describe("Slack effective capture rules", () => {
  it("uses only the server's effective list and keeps matches private", async () => {
    effective.mockResolvedValue([rule(), rule({kind: "repo_owner", owners: ["private-owner"], mode: "only_allow", scope: "team"})]);
    const result = await listTool.handler(ctx, {});
    expect(effective).toHaveBeenCalledExactlyOnceWith(member);
    expect(result.text).toBe("These enabled capture rules apply to you:\nHive now skips memories from matching paths for you.\nHive now skips memories outside the selected repository owners for the whole team.");
    expect(JSON.stringify(result)).not.toMatch(/private-owner|\/private|Private capture rule name/);
    expect(set).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });

  it("keeps the detected-secret empty state", async () => {
    expect((await listTool.handler(ctx, {})).text).toBe("You have no enabled capture rules. Hive still removes detected secrets before saving.");
  });

  it("keeps a large effective list within Slack's block limit", async () => {
    effective.mockResolvedValue(Array.from({length: 3000}, () => rule()));
    const result = await listTool.handler(ctx, {});
    expect(result.blocks).toHaveLength(50);
    expect(result.text).toContain("Review the full list in Settings, Capture rules.");
  });
});
