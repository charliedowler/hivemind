import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ social: vi.fn() }));
vi.mock("@/server/better-auth", () => ({
  getAuth: async () => ({ api: { signInSocial: mocks.social } }),
}));
vi.mock("@/lib/auth-providers", () => ({
  enabledSignInProviders: () => ["agentid"],
}));
import { GET } from "./route";
it("forwards a bounded label and preserves every OAuth continuation field", async () => {
  const headers = new Headers();
  headers.append("Set-Cookie", "test=opaque; HttpOnly");
  mocks.social.mockResolvedValue({
    headers,
    response: { url: "https://auth.agentid.com/authorize" },
  });
  const query = new URLSearchParams({
    client_id: "client",
    redirect_uri: "http://localhost/callback",
    state: "opaque-state",
    code_challenge: "pkce",
    code_challenge_method: "S256",
    scope: "hive:person offline_access",
    login_hint: "inbox@agentmail.to",
    agent_name: "\u0000Codex " + "x".repeat(100),
  });
  expect(
    (
      await GET(
        new Request(`https://gohive.dev/api/auth/agentid/start?${query}`),
      )
    ).status,
  ).toBe(302);
  const { body } = mocks.social.mock.calls[0][0];
  const callback = new URL(body.callbackURL, "https://gohive.dev");
  for (const key of [
    "client_id",
    "redirect_uri",
    "state",
    "code_challenge",
    "code_challenge_method",
    "scope",
  ])
    expect(callback.searchParams.get(key)).toBe(query.get(key));
  expect(callback.searchParams.has("login_hint")).toBe(false);
  expect(callback.searchParams.has("agent_name")).toBe(false);
  expect(body.loginHint).toBe("inbox@agentmail.to");
  expect(body.additionalData.hiveAgentName.length).toBe(80);
  expect(body.additionalData.hiveAgentName).not.toContain("\u0000");
});
