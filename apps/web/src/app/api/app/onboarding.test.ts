import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  ctx: {
    teamId: "personal",
    teamName: "Personal",
    memberId: "human",
    memberName: "Human",
  },
  auth: vi.fn(),
  create: vi.fn(),
  join: vi.fn(),
  select: vi.fn(),
  human: vi.fn(),
  capability: vi.fn(),
  delegation: vi.fn(),
  invite: vi.fn(),
  email: vi.fn(),
}));
vi.mock("@/server/auth", () => ({ getWebContext: mocks.auth }));
vi.mock("@/server/identity/onboarding-web", () => ({
  humanActor: mocks.human,
  createOrganisation: mocks.create,
  joinOrganisation: mocks.join,
  joinFailure:
    "This hive could not be joined. Check the link or ask your admin.",
}));
vi.mock("@/server/identity/join-requests", () => ({joinOrRequest:mocks.join}));
vi.mock("@/server/web-hive-session", () => ({ selectHive: mocks.select }));
vi.mock("@/lib/public-url", () => ({
  publicUrl: async () => "https://gohive.dev",
}));
vi.mock("@/server/organisation-invites", () => ({
  readOrganisationInvite: mocks.invite,
  deliverOrganisationCreated: mocks.email,
}));
vi.mock("@/server/identity/join-phrases", () => ({
  issueJoinCapability: mocks.capability,
}));
vi.mock("@/server/project-sharing", () => ({
  delegateProjectSelection: mocks.delegation,
}));
import { POST as capability } from "./join-capability/route";
import { POST as delegation } from "./project-selection/delegate/route";
import * as createRoute from "./create-organisation/route";
import { POST as join } from "./join-phrase/route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(mocks.ctx);
  mocks.human.mockResolvedValue({ id: mocks.ctx.memberId });
  mocks.create.mockResolvedValue({
    teamId: "team",
    teamName: "Team",
    paused: false,
  });
  mocks.join.mockResolvedValue({ status:"joined", teamId: "team", teamName: "Team" });
  mocks.invite.mockResolvedValue({
    teamId: "team",
    teamName: "Team",
    joinUrl: "https://gohive.dev/j/amber-honey-fox",
    invitePrompt: "Invite prompt",
    joinPaused: false,
  });
});
const request = (path: string, body: unknown, origin?: string) =>
  new Request(`https://gohive.dev/api/app/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
it("returns the exact creation invite contract to the human and their agent", async () => {
  const response = await createRoute.POST(
    request(
      "create-organisation",
      { requestKey: crypto.randomUUID() },
      "https://gohive.dev",
    ),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    teamId: "team",
    teamName: "Team",
    joinUrl: "https://gohive.dev/j/amber-honey-fox",
    invitePrompt: "Invite prompt",
    joinPaused: false,
  });
  expect(mocks.email).toHaveBeenCalledWith(
    mocks.ctx,
    await mocks.invite.mock.results[0].value,
  );
});
it.each([undefined, "https://evil.example", "null"])(
  "rejects join and create without a same-origin CSRF boundary (%s)",
  async (origin) => {
    expect(
      (
        await createRoute.POST(
          request(
            "create-organisation",
            { requestKey: crypto.randomUUID() },
            origin,
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await join(
          request("join-phrase", { phrase: "amber-honey-fox" }, origin),
        )
      ).status,
    ).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.join).not.toHaveBeenCalled();
  },
);
it("authenticates before any write and does not expose a create GET handler", async () => {
  mocks.auth.mockResolvedValue(null);
  expect(
    (
      await createRoute.POST(
        request(
          "create-organisation",
          { requestKey: crypto.randomUUID() },
          "https://gohive.dev",
        ),
      )
    ).status,
  ).toBe(401);
  expect(mocks.create).not.toHaveBeenCalled();
  expect("GET" in createRoute).toBe(false);
});
it("selects the joined organisation only after a successful human POST", async () => {
  const response = await join(
    request("join-phrase", { phrase: "amber-honey-fox" }, "https://gohive.dev"),
  );
  expect(response.status).toBe(200);
  expect(mocks.select).toHaveBeenCalledWith(mocks.ctx, "team");
  mocks.join.mockRejectedValue(new Error("Secret team name"));
  expect(
    await (
      await join(
        request(
          "join-phrase",
          { phrase: "blue-honey-bear" },
          "https://gohive.dev",
        ),
      )
    ).json(),
  ).toEqual({
    error: "This hive could not be joined. Check the link or ask your admin.",
  });
});

it("requires human authority and same-origin requests before issuing agent capabilities", async () => {
  expect(
    (
      await capability(
        request("join-capability", {
          phrase: "amber-honey-fox",
          agentId: "agent",
        }),
      )
    ).status,
  ).toBe(403);
  expect(mocks.capability).not.toHaveBeenCalled();
  mocks.human.mockRejectedValue(
    Object.assign(new Error("Human only"), { status: 403 }),
  );
  expect(
    (
      await capability(
        request(
          "join-capability",
          { phrase: "amber-honey-fox", agentId: "agent" },
          "https://gohive.dev",
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await delegation(
        request(
          "project-selection/delegate",
          {
            agentId: "agent",
            selection: { include: [], exclude: [], revision: 1 },
          },
          "https://gohive.dev",
        ),
      )
    ).status,
  ).toBe(403);
  expect(mocks.capability).not.toHaveBeenCalled();
  expect(mocks.delegation).not.toHaveBeenCalled();
});
