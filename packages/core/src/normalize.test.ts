import { describe, expect, it } from "vitest";
import { normalizeRepo, normalizeTags, parseSince } from "./normalize";

describe("normalization", () => {
  it("normalizes GitHub URLs, suffixes and casing", () => {
    expect(normalizeRepo(" HTTPS://GitHub.com/Owner/Repo.git/ ")).toBe("owner/repo");
    expect(normalizeRepo("Owner/Repo")).toBe("owner/repo");
    expect(normalizeRepo(" ")).toBeNull();
    expect(normalizeRepo()).toBeNull();
  });
  it("makes unique nonempty kebab tags", () => {
    expect(normalizeTags([" Postgres SQL ", "postgres_sql", "---", "Auth", "AUTH"])).toEqual(["postgres-sql", "auth"]);
  });
});

describe("parseSince", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  it.each([['2h', 7200000], ['7d', 604800000], ['30m', 1800000], ['1w', 604800000]])("parses %s", (input, duration) => {
    expect(parseSince(input, now).getTime()).toBe(now.getTime() - duration);
  });
  it("parses ISO datetimes with offsets", () => {
    expect(parseSince("2026-10-12T13:00:00+01:00").toISOString()).toBe(now.toISOString());
  });
  it.each(["0h", "-1d", "tomorrow", "2026-10-12", "2026-99-99T00:00:00Z", "99999999999999999999999999999d"])("rejects %s", (input) => {
    expect(() => parseSince(input, now)).toThrow();
  });
});
