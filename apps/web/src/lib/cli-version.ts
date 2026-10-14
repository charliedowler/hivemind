import release from "./cli-version.json";

export const cliVersion = release;
export const cliVersionInstructions = `gohive latest=${cliVersion.latest}, minimum=${cliVersion.minimum}. Claude Code: hooks handle updates; never run gohive in chat unless Hive tools are missing, then background it and keep working. Codex: at first Hive use run node ~/.codex/skills/hive/scripts/auto-update.mjs once (sub-second). Follow minimum-version notices only.`;
