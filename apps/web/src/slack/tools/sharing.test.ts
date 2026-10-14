import { beforeEach, expect, it, vi } from "vitest";
import { sharingTools } from "./sharing";
const mocks = vi.hoisted(() => ({ share: vi.fn(), actor: vi.fn(), decide: vi.fn() }));
vi.mock("@/server/share-on-join", () => ({ shareWith: mocks.share }));
vi.mock("./context", () => ({ toolActor: mocks.actor }));
vi.mock("@/server/slack/decisiveness", () => ({ decideDecisiveness: mocks.decide }));
const actor = { teamId: "team_example", memberId: "mem_example", teamName: "Example", memberName: "Person" };
const ctx = { ...actor, isAdmin: false, channelId: "Dexample", threadTs: "1.0" };
beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue(actor); });
it.each([
  ["all_selected", "<@U123> share everything Hive captures for me with this team", []],
  ["projects", "Share github.com/example/widget with this team.", ["github.com/example/widget"]],
  ["not_now", "Keep my learnings personal for now.", []],
] as const)("records the routed %s choice once Jev judges the request decisive", async (mode, instructionText, projects) => {
  mocks.decide.mockResolvedValue({ act: true, reason: "Clear" });
  expect(await sharingTools[0].handler({ ...ctx, instructionText }, { mode, projects })).toEqual({ react: "white_check_mark" });
  const text = instructionText.replace("<@U123> ", "");
  expect(mocks.decide).toHaveBeenCalledExactlyOnceWith(text, expect.objectContaining({ actionType: "share", memberId: "mem_example" }), { mode, projects });
  expect(mocks.share).toHaveBeenCalledExactlyOnceWith(actor, { teamId: ctx.teamId, mode, projects, humanInstruction: text });
});
it("asks one line and records nothing when Jev hears a question or a missing detail", async () => {
  mocks.decide.mockResolvedValueOnce({ act: false, reason: "Should I share your learnings with this team?" });
  expect(await sharingTools[0].handler({ ...ctx, instructionText: "Should I share everything?" }, { mode: "all_selected" })).toEqual({ text: "Should I share your learnings with this team?" });
  mocks.decide.mockResolvedValueOnce({ act: false, reason: "", react: "eyes" });
  expect(await sharingTools[0].handler({ ...ctx, instructionText: "sharing is nice" }, { mode: "all_selected" })).toEqual({ text: "", react: "eyes" });
  expect(mocks.share).not.toHaveBeenCalled();
});
it("has no regex left deciding sharing intent", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./sharing.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/\.test\(text\)/);
});
