import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as effective } from "./effective/route";
import { GET as list, POST as create } from "./route";
import { PATCH as update, DELETE as remove } from "./[id]/route";
import { POST as instruct } from "./propose/route";
import { POST as undo } from "./undo/route";
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
    latest: vi.fn(async () => [{id: "cinstr_test", rule_id: "crule_test"}]),
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
    setCaptureRuleFromText: vi.fn(
      async (_ctx: unknown, _text: string, _context: unknown) => ({
        status: "saved" as "saved" | "question" | "undone",
        restatement: "Exclude personal repos.",
        question: undefined as string | undefined,
        counts: {
          scanned: 10,
          matched: 3,
          applied: 2,
          skipped: 1,
          restored: 0,
          retained: 0,
          pending: true,
        },
        undoUntil: "2026-10-13T11:00:00Z",
      }),
    ),
    undoCaptureRuleInstruction: vi.fn(async () => ({
      status: "undone",
      restatement: "Removed your latest rule.",
      counts: {
        scanned: 3,
        matched: 3,
        applied: 0,
        skipped: 0,
        restored: 2,
        retained: 1,
        pending: false,
      },
    })),
    confirmFlaggedCapture: vi.fn(async () => ({ id: "lrn_test" })),
  };
});
vi.mock("@/server/db/client", () => ({getSql: () => fixture.latest}));
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
  effectiveRules: fixture.effectiveRules,
  listCaptureRules: fixture.listCaptureRules,
  createCaptureRule: fixture.createCaptureRule,
  updateCaptureRule: fixture.updateCaptureRule,
  deleteCaptureRule: fixture.deleteCaptureRule,
  confirmFlaggedCapture: fixture.confirmFlaggedCapture,
}));
vi.mock("@/server/capture-rule-instructions", () => ({
  setCaptureRuleFromText: fixture.setCaptureRuleFromText,
  undoCaptureRuleInstruction: fixture.undoCaptureRuleInstruction,
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
  fixture.latest.mockResolvedValue([{id: "cinstr_test", rule_id: "crule_test"}]);
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
  it("saves web provenance and the original description", async () => {
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
  it("rejects every settings route without a cookie session, even with a bearer", async () => {
    fixture.getWebContext.mockResolvedValue(null);
    const routes = [
      () => list(),
      () => create(request(input, { Authorization: `Bearer ${key}` })),
      () => update(request(input), params),
      () => remove(request(), params),
      () => instruct(request({ text: "Avoid private repos" })),
      () => undo(request({ruleId: "crule_test"})),
      () => confirmFlagged(request({ confirmed: true }), params),
    ];
    for (const route of routes) expect((await route()).status).toBe(401);
    expect(fixture.createCaptureRule).not.toHaveBeenCalled();
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
  it("saves text directly with the caller context and passes automatic apply counts", async () => {
    const response = await instruct(
      request({
        text: "  Avoid private repos  ",
        source: "slack",
        memberId: "someone_else",
      }),
    );
    expect(response.status).toBe(200);
    expect(fixture.setCaptureRuleFromText).toHaveBeenCalledWith(
      fixture.ctx,
      "For my agents only: Avoid private repos",
      { source: "web" },
    );
    expect(await response.json()).toMatchObject({
      status: "saved",
      restatement: "Exclude personal repos.",
      counts: {
        scanned: 10,
        matched: 3,
        applied: 2,
        skipped: 1,
        pending: true,
      },
    });
    expect(fixture.createCaptureRule).not.toHaveBeenCalled();
  });
  it("returns a missing-detail question and supports a subsequent reply", async () => {
    fixture.setCaptureRuleFromText.mockResolvedValueOnce({
      status: "question",
      restatement: "Exclude repos outside work.",
      question: "Which repository owner?",
      counts: {
        scanned: 0,
        matched: 0,
        applied: 0,
        skipped: 0,
        restored: 0,
        retained: 0,
        pending: false,
      },
      undoUntil: "",
    });
    const response = await instruct(
      request({ text: "Exclude repos outside work" }),
    );
    expect(await response.json()).toMatchObject({
      status: "question",
      question: "Which repository owner?",
    });
    await instruct(request({ text: "team" }));
    expect(fixture.setCaptureRuleFromText).toHaveBeenLastCalledWith(
      fixture.ctx,
      "For my agents only: team",
      { source: "web" },
    );
  });
  it.each([" ", "a".repeat(4001)])(
    "rejects invalid instruction text without saving",
    async (text) => {
      expect((await instruct(request({ text }))).status).toBe(400);
      expect(fixture.setCaptureRuleFromText).not.toHaveBeenCalled();
    },
  );
  it("passes typed undo to the shared undo service", async () => {
    const response = await instruct(request({text: "undo"}));
    expect(fixture.undoCaptureRuleInstruction).toHaveBeenCalledWith(fixture.ctx, {source: "web"});
    expect(fixture.setCaptureRuleFromText).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({status: "undone", counts: {restored: 2}});
  });
  it("undoes the caller's latest web instruction without a confirmation or client-selected id", async () => {
    const response = await undo(request({ruleId: "crule_test"}));
    expect(response.status).toBe(200);
    expect(fixture.undoCaptureRuleInstruction).toHaveBeenCalledWith(
      fixture.ctx,
      { source: "web" },
      "cinstr_test",
    );
    expect(await response.json()).toMatchObject({
      status: "undone",
      counts: { restored: 2, retained: 1 },
    });
  });
  it("preserves undo expiry and direct-save permission failures", async () => {
    fixture.undoCaptureRuleInstruction.mockRejectedValueOnce(
      Object.assign(new Error("The undo window has expired."), { status: 409 }),
    );
    expect((await undo(request({ruleId: "crule_test"}))).status).toBe(409);
    fixture.setCaptureRuleFromText.mockRejectedValueOnce(
      Object.assign(new Error("A team admin is needed."), { status: 403 }),
    );
    expect(
      (await instruct(request({ text: "Exclude all team private repos" })))
        .status,
    ).toBe(403);
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
  it("hides admin controls when the admin guard rejects", async () => {
    fixture.requireAdmin.mockRejectedValue(Object.assign(new Error("Only an admin."), {status: 403}));
    expect(await (await list()).json()).toMatchObject({isAdmin: false, rules: []});
  });
  it("rejects team instructions before model work for a member", async () => {
    fixture.requireAdmin.mockRejectedValueOnce(Object.assign(new Error("Only an admin."), {status: 403}));
    expect((await instruct(request({text: "Avoid wayfarer", scope: "team"}))).status).toBe(403);
    expect(fixture.setCaptureRuleFromText).not.toHaveBeenCalled();
  });
  it("adds the team context to a sentence without a second step", async () => {
    expect((await instruct(request({text: "never keep anything from the wayfarer repo", scope: "team"}))).status).toBe(200);
    expect(fixture.setCaptureRuleFromText).toHaveBeenCalledWith(fixture.ctx, "For the whole team: never keep anything from the wayfarer repo", {source: "web"});
  });
  it("refuses Undo for an older result rather than undoing a newer action", async () => {
    fixture.latest.mockResolvedValueOnce([{id: "cinstr_new", rule_id: "crule_new"}]);
    expect((await undo(request({ruleId: "crule_test"}))).status).toBe(409);
    expect(fixture.undoCaptureRuleInstruction).not.toHaveBeenCalled();
  });
});
