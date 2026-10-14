import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  landing: vi.fn(),
  offer: vi.fn(),
  share: vi.fn(),
}));
vi.mock("@/server/auth", () => ({ getWebContext: mocks.context }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/server/identity/join-requests", () => ({
  joinRequestLanding: mocks.landing,
}));
vi.mock("@/server/share-on-join", () => ({ shareOnJoinOffer: mocks.offer }));
vi.mock("@/components/share-on-join", () => ({ ShareOnJoin: mocks.share }));
vi.mock("@/components/login", () => ({ ProviderButtons: () => null }));
import Page from "./page";
const actor = {
  teamId: "personal",
  memberId: "human",
  memberName: "Person",
  teamName: "Personal",
};
const offer = {
  teamId: "organisation",
  teamName: "Example Hive",
  projects: [{ pattern: "fixture/project", cells: 3 }],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(actor);
  mocks.landing.mockResolvedValue({
    teamId: "organisation",
    teamName: "Example Hive",
    joined: true,
    automatic: false,
    domains: ["fixture.work.test"],
    requestStatus: "approved",
    retryAt: null,
    sharedProjects: 0,
  });
  mocks.offer.mockResolvedValue(offer);
  mocks.share.mockImplementation(() => "Shared organisation offer");
});
it("mounts the shared onboarding offer only after approval", async () => {
  const html = renderToStaticMarkup(
    await Page({ params: Promise.resolve({ phrase: "amber-honey-fox" }) }),
  );
  expect(html).toContain("You&#x27;re in Example Hive.");
  expect(html).toContain("Shared organisation offer");
  expect(mocks.offer).toHaveBeenCalledExactlyOnceWith(actor, "organisation");
  expect(mocks.share.mock.calls[0][0]).toEqual({ ...offer, preselect: true });
});
it("keeps the pending page informative without reading personal sharing choices", async () => {
  mocks.landing.mockResolvedValue({
    teamId: "organisation",
    teamName: "Example Hive",
    joined: false,
    automatic: false,
    domains: ["fixture.work.test"],
    requestStatus: "pending",
    retryAt: null,
    sharedProjects: 0,
  });
  const html = renderToStaticMarkup(
    await Page({ params: Promise.resolve({ phrase: "amber-honey-fox" }) }),
  );
  expect(html).toContain("Asked. An admin will let you in.");
  expect(html).not.toContain("Shared organisation offer");
  expect(mocks.offer).not.toHaveBeenCalled();
});
it("authenticates before looking up the phrase or the offer", async () => {
  mocks.context.mockResolvedValue(null);
  const html = renderToStaticMarkup(
    await Page({ params: Promise.resolve({ phrase: "amber-honey-fox" }) }),
  );
  expect(html).toContain("Sign in to join a hive");
  expect(mocks.landing).not.toHaveBeenCalled();
  expect(mocks.offer).not.toHaveBeenCalled();
});
