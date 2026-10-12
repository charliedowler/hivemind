import { afterEach, describe, expect, it, vi } from "vitest";
import { pageBeacon, learningBeacon, clientBeacon } from "./beacons";
import { withOrigin, originFor, type EventRow } from "./events";
const ctx = {
  teamId: "team_aaaaaaaaaaaa",
  memberId: "mem_aaaaaaaaaaaa",
  teamName: "Fixture",
  memberName: "Fixture",
};
const auth = vi.hoisted(() => ({
  web: vi.fn(),
  key: vi.fn(),
  learning: vi.fn(),
}));
vi.mock("../auth", () => ({
  getWebContext: auth.web,
  authenticateApiKey: auth.key,
}));
vi.mock("../bearer-auth", () => ({
  withHiveBearerAuth: async (request: Request, handler: Function) => {
    const ctx = await auth.key();
    return ctx ? handler(request, ctx) : new Response(null, { status: 401 });
  },
}));
vi.mock("../hive", () => ({ getLearning: auth.learning }));
vi.mock("../identity/rate-limit", () => ({ rateLimit: vi.fn() }));
afterEach(() => vi.resetAllMocks());
function request(
  path: string,
  body: unknown,
  origin = "http://localhost:3017",
) {
  return new Request(`http://localhost:3017${path}`, {
    method: "POST",
    headers: { origin, authorization: "Bearer fixture" },
    body: JSON.stringify(body),
  });
}
describe("analytics beacons", () => {
  it("records only allowed page names and strips client-supplied identity and text", async () => {
    auth.web.mockResolvedValue(ctx);
    const rows: EventRow[] = [];
    await withOrigin(
      originFor(ctx),
      async () => {
        expect(
          (
            await pageBeacon(
              request("/api/analytics/page", {
                page: "landing",
                teamId: "other",
                query: "private",
              }),
            )
          ).status,
        ).toBe(204);
        expect(
          (
            await pageBeacon(
              request("/api/analytics/page", { page: "account" }),
            )
          ).status,
        ).toBe(400);
        expect(
          (
            await pageBeacon(
              request(
                "/api/analytics/page",
                { page: "landing" },
                "https://elsewhere.invalid",
              ),
            )
          ).status,
        ).toBe(403);
      },
      async (row) => {
        rows.push(row);
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].team_id).toBe(ctx.teamId);
    expect(rows[0].properties.page).toBe("landing");
    expect(JSON.stringify(rows)).not.toContain("private");
  });
  it("requires a session for install and a readable team cell for a view", async () => {
    auth.web.mockResolvedValue(null);
    expect(
      (await pageBeacon(request("/api/analytics/page", { page: "install" })))
        .status,
    ).toBe(401);
    expect(
      (
        await learningBeacon(
          request("/api/app/analytics/view", {
            learningId: "lrn_aaaaaaaaaaaa",
          }),
        )
      ).status,
    ).toBe(401);
    auth.web.mockResolvedValue(ctx);
    auth.learning.mockResolvedValue(null);
    expect(
      (
        await learningBeacon(
          request("/api/app/analytics/view", {
            learningId: "lrn_aaaaaaaaaaaa",
          }),
        )
      ).status,
    ).toBe(404);
    auth.learning.mockResolvedValue({ id: "lrn_aaaaaaaaaaaa" });
    const rows: EventRow[] = [];
    await withOrigin(
      originFor(ctx),
      async () =>
        expect(
          (
            await learningBeacon(
              request("/api/app/analytics/view", {
                learningId: "lrn_aaaaaaaaaaaa",
              }),
            )
          ).status,
        ).toBe(204),
      async (row) => {
        rows.push(row);
      },
    );
    expect(rows[0].event_name).toBe("learning.viewed");
    expect(auth.learning).toHaveBeenCalledWith(ctx, "lrn_aaaaaaaaaaaa");
  });
  it("authenticates installer reports, hashes replay keys and refuses unknown steps", async () => {
    const body = {
      attemptId: "00000000-0000-4000-8000-000000000001",
      step: "doctor",
      outcome: "failed",
      agent: "codex",
      platform: "darwin",
      teamId: "other",
      terminal: "private",
    };
    auth.key.mockResolvedValue(null);
    expect(
      (await clientBeacon(request("/api/analytics/install", body), "install"))
        .status,
    ).toBe(401);
    auth.key.mockResolvedValue(ctx);
    const rows: EventRow[] = [];
    await withOrigin(
      originFor(ctx),
      async () => {
        expect(
          (
            await clientBeacon(
              request("/api/analytics/install", body),
              "install",
            )
          ).status,
        ).toBe(204);
        expect(
          (
            await clientBeacon(
              request("/api/analytics/install", body),
              "install",
            )
          ).status,
        ).toBe(204);
        expect(
          (
            await clientBeacon(
              request("/api/analytics/install", { ...body, step: "private" }),
              "install",
            )
          ).status,
        ).toBe(400);
      },
      async (row) => {
        rows.push(row);
      },
    );
    expect(rows[0].event_key).toBe(rows[1].event_key);
    expect(rows[0]).toMatchObject({
      team_id: ctx.teamId,
      member_id: ctx.memberId,
      entrypoint: "installer",
      reason_code: "doctor_failed",
    });
    expect(JSON.stringify(rows)).not.toContain("private");
  });
});
