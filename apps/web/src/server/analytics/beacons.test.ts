import { afterEach, describe, expect, it, vi } from "vitest";
import { clientBeacon } from "./beacons";
import { withOrigin, originFor, type EventRow } from "./events";
const ctx = {
  teamId: "team_aaaaaaaaaaaa",
  memberId: "mem_aaaaaaaaaaaa",
  teamName: "Fixture",
  memberName: "Fixture",
};
const auth = vi.hoisted(() => ({
  key: vi.fn(),
}));
vi.mock("../auth", () => ({
  authenticateApiKey: auth.key,
}));
vi.mock("../bearer-auth", () => ({
  withHiveBearerAuth: async (request: Request, handler: Function) => {
    const ctx = await auth.key();
    return ctx ? handler(request, ctx) : new Response(null, { status: 401 });
  },
}));
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
