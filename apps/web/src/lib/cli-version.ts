import release from "./cli-version.json";

export const cliVersion = release;
export const cliVersionInstructions = `gohive latest=${cliVersion.latest}, minimum=${cliVersion.minimum}. Claude Code: the Hive hooks keep the install current; never run gohive commands in the chat unless Hive tools are missing, and then run them in the background while the task continues. Codex: at first Hive use run node ~/.codex/skills/hive/scripts/auto-update.mjs once; it returns in under a second and updates quietly. Follow minimum-version notices only.`;
