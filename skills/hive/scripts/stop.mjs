#!/usr/bin/env node
import fs from "node:fs";
import { captureSession, postToolNudge, rememberPush } from "./capture-session.mjs";

async function main() {
  let input;
  try { input = JSON.parse(fs.readFileSync(0, "utf8")); } catch { return; }
  if (["PostToolUse", "PostToolUseFailure"].includes(input.hook_event_name)) {
    rememberPush(input);
    await postToolNudge(input);
  }
  else await captureSession({ ...input, hook_event_name: input.hook_event_name || "Stop" });
}
main().catch(() => {});
