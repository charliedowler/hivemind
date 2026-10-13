import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { humanizeTimeText, redactSecrets, type CaptureRuleInput } from "@hivemind/core";
import type { SlackTool, SlackToolContext, SlackToolResult } from "./index";
import { getSql } from "@/server/db/client";
import { HiveError } from "@/server/errors";
import { effectiveRules } from "@/server/capture-rules";
import { setCaptureRuleFromText, undoCaptureRuleInstruction, type CaptureRuleInstructionCounts } from "../../server/capture-rule-instructions";
import { slackEscape } from "@/server/slack/format";

async function actor(ctx: SlackToolContext) {
  const rows = await getSql()`SELECT m.name, t.name AS team_name FROM members m JOIN teams t ON t.id = m.team_id WHERE m.team_id = ${ctx.teamId} AND m.id = ${ctx.memberId} AND m.removed_at IS NULL`;
  if (!rows.length) throw new HiveError("Your hive membership is no longer active.", 403);
  return {teamId: ctx.teamId, memberId: ctx.memberId, memberName: String(rows[0].name), teamName: String(rows[0].team_name)};
}

function escapedCopy(text: string) {
  return slackEscape(humanizeTimeText(redactSecrets(text).text)
    .replace(/\b(anthropic|openai|claude|sonnet|codex|jev|typesafe|chatgpt|gemini|deepseek|grok|xai|mistral|qwen|kimi|gpt(?:-[a-z0-9.]+)?)\b/gi, "the model")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\u20E3]/gu, "")
    .replace(/:[a-z0-9_+-]+:/gi, "")
    .replace(/[!\u2013\u2014]/g, ".")
    .replace(/@/g, "@\u200b"));
}

function ruleSummary(rule: CaptureRuleInput) {
  const action = {drop: "skips", redact: "redacts", flag: "keeps"}[rule.action];
  const match = {
    repo_owner: rule.kind === "repo_owner" && rule.mode === "only_allow"
      ? "observations outside the selected repository owners"
      : "observations from the selected repository owners",
    repo_match: "observations from matching repositories",
    path_match: "observations from matching paths",
    content_category: rule.kind === "content_category" ? {
      personal_info: "observations with personal information",
      credentials: "observations with credentials",
      customer_data: "observations with customer data",
      non_work: "observations about non-work activity",
    }[rule.category] : "matching observations",
    agent_or_client: "observations from the selected agent or session type",
    keyword: "observations with matching text",
  }[rule.kind];
  return `Hive now ${action} ${match.replace(/observations/g, "memories")}${rule.action === "flag" ? " privately for review" : ""} ${rule.scope === "team" ? "for the whole team" : "for you"}.`;
}

function reply(copy: string): SlackToolResult {
  const text = escapedCopy(copy);
  const chunks: string[] = [];
  let chunk = "";
  for (const [token] of text.matchAll(/&(?:amp|lt|gt);|[\s\S]/gu)) {
    if (chunk.length + token.length > 2900) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += token;
  }
  if (chunk) chunks.push(chunk);
  return {text, blocks: chunks.map(text => ({type: "section", text: {type: "mrkdwn", text, verbatim: true}}))};
}

function captureCounts(counts: CaptureRuleInstructionCounts | undefined, undone: boolean, action?: CaptureRuleInput["action"]) {
  if (!counts) return "";
  const changed = undone
    ? `${counts.restored} earlier memories were restored.${counts.retained ? ` ${counts.retained} memories keep later changes or other rules.` : ""}`
    : `${counts.applied} earlier memories were ${action === "drop" ? "removed" : action === "redact" ? "redacted" : "kept private"}.${counts.skipped ? ` ${counts.skipped} changed memories were skipped.` : ""}`;
  return ` ${changed}${counts.pending ? " More earlier memories are still being checked." : ""}${counts.stopped ? " The scan stopped because the rule or permissions changed." : ""}`;
}

function cleanAcknowledgement(counts: CaptureRuleInstructionCounts | undefined, undone = false) {
  return Boolean(counts && !counts.pending && !counts.stopped && (undone ? counts.restored === 0 && counts.retained === 0 : counts.applied === 0 && counts.skipped === 0));
}

function channelQuestion(question: string | undefined) {
  if (/scope|whole team|for (?:you|everyone)|team or|member/i.test(question ?? ""))
    return "Should this rule apply to you or the whole team?";
  if (/owner|organisation|organization|repo|github/i.test(question ?? ""))
    return "Which repository owners should Hive keep captures from?";
  if (/path|directory|folder/i.test(question ?? ""))
    return "Which paths should this rule match?";
  if (/agent|client|session/i.test(question ?? ""))
    return "Which agent or session type should this rule match?";
  if (/keyword|term|pattern|regex/i.test(question ?? ""))
    return "Which text should this rule match?";
  return "Which content should the rule exclude, redact or keep private?";
}

const requestInput = z.strictObject({text: z.string().trim().min(1).max(4000)});
const listInput = z.strictObject({});

export function isCaptureUndoInstruction(text: string) {
  const request = text.replace(/^(?:<@[A-Z0-9]+>\s*)+/, "").trim();
  return /^(?:(?:please|can you|could you)\s+)?(?:undo(?:\s+(?:that|this|it|(?:the\s+)?(?:last|latest)\s+(?:rule|change|action)))?|cancel\s+that)[.!?]*$/i.test(request);
}

type CaptureActionPointer = { member_id: string; inverse: unknown };

export const captureUndoHandlers: Record<string, (ctx: SlackToolContext, pointer: CaptureActionPointer) => Promise<SlackToolResult>> = {
  async hive_set_capture_rule(ctx, pointer) {
    const member = await actor(ctx);
    if (pointer.member_id !== ctx.memberId)
      return reply("Only the person who set this capture rule can undo it here.");
    const payload = z.object({ kind: z.literal("capture_instruction"), reversible: z.literal(true), payload: z.object({ instructionId: z.string().regex(/^cinstr_[a-z2-7]{12}$/) }) }).parse(pointer.inverse);
    const result = await undoCaptureRuleInstruction(member, { source: "slack", channelId: ctx.channelId, threadTs: ctx.threadTs }, payload.payload.instructionId);
    const summary = "Removed your latest capture rule in this conversation.";
    if (cleanAcknowledgement(result.counts, true)) return { react: "white_check_mark", text: summary };
    return reply(`${summary}${captureCounts(result.counts, true)}`);
  },
};

export async function dispatchCaptureUndo(ctx: SlackToolContext): Promise<SlackToolResult | null> {
  const [pointer] = await getSql()`SELECT tool_name, member_id, inverse FROM slack_tool_actions WHERE team_id = ${ctx.teamId} AND channel_id = ${ctx.channelId} AND thread_ts = ${ctx.threadTs} ORDER BY created_at DESC, id DESC LIMIT 1`;
  const handler = pointer && Object.hasOwn(captureUndoHandlers, pointer.tool_name) ? captureUndoHandlers[pointer.tool_name] : null;
  return handler ? handler(ctx, pointer as CaptureActionPointer) : null;
}

export const captureRuleTools: SlackTool[] = [
  {
    name: "hive_set_capture_rule",
    description: "Save a capture rule immediately from the member's full request about what agents may save, exclude, redact or keep private. Ask one question only if a required detail is missing. When continuing a clarification, reconstruct the original instruction and the member's explicit answer from conversation history: pass the original instruction + '\nRequired detail: ' + the answer as text, never just the answer. Save as soon as the required details are complete. Use this same tool with text 'undo' to remove the member's latest rule instruction in this Slack channel and thread within one hour. Team scope needs a current admin, checked by the server. Return the tool result directly without creating the rule again.",
    input_schema: z.toJSONSchema(requestInput) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      const input = requestInput.parse(args);
      const member = await actor(ctx);
      const location = {source: "slack" as const, channelId: ctx.channelId, threadTs: ctx.threadTs};
      if (input.text.toLowerCase() === "undo" && !isCaptureUndoInstruction(ctx.instructionText ?? input.text))
        return reply("Which capture rule should Hive change?");
      const result = input.text.toLowerCase() === "undo"
        ? await undoCaptureRuleInstruction(member, location)
        : await setCaptureRuleFromText(member, input.text, {...location, messageTs: ctx.messageTs});
      if (result.status === "question") {
        return reply(ctx.channelId.startsWith("D")
          ? result.question ?? "Which content should the rule match, and should it exclude, redact or keep that content private?"
          : channelQuestion(result.question));
      }
      if (result.status === "undone") {
        const summary = ctx.channelId.startsWith("D")
          ? result.restatement
          : "Removed your latest capture rule instruction in this conversation.";
        if (cleanAcknowledgement(result.counts, true)) return { react: "white_check_mark", text: escapedCopy(summary) };
        return reply(`${summary}${captureCounts(result.counts, true)}`);
      }
      const summary = ctx.channelId.startsWith("D")
        ? result.restatement
        : result.rule ? ruleSummary(result.rule) : "Saved your capture rule.";
      if (cleanAcknowledgement(result.counts)) return { react: "white_check_mark", text: escapedCopy(summary) };
      return reply(`${summary}${captureCounts(result.counts, false, result.rule?.action)}`);
    },
  },
  {
    name: "hive_list_capture_rules",
    description: "List the enabled capture rules that apply to this member: their own rules and the team's rules. Return plain summaries without patterns, original descriptions or document contents. Never list another member's personal rules.",
    input_schema: z.toJSONSchema(listInput) as Anthropic.Tool.InputSchema,
    async handler(ctx, args) {
      listInput.parse(args);
      const rules = await effectiveRules(await actor(ctx));
      if (!rules.length) return reply("You have no enabled capture rules. Hive still removes detected secrets before saving.");
      const summaries = rules.map(rule => ruleSummary(rule));
      const chunks: string[] = ["These enabled capture rules apply to you:"];
      for (const summary of summaries) {
        const last = chunks.length - 1;
        if (chunks[last].length + summary.length + 1 > 2500) chunks.push(summary);
        else chunks[last] += `\n${summary}`;
      }
      const visible = chunks.slice(0, 49);
      if (chunks.length > 49) visible.push("There are more enabled rules. Review the full list in Settings, Capture rules.");
      return {
        text: escapedCopy(visible.join("\n")),
        blocks: visible.map(copy => ({type: "section", text: {type: "mrkdwn", text: escapedCopy(copy), verbatim: true}})),
      };
    },
  },
];
