import { describe, expect, it } from "vitest";
import { gateCapturePrivacy, redactSecrets, capturePrivacyMessage } from "./capture-privacy.mjs";
import { captureRuleInputSchema, type CaptureRule } from "./capture-rules";

describe("local capture privacy gate", () => {
  it.each([
    "password: example-only-password",
    "PASSWORD=example-only-password",
    '"password": "example-only-password"',
    "The service password is example-only-password.",
    "client_secret = 'example-only-secret'",
    "api key: example-only-key",
    "password = `example-only-password`",
    "token=example-only-token",
    "Authorization: Bearer example-only-bearer",
    "-----BEGIN PRIVATE KEY-----\nexample-only-key\n-----END PRIVATE KEY-----",
    "-----BEGIN ENCRYPTED PRIVATE KEY-----\nexample-only-key",
    "mysql://fixture:example-only-password@localhost/test",
    "mongodb+srv://fixture:example-only-password@localhost/test",
    "Cookie: sid=example-only-session; other=example-only-cookie",
    "Set-Cookie: sid=example-only-session; HttpOnly",
    "session_id=example-only-session",
    "refresh_token=example-only-refresh",
    `ghp_${"a".repeat(25)}`,
  ])("refuses when the secret is the fact: %s", body => {
    const result = gateCapturePrivacy({title: "Saved credential", body});
    expect(result).toMatchObject({action: "refuse", category: "credentials", reason: "secret_only", message: capturePrivacyMessage});
    expect(result).not.toHaveProperty("input");
    expect(JSON.stringify(result)).not.toContain(body);
    expect(redactSecrets(body).text).not.toContain("example-only-");
  });

  it.each([
    "alex@example.com has a medical appointment.",
    "Alex's phone is +1 (202) 555-0143.",
    "Alex's phone number is 07700 900123.",
    "Call +44 7700 900123.",
    "Call 2025550143.",
    "Alex lives at 123 Example Street.",
    "The mailing address is 321 Example Road.",
    "SSN: 123-45-6789",
    "national id: EX1234567",
    "National insurance: AB 12 34 56 C",
    "Card: 4111 1111 1111 1111",
    "Alex has diabetes.",
    "Alex is recovering from surgery.",
    "The schema has medical fields. Alex has diabetes.",
    "Alex is vegan.",
    "alex is vegan.",
    "Alex Morgan avoids peanuts.",
    "Alex's dietary requirements are private.",
    "Alex's daughter starts school this month.",
    "My wife works from our home.",
    "Alex has two children.",
    "Alex is married.",
  ])("refuses personal facts without returning their text: %s", body => {
    const result = gateCapturePrivacy({title: "Work finding", body, repo: "fixture/service"});
    expect(result).toMatchObject({action: "refuse", category: "personal_info"});
    expect(result).not.toHaveProperty("input");
    expect(JSON.stringify(result)).not.toContain(body);
  });

  it.each([
    "Example Customer at customer.example.com sent a private account record.",
    "customer_id=example-123",
    '"tenant_id": "example-tenant"',
    "customer data: account=example-123, balance=42",
    "customer_id,name,balance\nexample-123,Example Customer,42",
    "A private customer communication included a receipt.",
  ])("refuses customer identifiers and records: %s", body => {
    expect(gateCapturePrivacy({title: "Work finding", body})).toMatchObject({action: "refuse", category: "customer_data"});
  });

  it("uses effective exclusions and explicit known customer names without sending them to a model", () => {
    const rule = {...captureRuleInputSchema.parse({name: "Customer exclusion", kind: "keyword", pattern: "Example Company", action: "drop"}), id: "crule_fixture"} as CaptureRule;
    expect(gateCapturePrivacy({body: "The EXAMPLE COMPANY query timed out."}, {rules: [rule]})).toMatchObject({action: "refuse", reason: "customer_name"});
    expect(gateCapturePrivacy({body: "The Example Company query timed out."}, {customerNames: ["Example Company"]})).toMatchObject({action: "refuse", reason: "customer_name"});
    const natural = {...rule, kind: "content_category", category: "customer_data", naturalText: 'Exclude customer "Example Organisation".'} as CaptureRule;
    expect(gateCapturePrivacy({body: "Example Organisation uses the parser."}, {rules: [natural]})).toMatchObject({action: "refuse", reason: "customer_name"});
    expect(gateCapturePrivacy({body: "Example CompanySuffix uses the parser."}, {rules: [rule]}).action).toBe("allow");
  });

  it.each([
    "The code requires PASSWORD and API_KEY environment variables.",
    "Set PASSWORD=${PASSWORD} in the config.",
    "The stored password is [redacted].",
    "Authorization: Bearer [redacted]",
    "The parser validates email addresses and phone numbers.",
    "The schema supports dietary preferences and medical appointment fields.",
    "The schema has medical appointment fields.",
    "Fix the generic customer record parser.",
    "The fixture reads process.env.PASSWORD in tests/auth.test.ts.",
  ])("allows safe code discussion: %s", body => {
    expect(gateCapturePrivacy({title: "Code finding", body, remote: "git@github.com:fixture/service.git"})).toMatchObject({action: "allow", redactionCount: 0});
  });

  it("redacts a test fixture password while retaining the useful repo finding", () => {
    const input = {title: "Auth fixture", body: 'tests/auth.test.ts uses password: "dummy-password" to test the parser.', evidence: {command_output: "The parser test uses PASSWORD=another-dummy-password"}};
    const result = gateCapturePrivacy(input);
    expect(result.action).toBe("redact");
    if (result.action === "refuse") return;
    expect(result.input.body).toContain('password: "[redacted]"');
    expect(result.input.evidence.command_output).toBe("The parser test uses PASSWORD=[redacted]");
    expect(JSON.stringify(result)).not.toContain("dummy-password");
    expect(input.body).toContain("dummy-password");
    expect(gateCapturePrivacy(result.input).action).toBe("allow");
  });

  it("checks sidecars and all context fields even when categories claim they are safe", () => {
    for (const field of ["evidence", "paths", "tags", "sessionRef", "additionalText", "cwd"]) {
      const input = {title: "Parser finding", body: "The server parser rejects bad input.", categories: {personal_info: false}, [field]: ["alex@example.com"]};
      expect(gateCapturePrivacy(input)).toMatchObject({action: "refuse", category: "personal_info"});
    }
  });
});
