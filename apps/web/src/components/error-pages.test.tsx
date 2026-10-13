import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotFound from "@/app/not-found";
import { AuthErrorPage } from "@/components/auth-error-page";
import { ErrorBoundary } from "@/components/error-boundary";
import { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } from "@/app/api/[...path]/route";
import { POST as errorBeacon } from "@/app/api/analytics/error/route";
import { browserAuthResponse } from "@/server/auth-error-response";

vi.mock("@/lib/measurement-consent", () => ({ useMeasurementConsent: () => false }));
vi.mock("@/app/app/actions", () => ({ signOutAndContinue: vi.fn() }));

const mocks = vi.hoisted(() => ({ session: vi.fn(), recordEvent: vi.fn() }));
vi.mock("@/server/auth", () => ({ getWebContext: mocks.session }));
vi.mock("@/server/analytics/events", () => ({ recordEvent: mocks.recordEvent, nativeOrigin: () => ({ entrypoint: "web" }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue(null); });

describe("error pages", () => {
  it("renders a branded 404 with working public destinations", async () => {
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain("That page is not here.");
    expect(html).toContain("Hive");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/app/login"');
    expect(html).toContain('Install Hive');
  });
  it("links signed-in people to the dashboard", async () => {
    mocks.session.mockResolvedValue({});
    expect(renderToStaticMarkup(await NotFound())).toContain('href="/app"');
  });
  it("still renders a 404 when session storage is unavailable", async () => {
    mocks.session.mockRejectedValue(new Error("storage unavailable"));
    expect(renderToStaticMarkup(await NotFound())).toContain("That page is not here.");
  });
  it("shows a digest without exposing the exception message", () => {
    const error = Object.assign(new Error("private internal detail"), { digest: "123456" });
    const html = renderToStaticMarkup(<ErrorBoundary error={error} reset={vi.fn()} />);
    expect(html).toContain("Something went wrong on our side.");
    expect(html).toContain("Reference: 123456");
    expect(html).toContain("Try again");
    expect(html).not.toContain("private internal detail");
  });
  it.each(["state_mismatch", "access_denied", "connection_expired", "invite_expired", "domain_not_allowed", "email_not_verified", "key_revoked", "unknown_org"])("gives %s a reason and a next step", (reason) => {
    const html = renderToStaticMarkup(<AuthErrorPage reason={reason} />);
    expect(html).toContain("error-card");
    expect(html).not.toContain("Sign-in could not finish.");
    expect(html).toContain('class="error-actions"');
  });
  it("does not echo arbitrary callback error text", () => {
    expect(renderToStaticMarkup(<AuthErrorPage reason="secret-from-query" />)).not.toContain("secret-from-query");
  });
  it.each(["unknown_org", "access_changed"])("lets %s sign out without a deleted page", (reason) => {
    const html = renderToStaticMarkup(<AuthErrorPage reason={reason} />);
    expect(html).toContain("<form");
    expect(html).toContain(">Sign out</button>");
    expect(html).not.toContain("/app/switch-account");
  });
  it.each([GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS])("returns JSON for unknown API paths", async (handler) => {
    const response = handler();
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "not_found" });
  });
  it("redirects browser auth errors without forwarding state or tokens", async () => {
    const request = new Request("https://example.test/api/auth/callback/test?state=private", { headers: { accept: "text/html" } });
    const response = await browserAuthResponse(request, Response.json({ code: "state_mismatch" }, { status: 400 }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://example.test/app/auth-error?error=state_mismatch");
  });
  it("preserves JSON OAuth errors for clients", async () => {
    const response = Response.json({ error: "invalid_grant" }, { status: 400 });
    expect(await browserAuthResponse(new Request("https://example.test/api/auth/oauth2/token", { method: "POST" }), response)).toBe(response);
  });
  it("records only route and digest", async () => {
    const response = await errorBeacon(new Request("https://example.test/api/analytics/error", { method: "POST", headers: { origin: "https://example.test" }, body: JSON.stringify({ route: "/missing", digest: "123" }) }));
    expect(response.status).toBe(204);
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "error.page_shown", properties: { route: "/missing", digest: "123" } }));
  });
  it.each([{ route: "/auth?state=secret", digest: "123" }, { route: "/auth", digest: "123", message: "secret" }])("rejects sensitive extra data", async (body) => {
    const response = await errorBeacon(new Request("https://example.test/api/analytics/error", { method: "POST", headers: { origin: "https://example.test" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(400);
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });
  it("rejects cross-origin beacons", async () => {
    const response = await errorBeacon(new Request("https://example.test/api/analytics/error", { method: "POST", headers: { origin: "https://other.test" }, body: "{}" }));
    expect(response.status).toBe(403);
  });
});
