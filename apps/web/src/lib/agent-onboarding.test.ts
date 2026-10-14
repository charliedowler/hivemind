import { describe, expect, it } from "vitest";
import {
  agentInstructions,
  setupPrompt,
  teamInvitePrompt,
} from "./agent-onboarding";
import { GET } from "@/app/agent/route";
import { GET as markdown } from "@/app/agent.md/route";

describe("agent onboarding instructions", () => {
  it("keeps invite instructions on the same local or hosted origin as the join link", () => {
    for (const origin of ["http://localhost:3167", "https://hive.example"]) {
      expect(teamInvitePrompt("Team", `${origin}/j/amber-honey-fox`)).toContain(`read ${origin}/agent`);
    }
  });
  it("gives the exact homepage prompt and current team locator", () => {
    expect(setupPrompt).toBe(
      "Set me up on Hive: read https://gohive.dev/agent and follow it.",
    );
    expect(
      teamInvitePrompt("Team", "https://gohive.dev/j/amber-honey-fox"),
    ).toContain("then join with https://gohive.dev/j/amber-honey-fox");
  });
  it("serves crawlable plain text to agents and HTML to browsers", async () => {
    const response = GET(new Request("https://gohive.dev/agent"));
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(await response.text()).toBe(agentInstructions);
    expect(agentInstructions.split("\n").length).toBeLessThan(60);
    for (const text of ["HIVE_EXECUTOR_TOOLS=1", "offer_executor", "mcp.addServer", "oauth.start", "connection link", "--email <address>", "No browser opens", "Ask with the harness's question/picker tool when one exists; otherwise a numbered list.", "AskUserQuestion", "multiSelect", "request_user_input", "github.com/<org>/*", "Yes (everything selected, now and in future)", "Choose projects", "Not now", "hive_share_with", "min-release-age", "https://github.com/charliedowler/hivemind", "never the installer", "Never announce installation or print the join prompt outside an actual install", "retry once with the version status printed"]) expect(agentInstructions).toContain(text);
    expect(agentInstructions).toContain("backfill before continuing");
    expect(agentInstructions).toContain("git log --since='4 days ago'");
    expect(agentInstructions).toContain("how many cells you saved from the backfill");
    expect(agentInstructions).not.toContain("--identity agent");
    expect(agentInstructions).not.toContain("AgentMail");
    expect(agentInstructions).not.toContain("--no-install");
    expect(await markdown().text()).toBe(agentInstructions);
    expect(
      GET(
        new Request("https://gohive.dev/agent", {
          headers: { accept: "text/html" },
        }),
      ).headers.get("content-type"),
    ).toContain("text/html");
  });
});
