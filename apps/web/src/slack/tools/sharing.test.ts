import { beforeEach, expect, it, vi } from "vitest";
import { sharingTools } from "./sharing";
const mocks = vi.hoisted(() => ({ share: vi.fn(), actor: vi.fn() }));
vi.mock("@/server/share-on-join", () => ({ shareWith: mocks.share }));
vi.mock("./context", () => ({ toolActor: mocks.actor }));
const actor = { teamId: "team_example", memberId: "mem_example", teamName: "Example", memberName: "Person" };
const ctx = { ...actor, isAdmin: false, channelId: "Dexample", threadTs: "1.0" };
beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue(actor); });
it.each([
  ["all_selected", "Share all selected projects with this team now and in future.", []],
  ["all_selected", "Share everything Hive captures for me with this team.", []],
  ["projects", "Share github.com/example/widget with this team.", ["github.com/example/widget"]],
  ["not_now", "Stop sharing my learnings.", []],
] as const)("records the same %s decision from the original human Slack instruction", async (mode, instructionText, projects) => {
  expect(await sharingTools[0].handler({...ctx,instructionText}, {mode,projects})).toEqual({react:"white_check_mark"});
  expect(mocks.share).toHaveBeenCalledExactlyOnceWith(actor,{teamId:ctx.teamId,mode,projects,humanInstruction:instructionText});
});
it.each([undefined, "Should I share all selected projects?", "Should I share everything?", "Share github.com/example/widget with this team.", "Should I stop sharing my learnings?", "Keep their learnings private."])("does not infer consent from %s", async instructionText => {
  await sharingTools[0].handler({...ctx,instructionText}, {mode:"all_selected"});
  await sharingTools[0].handler({...ctx,instructionText}, {mode:"not_now"});
  expect(mocks.share).not.toHaveBeenCalled();
});
