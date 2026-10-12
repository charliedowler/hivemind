import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as effective } from "./effective/route";
import { GET as list, POST as create } from "./route";
import { PATCH as update, DELETE as remove } from "./[id]/route";
import { POST as propose } from "./propose/route";
import { POST as preview } from "./[id]/preview/route";
import { POST as apply } from "./[id]/apply/route";
import { GET as history } from "./history/route";
import { POST as reverse } from "./history/[id]/reverse/route";
import { POST as confirmFlagged } from "./flagged/[id]/confirm/route";

const fixture = vi.hoisted(() => {
  const ctx = {
    teamId: "team_test",
    memberId: "member_test",
    teamName: "Fixture",
    memberName: "Member",
  };
  return {
    ctx,
    getWebContext: vi.fn(async () => ctx as typeof ctx | null),
    authenticateApiKey: vi.fn(async (_key: string) => ctx as typeof ctx | null),
    memberContext: vi.fn(
      async (_member: string, _team: string) => ctx as typeof ctx | null,
    ),
    requireAdmin: vi.fn(async () => {}),
    requireMcpAuth: vi.fn(),
    effectiveRules: vi.fn(async () => [{ id: "crule_test" }]),
    listCaptureRules: vi.fn(async () => []),
    createCaptureRule: vi.fn(async () => ({ id: "crule_test" })),
    updateCaptureRule: vi.fn(async () => ({ id: "crule_test" })),
    deleteCaptureRule: vi.fn(async () => ({ id: "crule_test" })),
    proposeRuleFromText: vi.fn(async () => ({
      rule: null,
      restatement: "Choose an owner.",
      question: "Which owner?",
    })),
    previewCaptureRule: vi.fn(async () => ({
      token: "preview_test",
      count: 3,
      scanned: 500,
      truncated: true,
    })),
    applyCaptureRule: vi.fn(async () => ({ applied: 3, logIds: [] })),
    listCaptureRuleApplications: vi.fn(async () => []),
    reverseCaptureRuleApplication: vi.fn(async () => ({
      id: "app_test",
      reversed: true,
    })),
    confirmFlaggedCapture: vi.fn(async () => ({ id: "lrn_test" })),
  };
});
vi.mock("@/server/auth", () => ({
  getWebContext: fixture.getWebContext,
  authenticateApiKey: fixture.authenticateApiKey,
}));
vi.mock("@/server/better-auth", () => ({
  getAuth: async () => ({}),
  mcpResource: () => "https://hive.example/api/mcp",
}));
vi.mock("@/server/identity/enrollment", () => ({
  memberContext: fixture.memberContext,
}));
vi.mock("@/server/identity/access", () => ({
  requireAdmin: fixture.requireAdmin,
}));
vi.mock("@/server/identity/rate-limit", () => ({
  rateLimit: vi.fn(async () => {}),
}));
vi.mock("@/server/analytics/events", () => ({
  originFor: () => ({}),
  withOrigin: async (_origin: unknown, action: () => unknown) => action(),
}));
vi.mock("@/server/capture-rules", () => ({
  reverseCaptureRuleApplication: fixture.reverseCaptureRuleApplication,
  effectiveRules: fixture.effectiveRules,
  listCaptureRules: fixture.listCaptureRules,
  createCaptureRule: fixture.createCaptureRule,
  updateCaptureRule: fixture.updateCaptureRule,
  deleteCaptureRule: fixture.deleteCaptureRule,
  proposeRuleFromText: fixture.proposeRuleFromText,
  previewCaptureRule: fixture.previewCaptureRule,
  applyCaptureRule: fixture.applyCaptureRule,
  listCaptureRuleApplications: fixture.listCaptureRuleApplications,
  confirmFlaggedCapture: fixture.confirmFlaggedCapture,
}));
vi.mock("@better-auth/mcp", () => ({ requireMcpAuth: fixture.requireMcpAuth }));

const params = { params: Promise.resolve({ id: "crule_test" }) };
const key = `hm_${"a".repeat(43)}`;
const input = {
  name: "Work repos",
  scope: "member",
  kind: "repo_owner",
  owners: ["team", "another-team"],
  mode: "only_allow",
  action: "drop",
  enabled: true,
  source: "web",
};
function request(body?: unknown, headers?: HeadersInit) {
  return new Request("https://hive.example/api/app/capture-rules", {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.getWebContext.mockResolvedValue(fixture.ctx);
  fixture.authenticateApiKey.mockImplementation(async (raw) =>
    raw === key ? fixture.ctx : null,
  );
  fixture.memberContext.mockResolvedValue(fixture.ctx);
  fixture.requireAdmin.mockResolvedValue(undefined);
  fixture.requireMcpAuth.mockImplementation(
    (_auth, handler, _options) => async (req: Request) => {
      if (req.headers.get("authorization") !== "Bearer valid-oauth")
        return Response.json(
          { error: "Invalid bearer token." },
          { status: 401 },
        );
      return handler(req, {
        hive_member_id: fixture.ctx.memberId,
        hive_team_id: fixture.ctx.teamId,
        sub: fixture.ctx.memberId,
      });
    },
  );
});

describe("effective capture rule bearer boundary", () => {
  it("accepts a legacy bearer key, binds its member, and never reads web cookies", async () => {
    const response = await effective(
      request(undefined, { Authorization: `Bearer ${key}` }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rules: [{ id: "crule_test" }] });
    expect(fixture.authenticateApiKey).toHaveBeenCalledWith(key);
    expect(fixture.effectiveRules).toHaveBeenCalledWith(fixture.ctx);
    expect(fixture.getWebContext).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("accepts hive OAuth through the shared validator with the hive scope and resource", async () => {
    const response = await effective(
      request(undefined, { Authorization: "Bearer valid-oauth" }),
    );
    expect(response.status).toBe(200);
    expect(fixture.requireMcpAuth).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      { resource: "https://hive.example/api/mcp", requiredScopes: ["hive"] },
    );
    expect(fixture.memberContext).toHaveBeenCalledWith(
      fixture.ctx.memberId,
      fixture.ctx.teamId,
    );
  });
  it.each([undefined, "Bearer invalid", `Bearer hm_${"b".repeat(43)}`])(
    "rejects missing, invalid or revoked bearer %s despite a web cookie",
    async (authorization) => {
      const response = await effective(
        request(undefined, {
          Cookie: "hm_session=fixture",
          ...(authorization ? { Authorization: authorization } : {}),
        }),
      );
      expect(response.status).toBe(401);
      expect(fixture.effectiveRules).not.toHaveBeenCalled();
      expect(fixture.getWebContext).not.toHaveBeenCalled();
    },
  );
  it("rejects OAuth for a removed or mismatched membership", async () => {
    fixture.memberContext.mockResolvedValue(null);
    expect(
      (
        await effective(
          request(undefined, { Authorization: "Bearer valid-oauth" }),
        )
      ).status,
    ).toBe(403);
    expect(fixture.effectiveRules).not.toHaveBeenCalled();
  });
});

describe("capture rule cookie routes", () => {
  it("saves web provenance and the original confirmed description", async () => {
    await create(
      request({
        ...input,
        source: "mcp",
        naturalText: "Exclude repos outside our work owners.",
      }),
    );
    expect(fixture.createCaptureRule).toHaveBeenCalledWith(fixture.ctx, {
      ...input,
      naturalText: "Exclude repos outside our work owners.",
    });
  });
  it("requires a reason and explicit reversal, and preserves admin-only enforcement", async () => {
    expect(
      (await reverse(request({ reason: "Review completed" }), params)).status,
    ).toBe(400);
    expect(
      (await reverse(request({ reason: " ", confirmed: true }), params)).status,
    ).toBe(400);
    expect(fixture.reverseCaptureRuleApplication).not.toHaveBeenCalled();
    expect(
      (
        await reverse(
          request({ reason: "Review completed", confirmed: true }),
          params,
        )
      ).status,
    ).toBe(200);
    expect(fixture.reverseCaptureRuleApplication).toHaveBeenCalledWith(
      fixture.ctx,
      "crule_test",
      "Review completed",
    );
    fixture.reverseCaptureRuleApplication.mockRejectedValueOnce(
      Object.assign(new Error("A team admin is needed."), { status: 403 }),
    );
    expect(
      (
        await reverse(
          request({ reason: "Review completed", confirmed: true }),
          params,
        )
      ).status,
    ).toBe(403);
  });

  it("rejects every settings route without a cookie session, even with a bearer", async () => {
    fixture.getWebContext.mockResolvedValue(null);
    const routes = [
      () => list(),
      () => create(request(input, { Authorization: `Bearer ${key}` })),
      () => update(request(input), params),
      () => remove(request(), params),
      () => propose(request({ text: "Avoid private repos" })),
      () => preview(request({}), params),
      () => apply(request({ token: "preview_test", confirmed: true }), params),
      () => history(),
      () =>
        reverse(
          request({ reason: "Review completed", confirmed: true }),
          params,
        ),
      () => confirmFlagged(request({ confirmed: true }), params),
    ];
    for (const route of routes) expect((await route()).status).toBe(401);
    expect(fixture.createCaptureRule).not.toHaveBeenCalled();
    expect(fixture.applyCaptureRule).not.toHaveBeenCalled();
  });
  it("creates and edits typed rules and rejects an invalid owner list", async () => {
    expect((await create(request(input))).status).toBe(201);
    expect(fixture.createCaptureRule).toHaveBeenCalledWith(fixture.ctx, input);
    expect((await update(request(input), params)).status).toBe(200);
    expect(fixture.updateCaptureRule).toHaveBeenCalledWith(
      fixture.ctx,
      "crule_test",
      input,
    );
    fixture.createCaptureRule.mockClear();
    expect((await create(request({ ...input, owners: [] }))).status).toBe(400);
    expect(fixture.createCaptureRule).not.toHaveBeenCalled();
  });
  it("returns a proposal without saving and passes the authenticated team and member", async () => {
    const response = await propose(request({ text: "Avoid private repos" }));
    expect(response.status).toBe(200);
    expect(fixture.proposeRuleFromText).toHaveBeenCalledWith(
      "team_test",
      "member_test",
      "Avoid private repos",
    );
    expect(fixture.createCaptureRule).not.toHaveBeenCalled();
    expect((await propose(request({ text: " " }))).status).toBe(400);
  });
  it("passes a bounded batch cursor and rejects malformed cursors", async () => {
    const cursor = "lrn_abcdefghijkl";
    expect((await preview(request({ cursor }), params)).status).toBe(200);
    expect(fixture.previewCaptureRule).toHaveBeenCalledWith(
      fixture.ctx,
      "crule_test",
      cursor,
    );
    fixture.previewCaptureRule.mockClear();
    expect((await preview(request({ cursor: "wrong" }), params)).status).toBe(
      400,
    );
    expect(fixture.previewCaptureRule).not.toHaveBeenCalled();
  });
  it("previews the authenticated member's rule and requires explicit apply confirmation", async () => {
    const response = await preview(request({}), params);
    expect(await response.json()).toMatchObject({
      count: 3,
      scanned: 500,
      truncated: true,
    });
    expect(
      (await apply(request({ token: "preview_test" }), params)).status,
    ).toBe(400);
    expect(fixture.applyCaptureRule).not.toHaveBeenCalled();
    expect(
      (await apply(request({ token: "preview_test", confirmed: true }), params))
        .status,
    ).toBe(200);
    expect(fixture.applyCaptureRule).toHaveBeenCalledWith(
      fixture.ctx,
      "crule_test",
      "preview_test",
    );
  });
  it("requires explicit sharing confirmation before calling the owner-guarded backend", async () => {
    expect((await confirmFlagged(request({}), params)).status).toBe(400);
    expect(fixture.confirmFlaggedCapture).not.toHaveBeenCalled();
    expect(
      (await confirmFlagged(request({ confirmed: true }), params)).status,
    ).toBe(200);
    expect(fixture.confirmFlaggedCapture).toHaveBeenCalledWith(
      fixture.ctx,
      "crule_test",
    );
  });
  it("reads history for members and hides admin controls when admin guard rejects", async () => {
    fixture.requireAdmin.mockRejectedValue(
      Object.assign(new Error("Only an admin."), { status: 403 }),
    );
    expect(await (await list()).json()).toMatchObject({
      isAdmin: false,
      rules: [],
    });
    expect((await history()).status).toBe(200);
    expect(fixture.listCaptureRuleApplications).toHaveBeenCalledWith(
      fixture.ctx,
    );
  });
  it("preserves backend permission and stale-preview failures", async () => {
    fixture.updateCaptureRule.mockRejectedValueOnce(
      Object.assign(new Error("Only a team admin can change this rule."), {
        status: 403,
      }),
    );
    expect((await update(request(input), params)).status).toBe(403);
    fixture.applyCaptureRule.mockRejectedValueOnce(
      Object.assign(new Error("Preview it again."), { status: 409 }),
    );
    const response = await apply(
      request({ token: "preview_test", confirmed: true }),
      params,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Preview it again." });
  });
});
