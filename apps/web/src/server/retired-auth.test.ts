import { describe, expect, it, vi } from "vitest";
import { enabledSignInProviders } from "@/lib/auth-providers";
import { authHandler } from "./auth-handler";
vi.mock("server-only", () => ({}));

it("offers only configured human providers even when retired credentials remain in the environment", () => {
  expect(enabledSignInProviders({ GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture", SLACK_CLIENT_ID: "fixture", SLACK_CLIENT_SECRET: "fixture", AGENTID_CLIENT_ID: "fixture", AGENTID_CLIENT_SECRET: "fixture" })).toEqual(["google", "slack"]);
});

describe.each(["/api/auth/agentid/start", "/api/auth/agentid/anything", "/api/auth/callback/agentid"])("retired endpoint %s", path => {
  it.each(["GET", "POST"])("returns 404 for %s without starting authentication", async method => {
    const response = await authHandler(new Request(`https://hive.example${path}`, { method }));
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
