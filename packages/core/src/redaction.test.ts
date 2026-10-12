import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redaction";

describe("redactSecrets", () => {
  it.each([
    `sk-${"a".repeat(30)}`,
    `sk-ant-${"b".repeat(30)}`,
    `ghp_${"a".repeat(36)}`,
    `github_pat_${"b".repeat(50)}`,
    `xoxb-${"1".repeat(24)}`,
    `xoxa-${"1".repeat(24)}`,
    `xoxp-${"1".repeat(24)}`,
    `AKIA${"A".repeat(16)}`,
    `hm_${"a".repeat(43)}`,
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature123",
    "-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----",
    "-----BEGIN RSA PRIVATE KEY-----\nprivate\n-----END RSA PRIVATE KEY-----",
    "-----BEGIN EC PRIVATE KEY-----\nprivate\n-----END EC PRIVATE KEY-----",
  ])("redacts a supported secret shape", (secret) => {
    expect(redactSecrets(`before ${secret} after`)).toEqual({
      text: "before [redacted] after",
      count: 1,
    });
  });
  it.each(["postgres", "postgresql"])(
    "redacts only the %s password",
    (scheme) => {
      expect(redactSecrets(`${scheme}://user:p%40ss@host/db`)).toEqual({
        text: `${scheme}://user:[redacted]@host/db`,
        count: 1,
      });
    },
  );
  it("counts multiple secrets without counting the same token twice", () => {
    const result = redactSecrets(
      `sk-ant-${"a".repeat(30)} hm_${"b".repeat(43)}`,
    );
    expect(result).toEqual({ text: "[redacted] [redacted]", count: 2 });
    expect(redactSecrets(result.text).count).toBe(0);
  });
  it("preserves prose, hashes and UUIDs", () => {
    const text =
      "Use the sk prefix; commit 8c44f580c29614df3eb62c27ddb566f395cf7793 with 978a83e2-6b3c-40ea-864c-4cc1a7074f12.";
    expect(redactSecrets(text)).toEqual({ text, count: 0 });
  });
});
