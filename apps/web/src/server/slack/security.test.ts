import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import {
  verifySlack,
  encryptBotToken,
  decryptBotToken,
  sameOrigin,
} from "./security";
import { indexable } from "./client";
afterEach(() => vi.unstubAllEnvs());
describe("Slack trust boundaries", () => {
  it("verifies the exact raw body and rejects replay or tampering", () => {
    const body = '{"type":"url_verification","challenge":"test"}',
      secret = "test-signing",
      now = 1800000000000,
      ts = String(now / 1000);
    const headers = new Headers({
      "x-slack-request-timestamp": ts,
      "x-slack-signature":
        "v0=" +
        createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex"),
    });
    expect(verifySlack(body, headers, secret, now)).toBe(true);
    expect(verifySlack(body + " ", headers, secret, now)).toBe(false);
    expect(verifySlack(body, headers, secret, now + 301000)).toBe(false);
    expect(verifySlack(body, new Headers(), secret, now)).toBe(false);
  });
  it("encrypts tokens and binds their ciphertext to the team and workspace", () => {
    vi.stubEnv(
      "SLACK_TOKEN_ENCRYPTION_KEY",
      randomBytes(32).toString("base64"),
    );
    const cipher = encryptBotToken("synthetic-token", "team-a", "workspace-a");
    expect(cipher).not.toContain("synthetic-token");
    expect(decryptBotToken(cipher, "team-a", "workspace-a")).toBe(
      "synthetic-token",
    );
    expect(() => decryptBotToken(cipher, "team-b", "workspace-a")).toThrow();
    expect(() => decryptBotToken(cipher, "team-a", "workspace-b")).toThrow();
  });
  it("refuses settings writes from another origin", () => {
    vi.stubEnv("PUBLIC_URL", "https://gohive.dev");
    expect(() =>
      sameOrigin(
        new Request("https://gohive.dev/api/app/slack", {
          headers: { origin: "https://other.test" },
        }),
      ),
    ).toThrow();
    expect(() =>
      sameOrigin(
        new Request("https://gohive.dev/api/app/slack", {
          headers: { origin: "https://gohive.dev" },
        }),
      ),
    ).not.toThrow();
  });
  it("requires membership and excludes every DM type", () => {
    const channel = {
      id: "C123",
      name: "test",
      is_member: true,
      is_private: false,
      is_im: false,
      is_mpim: false,
      is_archived: false,
    };
    expect(indexable(channel)).toBe(true);
    for (const patch of [
      { is_member: false },
      { is_im: true },
      { is_mpim: true },
      { is_archived: true },
    ])
      expect(indexable({ ...channel, ...patch })).toBe(false);
    expect(indexable({ ...channel, is_private: true })).toBe(true);
  });
});
