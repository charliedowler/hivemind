#!/usr/bin/env node
import { bearerToken, endpoint, homeDirectory } from "./mcp.mjs";
import { reportEvent } from "./telemetry.mjs";
const hiveUrl = endpoint();
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

async function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, "utf8")); } catch { return; }
  if (input.stop_hook_active || !input.transcript_path || !input.session_id) return;
  const marker = path.join(process.env.TMPDIR || os.tmpdir(), "hive-stop-" + crypto.createHash("sha256").update(String(input.session_id)).digest("hex"));
  if (fs.existsSync(marker)) return;
  let transcript;
  try { transcript = fs.readFileSync(input.transcript_path, "utf8").slice(-100000); } catch { return; }
  const facts = { changes: 0, errors: 0, observations: 0, text: "" };
  const notes = [];
  for (const line of transcript.split("\n")) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use" && /^(Edit|Write|MultiEdit|apply_patch)$/i.test(block.name || "")) facts.changes++;
      if (block.type === "tool_result" && block.is_error) facts.errors++;
      if (entry.type === "assistant" && block.type === "text" && typeof block.text === "string") {
        notes.push(block.text);
        if (/\b(learned|discovered|workaround|root cause|gotcha|blocked|slowed|friction|insight|decision)\b/i.test(block.text)) facts.observations++;
      }
    }
  }
  facts.text = notes.join("\n").slice(-6000);
  if (facts.text.trim().length < 20 || facts.changes + facts.errors + facts.observations === 0) return;
  try { fs.writeFileSync(marker, "", { flag: "wx", mode: 0o600 }); } catch { return; }
  let key = await bearerToken(homeDirectory(), hiveUrl, AbortSignal.timeout(2000));
  if (!key) {
    try {
      const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8"));
      const server = config.mcpServers?.hive;
      if (server?.url?.replace(/\/$/, "") === hiveUrl + "/api/mcp") key = server.headers?.Authorization?.replace(/^Bearer /i, "");
    } catch {}
  }
  let serverRecorded = false;
  if (key) {
    try {
      const response = await fetch(hiveUrl + "/api/app/capture", {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify(facts),
        signal: AbortSignal.timeout(2000),
      });
      serverRecorded = response.ok;
      if (response.ok) {
        const result = await response.json();
        if (result.decision === "skip") return;
      }
    } catch {}
  }
  const ending = !process.env.CLAUDE_CODE_ENTRYPOINT || process.env.CLAUDE_CODE_ENTRYPOINT === "cli"
    ? "If nothing qualifies, stop now without comment."
    : "This is a headless run and the caller reads only your last message, so finish by repeating your previous final answer word for word and nothing else.";
  const reason = "Read the hive skill before capture. Search for an existing cell; skip facts already saved in this session and use supersedes for a replacement. Set verify_after to an ISO timestamp for time-sensitive guidance when the tool supports it. Before you stop: if this session taught you something a teammate's agent would otherwise have to rediscover (a gotcha, a fix, a decision, an insight or friction: what slowed you down, how long, was there a workaround), use the Hive MCP server at " + hiveUrl + "/api/mcp to call hive_push once per learning with a title that states the fact, the repo and 3 to 5 tags. For friction include area, measured minutes lost as cost when known, blocked and workaround. Never invent time lost. Never include secrets, customer names or personal data. Skip general knowledge any agent already has. " + ending;
  process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
  if (key && !serverRecorded) await reportEvent('hook', { hookKind: 'stop', gateDecision: 'capture', pushedCount: null }, { token: key });
}
main().catch(() => {});
