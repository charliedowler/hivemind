vi.mock("@/server/share-on-join", () => ({ shareOnJoinSettings: async () => null }));
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  choices: vi.fn(),
  session: vi.fn(),
  context: {
    memberId: "human",
    memberName: "Human",
    teamId: "lightdash",
    teamName: "Lightdash",
    role: "member",
    justJoined: {
      teamId: "lightdash",
      teamName: "Lightdash",
      via: "domain",
    } as { teamId: string; teamName: string; via: string } | null,
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@better-auth/oauth-provider", () => ({
  verifyOAuthQueryParams: async () => true,
}));
vi.mock("@/server/better-auth", () => ({
  getAuth: async () => ({
    $context: Promise.resolve({ secret: "local-test-only" }),
    api: {
      getSession: mocks.session,
      getOAuthClientPublic: async () => ({ client_name: "Claude" }),
    },
  }),
}));
vi.mock("@/server/identity/session-context", () => ({
  loadMemberContext: mocks.load,
}));
vi.mock("@/server/identity/onboarding-web", () => ({
  hiveChoices: mocks.choices,
}));
vi.mock("@/server/auth", () => ({ getWebContext: async () => mocks.context }));
vi.mock("@/components/feed", () => ({ Feed: () => null }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { oauth2: { consent: vi.fn() } },
}));
import ConsentPage from "./page";
import CombPage from "../(dashboard)/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.justJoined = {
    teamId: "lightdash",
    teamName: "Lightdash",
    via: "domain",
  };
  mocks.session.mockResolvedValue({
    user: { id: "human", email: "human@example.test", emailVerified: true },
    session: { id: "session" },
  });
  mocks.load.mockResolvedValue({
    member: {
      id: "human",
      name: "Human",
      email: "human@example.test",
      actorType: "human",
      provisional: false,
    },
    personalHive: { id: "personal", name: "My hive" },
    organisations: [
      {
        id: "lightdash",
        name: "Lightdash",
        role: "member",
        joinedAt: "2026-10-13T14:30:00Z",
        joinPaused: false,
      },
    ],
    selectedHiveId: "lightdash",
    justJoined: mocks.context.justJoined,
    consent: { personWide: false },
  });
  mocks.choices.mockResolvedValue([
    { teamId: "personal", teamName: "My hive", personal: true },
    { teamId: "lightdash", teamName: "Lightdash", personal: false },
  ]);
});
it("loads the eligible organisation before listing consent choices", async () => {
  const html = renderToStaticMarkup(
    await ConsentPage({
      searchParams: Promise.resolve({
        client_id: "claude",
        scope: "hive hive:person offline_access",
      }),
    }),
  );
  expect(mocks.load).toHaveBeenCalledWith("human", "session");
  expect(mocks.choices).not.toHaveBeenCalled();
  expect(html).toContain('value="lightdash" selected=""');
  expect(html).toContain("Personal · My hive");
  expect(html).toContain("organisations you join now or in future");
});
it("does not load domain membership or choices for an unverified session", async () => {
  mocks.session.mockResolvedValue({
    user: { id: "human", emailVerified: false },
    session: { id: "session" },
  });
  await ConsentPage({ searchParams: Promise.resolve({ client_id: "claude" }) });
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.choices).not.toHaveBeenCalled();
});
it("shows the organisation notice without requiring an explicit join URL", async () => {
  const html = renderToStaticMarkup(await CombPage());
  expect(html).toContain("You&#x27;re in Lightdash.");
  expect(html).not.toContain("Join Lightdash");
});

it("does not repeat the organisation notice after the signal is consumed", async () => {
  mocks.context.justJoined = null;
  expect(renderToStaticMarkup(await CombPage())).not.toContain(
    "You&#x27;re in Lightdash.",
  );
});
