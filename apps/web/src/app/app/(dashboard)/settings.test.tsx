vi.mock("@/server/share-on-join", () => ({ shareOnJoinSettings: async () => null }));
vi.mock("@/server/project-sharing", () => ({
  ownerCapturePolicy: async () => ({ include: [], exclude: [], revision: 0 }),
}));
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import TeamPage from "./team/page";
import AccountPage from "./account/page";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  members: vi.fn(),
  slack: vi.fn(),
  rules: vi.fn(),
  account: vi.fn(),
  sql: vi.fn(),
  invite: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/server/identity/enrollment", () => ({
  personalMemberContext: async () => mocks.context(),
}));
vi.mock("@/server/auth", () => ({ getWebContext: mocks.context }));
vi.mock("@/server/web-member-page", () => ({ webMemberPage: mocks.members }));
vi.mock("@/server/identity/onboarding-web", () => ({
  hiveChoices: async () => [{ teamId: "team_test", personal: false }],
}));
vi.mock("@/server/identity/join-phrases", () => ({
  adminJoinPhrase: async () => null,
}));
vi.mock("@/server/identity/join-requests", () => ({
  listJoinRequests: async () => [],
}));
vi.mock("@/server/web-sharing", () => ({
  projectShareState: async () => [],
  ownerAgentChoices: async () => [],
}));
vi.mock("@/components/hive-invite", () => ({
  HiveInvite: () => <p>Invite control</p>,
  InviteBlock: ({ invitePrompt }: { invitePrompt: string }) => (
    <p>{invitePrompt}</p>
  ),
}));
vi.mock("@/server/organisation-invites", () => ({
  readOrganisationInvite: mocks.invite,
}));
vi.mock("@/server/identity/access", () => ({ account: mocks.account }));
vi.mock("@/server/slack/store", () => ({ teamSlackSettings: mocks.slack }));
vi.mock("@/server/capture-rules", () => ({ listCaptureRules: mocks.rules }));
vi.mock("@/server/db/client", () => ({ getSql: () => mocks.sql }));
vi.mock("@/lib/public-url", () => ({
  publicUrl: async () => "http://localhost",
}));
vi.mock("@/components/members", () => ({
  Members: () => <button>Member control</button>,
}));
const ctx = { memberId: "member_test", teamId: "team_test" };
const base = {
  id: "crule_personal",
  name: "Skip personal repo",
  teamId: "team_test",
  memberId: "member_test",
  createdBy: "member_test",
  createdAt: "2026-10-13T10:00:00Z",
  updatedAt: "2026-10-13T10:00:00Z",
  scope: "member",
  kind: "repo_match",
  pattern: "*/private-repo",
  action: "drop",
  enabled: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(ctx);
  mocks.members.mockResolvedValue({ overview: { role: "admin" } });
  mocks.invite.mockResolvedValue(null);
  mocks.slack.mockResolvedValue({
    installation: null,
    channels: [],
    decisions: [],
  });
  mocks.rules.mockResolvedValue([
    base,
    {
      ...base,
      id: "crule_team",
      scope: "team",
      memberId: null,
      pattern: "*/team-repo",
    },
  ]);
  mocks.account.mockResolvedValue({
    member: {
      name: "Member",
      email: "member@example.test",
      email_verified: true,
      role: "member",
    },
  });
  mocks.sql.mockResolvedValue([{ has_password: false }]);
});
it.each(["admin", "member"])(
  "shows admin requests and keeps read-only controls for %s",
  async (role) => {
    mocks.members.mockResolvedValue({ overview: { role } });
    const dom = new JSDOM(
      renderToStaticMarkup(
        await TeamPage({ searchParams: Promise.resolve({}) }),
      ),
    );
    try {
      const doc = dom.window.document;
      expect(
        [...doc.querySelectorAll("body > div > section")].map((s) => s.id),
      ).toEqual([
        ...(role === "admin" ? ["requests"] : []),
        "members",
        "slack",
        "keeps",
        "export",
      ]);
      expect([...doc.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(
        [
          ...(role === "admin" ? ["Requests"] : []),
          "Members",
          "Slack",
          "What Hive keeps",
          "Export",
        ],
      );
      expect(doc.querySelectorAll("fieldset")).toHaveLength(4);
      expect(doc.querySelectorAll("fieldset:disabled")).toHaveLength(
        role === "member" ? 4 : 0,
      );
      expect(doc.body.textContent).toContain("Export archive");
      expect(doc.body.textContent).not.toContain("When Hive speaks");
      expect(doc.body.textContent).not.toContain("private-repo");
    } finally {
      dom.window.close();
    }
  },
);
it.each(["", "1", ["", "1"]])(
  "shows the debug card when ?debug is present (%s)",
  async (debug) => {
    const html = renderToStaticMarkup(
      await TeamPage({ searchParams: Promise.resolve({ debug }) }),
    );
    expect(html).toContain("When Hive speaks");
  },
);
it("loads a member's personal choices on Account without team controls", async () => {
  const dom = new JSDOM(renderToStaticMarkup(await AccountPage()));
  try {
    expect(mocks.rules).toHaveBeenCalledExactlyOnceWith(ctx);
    const personal = dom.window.document.querySelector(
      'section[aria-label="What your agents keep"]',
    )!;
    expect(personal.textContent).toContain("*/private-repo");
    expect(personal.textContent).not.toContain("*/team-repo");
    expect(personal.querySelector("form")).not.toBeNull();
    expect(
      personal.querySelector('input[role="switch"]')?.hasAttribute("disabled"),
    ).toBe(false);
  } finally {
    dom.window.close();
  }
});
it.each([TeamPage, AccountPage])(
  "redirects anonymous visitors before loading settings",
  async (page) => {
    mocks.context.mockResolvedValue(null);
    await expect(page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "/app/login",
    );
    expect(mocks.rules).not.toHaveBeenCalled();
  },
);

it("shows the invitation to members without admin actions", async () => {
  mocks.members.mockResolvedValue({ overview: { role: "member" } });
  mocks.invite.mockResolvedValue({
    teamId: "team_test",
    teamName: "Team",
    joinUrl: "https://gohive.dev/j/phrase",
    invitePrompt: "Set me up on Hive and join the Team hive",
    joinPaused: false,
  });
  const html = renderToStaticMarkup(
    await TeamPage({ searchParams: Promise.resolve({}) }),
  );
  expect(html).toContain("Set me up on Hive and join the Team hive");
  expect(html).not.toContain("Invite control");
  expect(html).not.toContain("Rotate");
});
