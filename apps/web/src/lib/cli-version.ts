import release from "./cli-version.json";

export const cliVersion = release;
export const cliVersionInstructions = `gohive latest=${cliVersion.latest}, minimum=${cliVersion.minimum}. Coding agents: run npx --yes gohive@latest status once per session for quiet updates; keep OAuth and project selection. Follow minimum-version notices only.`;
