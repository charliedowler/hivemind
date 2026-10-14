import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), choices: vi.fn(), settings: vi.fn() }));
vi.mock("@/server/auth", () => ({ getWebContext: mocks.context }));
vi.mock("@/server/identity/onboarding-web", () => ({ hiveChoices: mocks.choices }));
vi.mock("@/server/share-on-join", () => ({ shareOnJoinSettings: mocks.settings }));
vi.mock("@/components/feed", () => ({ Feed: () => null }));
vi.mock("@/components/share-on-join", () => ({ ShareOnJoin: ({ teamName }: { teamName: string }) => `Share card for ${teamName}` }));
import Page from "./page";
const ctx = { teamId: "personal", teamName: "Personal", memberId: "human", memberName: "Person" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(ctx);
  mocks.choices.mockResolvedValue([
    { teamId: "personal", teamName: "Personal", personal: true },
    { teamId: "unanswered", teamName: "Lightdash", personal: false },
    { teamId: "answered", teamName: "Answered team", personal: false },
  ]);
  mocks.settings.mockImplementation(async (_ctx: unknown, teamId: string) => ({ teamId, teamName: teamId === "unanswered" ? "Lightdash" : "Answered team", mode: "everything", projects: [], workAreas: "", decision: teamId === "answered" ? "not_now" : null }));
});
it("nudges every team the person never answered, even from the personal hive", async () => {
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Share card for Lightdash");
  expect(html).not.toContain("Share card for Answered team");
  expect(mocks.settings).toHaveBeenCalledTimes(2);
});
