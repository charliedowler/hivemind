import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { bearerToken, callTool, endpoint, homeDirectory } from "./mcp.mjs";
import { captureContext, effectiveCaptureRules, localCaptureDecision } from "./capture-rules.mjs";

const normalise = value => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const durable = /\b(learned|discovered|workaround|root cause|gotcha|blocked|slowed|friction|insight|decision|fixed|resolved|chose)\b/i;
const contentText = content => typeof content === "string" ? content : Array.isArray(content) ? content.filter(block => block.type === "text").map(block => block.text || "").join("\n") : "";
const pushTool = name => /(?:^|__)hive_push$/.test(name || "");
export function savedReceipt(result) {
  if (result?.is_error || result?.isError || result?.dropped) return false;
  const text = contentText(result?.content ?? result);
  try {
    const value = typeof result === "object" && result?.id ? result : JSON.parse(text);
    if (value.isError || value.dropped) return false;
    if (Array.isArray(value.content)) return value.content.some(block => block.type === "text" && savedReceipt(block.text));
    return typeof value.id === "string" && /^lrn_/.test(value.id);
  } catch { return false; }
}

export function sessionFacts(transcript) {
  const calls = new Map();
  const saved = [];
  const candidates = [];
  let changes = 0, errors = 0;
  for (const line of transcript.split("\n")) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!Array.isArray(entry.message?.content)) continue;
    for (const block of entry.message.content) {
      if (block.type === "tool_use") {
        if (/^(Edit|Write|MultiEdit|apply_patch)$/i.test(block.name || "")) changes++;
        if (pushTool(block.name) && typeof block.input?.observation === "string") calls.set(block.id, block.input.observation);
      }
      if (block.type === "tool_result") {
        if (block.is_error) errors++;
        if (calls.has(block.tool_use_id) && !block.is_error && savedReceipt(block)) saved.push(calls.get(block.tool_use_id));
      }
      if (entry.type === "assistant" && block.type === "text" && typeof block.text === "string") {
        for (const paragraph of block.text.split(/\n\s*\n/)) {
          const text = paragraph.trim().slice(0, 4000);
          if (text.length >= 20 && durable.test(text)) candidates.push(text);
        }
      }
    }
  }
  const savedNormal = saved.map(normalise);
  const missed = [...new Set(candidates)].filter(text => !savedNormal.some(value => value === normalise(text) || value.includes(normalise(text)) || normalise(text).includes(value)));
  return { changes, errors, observations: missed.length, candidates: missed, saved, text: missed.join("\n\n").slice(-6000) };
}

function sessionState(input, context) {
  const directory = path.join(homeDirectory(), ".hive/capture-sessions");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const name = hash(`${endpoint()}|${input.session_id}|${context.remote || ""}`);
  return { file: path.join(directory, `${name}.json`), lock: path.join(directory, `${name}.lock`) };
}
function load(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { saved: [], swept: [] }; }
}
function persist(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export async function captureSession(input) {
  const transcriptPath = input.hook_event_name === "SubagentStop" ? input.agent_transcript_path : input.transcript_path;
  if (input.stop_hook_active || !transcriptPath || !input.session_id) return;
  let transcript;
  try { transcript = fs.readFileSync(transcriptPath, "utf8").slice(-100000); } catch { return; }
  const facts = sessionFacts(transcript);
  if (!facts.text) return;
  const context = captureContext(input);
  const statePaths = sessionState(input, context);
  let lock;
  try {
    if (fs.existsSync(statePaths.lock) && Date.now() - fs.statSync(statePaths.lock).mtimeMs > 30000) fs.unlinkSync(statePaths.lock);
    lock = fs.openSync(statePaths.lock, "wx", 0o600);
  } catch { return; }
  try {
    const state = load(statePaths.file);
    state.saved = [...new Set([...state.saved, ...facts.saved.map(value => hash(normalise(value)))])];
    const candidates = facts.candidates.filter(text => !state.saved.includes(hash(normalise(text))) && !state.swept.includes(hash(normalise(text)))).slice(-2);
    if (!candidates.length) { persist(statePaths.file, state); return; }
    const token = await bearerToken(homeDirectory(), endpoint(), AbortSignal.timeout(1000));
    if (!token) return;
    const rules = await effectiveCaptureRules({ token });
    const decision = await localCaptureDecision(rules, { ...context, title: "", body: candidates.join("\n\n") });
    if (decision.dropped || decision.action === "drop") return;
    const response = await fetch(`${endpoint()}/api/app/capture`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...context, changes: facts.changes, errors: facts.errors, observations: candidates.length, text: candidates.join("\n\n").slice(-6000) }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return;
    const gate = await response.json();
    if (gate.decision !== "capture") return;
    for (const observation of candidates) {
      const result = await callTool("hive_push", { observation, evidence: { session_excerpt: observation }, context }, { token, signal: AbortSignal.timeout(3000) });
      if (savedReceipt(result)) state.saved.push(hash(normalise(observation)));
      persist(statePaths.file, state);
    }
  } finally { fs.closeSync(lock); fs.unlinkSync(statePaths.lock); }
}

export async function postToolNudge(input) {
  if (!input.session_id || input.tool_name !== "Bash") return;
  const command = input.tool_input?.command?.trim().replace(/\s+/g, " ");
  if (!command || command.length > 2000 || /[;&|`]|\$\(/.test(command) || !/^(?:(?:pnpm|npm|yarn|bun)(?: --filter [\w@/.-]+)? (?:run )?(?:test|build|typecheck)(?:\s|$)|(?:pytest|vitest|jest|tsc|cargo test|cargo build|go test|dotnet test)(?:\s|$))/.test(command)) return;
  const failed = input.hook_event_name === "PostToolUseFailure" || input.tool_response?.is_error === true || (Number.isInteger(input.tool_response?.exit_code) && input.tool_response.exit_code !== 0);
  const passed = !failed && (input.tool_response?.exit_code === 0 || (input.tool_response?.interrupted !== true && /\b(?:passed|successful|successfully|0 fail(?:ed|ures)?|0 errors?)\b/i.test(input.tool_response?.stdout || "")));
  if (!failed && !passed) return;
  const context = captureContext(input);
  const token = await bearerToken(homeDirectory(), endpoint(), AbortSignal.timeout(1000));
  if (!token) return;
  const rules = await effectiveCaptureRules({ token });
  const decision = await localCaptureDecision(rules, { ...context, title: "", body: "" });
  if (decision.dropped || decision.action === "drop") return;
  const paths = sessionState(input, context);
  const state = load(paths.file);
  const key = hash(command);
  state.failedCommands ??= [];
  if (failed) state.failedCommands = [...new Set([...state.failedCommands, key])].slice(-50);
  const nudge = passed && state.failedCommands.includes(key);
  if (nudge) state.failedCommands = state.failedCommands.filter(value => value !== key);
  persist(paths.file, state);
  if (nudge) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "A test or build failed and now passes. If this established a non-obvious fix, capture the cause, fix and evidence now with hive_push. Check the selected project and Hive skill first. Skip anything already saved. Do not ask a question or delay the answer." } }) + "\n");
}

export function rememberPush(input) {
  if (!input.session_id || !pushTool(input.tool_name) || typeof input.tool_input?.observation !== "string" || !savedReceipt(input.tool_response)) return;
  const paths = sessionState(input, captureContext(input));
  if (fs.existsSync(paths.lock)) return;
  const state = load(paths.file);
  state.saved = [...new Set([...state.saved, hash(normalise(input.tool_input.observation))])];
  persist(paths.file, state);
}
