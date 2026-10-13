import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { HiveInvite, InviteTeam } from "./hive-invite";
import { Members } from "./members";
import { CellSharing } from "./cell-sharing";
import { LearningCard } from "./learning-card";
import { ProjectDelegation } from "./project-delegation";
import { Feed } from "./feed";
import { PromptBlock } from "./prompt-block";
import { setupPrompt } from "@/lib/agent-onboarding";
import { renderWelcome } from "@/server/identity/welcome-template";
import { Consent } from "./consent";
const mocks = vi.hoisted(() => ({ request: vi.fn(), consent: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { oauth2: { consent: mocks.consent } },
}));
vi.mock("@/lib/client", () => ({
  requestJson: mocks.request,
  errorMessage: (e: Error) => e.message,
  relativeTime: () => "2 hours ago",
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("states personal and future access only for person-wide consent", () => {
  const props = {
    clientName: "Codex",
    teamName: "Workshop",
    email: "human@example.test",
    claims: [],
    oauthQuery: "client_id=codex",
  };
  const person = renderToStaticMarkup(
    <Consent {...props} scopes={["hive:person"]} />,
  );
  expect(person).toContain(
    "personal hive and organisations you join now or in future",
  );
  expect(person).toContain(
    "Sharing with an organisation still needs your permission.",
  );
  expect(person).toContain(
    "follows your future hive memberships until you revoke it",
  );
  const team = renderToStaticMarkup(<Consent {...props} scopes={["hive"]} />);
  expect(team).toContain("Access is limited to this hive.");
  expect(team).not.toContain("future hive memberships");
});
it("lists both hives with the organisation selected by default at consent", () => {
  const html = renderToStaticMarkup(
    <Consent
      clientName="Claude"
      teamName="Lightdash"
      teamId="team"
      email="human@example.test"
      scopes={["hive:person"]}
      claims={[]}
      oauthQuery="client_id=claude"
      hives={[
        { teamId: "personal", teamName: "My hive", personal: true },
        { teamId: "team", teamName: "Lightdash", personal: false },
      ]}
    />,
  );
  expect(html).toContain('value="team" selected=""');
  expect(html).toContain("Personal · My hive");
  expect(html).toContain("Lightdash");
  expect(html).toContain("organisations you join now or in future");
});
async function mount(element: React.ReactNode) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost/app",
  });
  for (const key of ["window", "self", "document", "AbortController"] as const)
    vi.stubGlobal(key, dom.window[key]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 1;
  });
  const host = dom.window.document.getElementById("root")!;
  const root = createRoot(host);
  await act(async () => root.render(element));
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}
it.each(["allow", "cancel"])(
  "keeps the signed OAuth scope unchanged when choosing a hive and pressing %s",
  async (decision) => {
    const query = "client_id=claude&scope=hive&sig=signed";
    const { host, close } = await mount(
      <Consent
        clientName="Claude"
        teamName="Lightdash"
        teamId="team"
        email="human@example.test"
        scopes={["hive"]}
        claims={[]}
        oauthQuery={query}
        hives={[
          { teamId: "personal", teamName: "My hive", personal: true },
          { teamId: "team", teamName: "Lightdash", personal: false },
        ]}
      />,
    );
    vi.stubGlobal("FormData", window.FormData);
    mocks.request.mockResolvedValue({ ok: true });
    mocks.consent.mockResolvedValue({ data: {} });
    try {
      const select = host.querySelector("select")!;
      await act(async () => {
        select.value = "personal";
        select.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
      expect(host.textContent).toContain("This agent can act in My hive.");
      await act(async () =>
        host
          .querySelector<HTMLButtonElement>(`button[value="${decision}"]`)!
          .click(),
      );
      if (decision === "allow")
        expect(mocks.request).toHaveBeenCalledWith("/api/app/switch-hive", {
          teamId: "personal",
        });
      else expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.consent).toHaveBeenCalledWith({
        accept: decision === "allow",
        oauth_query: query,
      });
    } finally {
      await close();
    }
  },
);
it("regenerates the invite prompt after rotate and hides it when paused", async () => {
  const { host, close } = await mount(
    <HiveInvite
      teamId="team"
      teamName="Team"
      baseUrl="https://gohive.dev"
      initial={{ phrase: "amber-honey-fox", generation: 1, paused: false }}
      initialDomains={["example.test"]}
    />,
  );
  try {
    expect(host.textContent).toContain(
      "then join with https://gohive.dev/j/amber-honey-fox",
    );
    mocks.request.mockResolvedValue({
      phrase: { phrase: "blue-honey-bear", generation: 2, paused: false },
      domains: ["example.test"],
    });
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "Rotate")!
        .click(),
    );
    expect(host.textContent).toContain(
      "then join with https://gohive.dev/j/blue-honey-bear",
    );
    expect(host.textContent).not.toContain("amber-honey-fox");
    mocks.request.mockResolvedValue({
      phrase: { phrase: "blue-honey-bear", generation: 2, paused: true },
      domains: ["example.test"],
    });
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "Pause")!
        .click(),
    );
    expect(host.textContent).toContain("Joining is paused");
    expect(host.textContent).not.toContain("Set me up on Hive");
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.textContent === "Copy",
      ),
    ).toBe(false);
  } finally {
    await close();
  }
});
it("groups agents by verified owner ID and rolls their cell counts up", () => {
  const member = {
    id: "human",
    name: "Charlie",
    role: "admin" as const,
    actorType: "human" as const,
    learningCount: 2,
    joinedAt: "2026-10-13T10:00:00Z",
    lastSeenAt: null,
    email: "human@example.test",
    emailVerified: true,
  };
  const html = renderToStaticMarkup(
    <Members
      baseUrl="https://gohive.dev"
      initial={{
        memberId: "human",
        overview: {
          teamName: "Team",
          role: "admin",
          domains: [],
          memberCount: 4,
          learningCount: 8,
          repos: [],
          inviteExpiresAt: "2026-10-20T10:00:00Z",
        },
        keys: [],
        members: [
          member,
          {
            ...member,
            id: "agent1",
            actorType: "agent",
            role: "member",
            name: "Codex on laptop",
            ownerId: "human",
            learningCount: 3,
          },
          {
            ...member,
            id: "agent2",
            actorType: "agent",
            role: "member",
            name: "Claude Code",
            ownerId: "human",
            learningCount: 1,
          },
          {
            ...member,
            id: "orphan",
            actorType: "agent",
            name: "Unbound",
            ownerId: null,
            learningCount: 2,
          },
        ],
      }}
    />,
  );
  expect(html).toContain("6 cells");
  expect(html).toContain("1 person, 3 agents");
  expect(html).toContain("Agents without an owner");
  expect(html).toContain("Codex on laptop · last seen");
  expect(html.match(/member-card/g)).toHaveLength(1);
});
it("shares and withdraws a current cell revision from the dialog controls", async () => {
  mocks.request.mockResolvedValue({
    owner: true,
    organisations: [{ teamId: "team", teamName: "Team", shared: false }],
  });
  const { host, close } = await mount(<CellSharing id="cell" revision={3} />);
  try {
    mocks.request.mockResolvedValue({
      owner: true,
      organisations: [{ teamId: "team", teamName: "Team", shared: true }],
    });
    await act(async () => host.querySelector("button")!.click());
    expect(mocks.request).toHaveBeenLastCalledWith(
      "/api/app/learnings/cell/sharing",
      { teamId: "team", action: "share", revision: 3 },
    );
    expect(host.textContent).toContain("Make personal");
    mocks.request.mockResolvedValue({
      owner: true,
      organisations: [{ teamId: "team", teamName: "Team", shared: false }],
    });
    await act(async () => host.querySelector("button")!.click());
    expect(mocks.request).toHaveBeenLastCalledWith(
      "/api/app/learnings/cell/sharing",
      { teamId: "team", action: "withdraw", revision: 3 },
    );
    expect(host.textContent).toContain("Share with Team");
  } finally {
    await close();
  }
});
it("renders owner-first attribution and the homepage prompt", () => {
  const cell = {
    id: "cell",
    title: "A cell",
    body: "body",
    kind: "learning",
    source: "codex",
    repo: "github.com/team/repo",
    paths: [],
    tags: [],
    confidence: 0.9,
    author: {
      id: "agent",
      name: "Codex on laptop",
      actorType: "agent",
      ownerName: "Charlie",
    },
    pushCount: 1,
    votes: { up: 0, down: 0, outdated: 0 },
    createdAt: "2026-10-13T10:00:00Z",
    updatedAt: "2026-10-13T10:00:00Z",
    lastPushedAt: "2026-10-13T10:00:00Z",
  } as const;
  expect(
    renderToStaticMarkup(
      <LearningCard
        learning={{ ...cell, paths: [], tags: [] }}
        onOpen={() => {}}
      />,
    ),
  ).toContain("Charlie · Codex on laptop");
  expect(
    renderToStaticMarkup(<PromptBlock text={setupPrompt} recordCopy />),
  ).toContain(setupPrompt);
  expect(
    renderToStaticMarkup(
      <InviteTeam
        teamName="Team"
        baseUrl="https://gohive.dev"
        phrase={{ phrase: "amber-honey-fox", generation: 1, paused: true }}
      />,
    ),
  ).not.toContain("Copy");
});
it("escapes the welcome email and uses one claim link with no cell excerpts", () => {
  const message = renderWelcome({
    name: "<Charlie>",
    claimUrl: "https://gohive.dev/api/auth/claim?token=claim",
  });
  expect(message.text).toContain("Your agent set up your personal Hive.");
  expect(message.text).toContain("Create a hive for your team:");
  expect(message.html).toContain("&lt;Charlie&gt;");
  expect(message.html).not.toContain("<Charlie>");
  expect(message.text.match(/token=claim/g)).toHaveLength(1);
});

it("shows excluded cells only when history is enabled", async () => {
  const base = {
    id: "hidden",
    title: "Hidden cell",
    body: "body",
    kind: "learning",
    source: "codex",
    repo: null,
    paths: [],
    tags: [],
    confidence: 0.9,
    author: { id: "human", name: "Charlie" },
    pushCount: 1,
    votes: { up: 0, down: 2, outdated: 0 },
    unhelpfulLabel: "Marked unhelpful by 2",
    lifecycle: "fresh",
    createdAt: "2026-10-13T10:00:00Z",
    updatedAt: "2026-10-13T10:00:00Z",
    lastPushedAt: "2026-10-13T10:00:00Z",
  };
  mocks.request.mockResolvedValue({
    learnings: [
      base,
      {
        ...base,
        id: "visible",
        title: "Visible cell",
        votes: { up: 0, down: 0, outdated: 0 },
        unhelpfulLabel: null,
      },
    ],
  });
  const { host, close } = await mount(<Feed />);
  try {
    expect(host.textContent).toContain("Visible cell");
    expect(host.textContent).not.toContain("Hidden cell");
    expect(mocks.request).toHaveBeenCalledWith(
      "/api/app/feed?include_history=true",
      undefined,
      expect.anything(),
    );
    await act(async () =>
      host.querySelector<HTMLInputElement>('input[role="switch"]')!.click(),
    );
    expect(host.textContent).toContain("Hidden cell");
    expect(host.textContent).toContain("Marked unhelpful by 2");
    await act(async () =>
      host.querySelector<HTMLInputElement>('input[role="switch"]')!.click(),
    );
    expect(host.textContent).not.toContain("Hidden cell");
  } finally {
    await close();
  }
});

it("grants one named agent only the exact project selection at the current revision", async () => {
  mocks.request.mockResolvedValue({ id: "delegation" });
  const { host, close } = await mount(
    <ProjectDelegation
      policy={{
        include: ["github.com/team/platform"],
        exclude: ["github.com/team/private"],
        revision: 4,
      }}
      agents={[{ id: "agent", name: "Codex on laptop" }]}
    />,
  );
  try {
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      select.value = "agent";
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(mocks.request).toHaveBeenLastCalledWith(
      "/api/app/project-selection/delegate",
      {
        agentId: "agent",
        selection: {
          include: ["github.com/team/platform"],
          exclude: ["github.com/team/private"],
          revision: 4,
        },
      },
    );
    expect(host.textContent).toContain(
      "Allowed Codex on laptop to save these projects once within 15 minutes.",
    );
  } finally {
    await close();
  }
});
