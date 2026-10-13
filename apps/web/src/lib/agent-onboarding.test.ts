import { describe, expect, it } from "vitest";
import {
  agentInstructions,
  setupPrompt,
  teamInvitePrompt,
} from "./agent-onboarding";
import { GET } from "@/app/agent/route";
import { GET as markdown } from "@/app/agent.md/route";

describe("agent onboarding instructions", () => {
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
    expect(agentInstructions).toContain(
      "Sign in with Google in the tab that just opened.",
    );
    expect(agentInstructions).toContain(
      "Continue when `gohive status` reports signed in.",
    );
    expect(agentInstructions).toContain(
      "only when no person is at the keyboard",
    );
    expect(agentInstructions).toContain("--identity agent");
    expect(agentInstructions).toContain(
      "Never create an AgentMail inbox for a person.",
    );
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
