import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { parseJoinDecision } = await import("./join-requests");

describe("join decision replies", () => {
  it("accepts the past tense admins actually type", () => {
    expect(parseJoinDecision("approved")).toEqual({ decision: "approve", person: undefined });
    expect(parseJoinDecision("Declined.")).toEqual({ decision: "decline", person: undefined });
    expect(parseJoinDecision("please approve")).toEqual({ decision: "approve", person: undefined });
  });
  it("reads an address out of Slack link markup", () => {
    expect(parseJoinDecision("approve <mailto:rephus@gmail.com|rephus@gmail.com>")).toEqual({ decision: "approve", person: "rephus@gmail.com" });
    expect(parseJoinDecision("approve <mailto:rephus@gmail.com>\n*Sent using* Slack MCP client")).toEqual({ decision: "approve", person: "rephus@gmail.com" });
    expect(parseJoinDecision("decline <https://example.test/u/javi|Javi>")).toEqual({ decision: "decline", person: "Javi" });
  });
  it("leaves other messages alone", () => {
    expect(parseJoinDecision("approve of this plan, carry on")).toEqual({ decision: "approve", person: "of this plan, carry on" });
    expect(parseJoinDecision("tell me about the hive")).toBeNull();
  });
});
