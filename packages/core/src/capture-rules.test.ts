import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  captureRuleInputSchema,
  evaluateCaptureRules,
  captureInputLimit,
  capturePatternLimit,
  type CaptureRule,
} from "./index";
import { hivePushInput } from "./schemas";
import { evaluateCaptureRules as evaluateSharedCaptureRules } from "./capture-matchers.mjs";

function rule(input: Record<string, unknown>, id = "rule-1"): CaptureRule {
  return {
    ...captureRuleInputSchema.parse({ name: "Exclude content", action: "drop", ...input }),
    id,
    teamId: "team-1",
    memberId: "member-1",
    createdBy: "member-1",
    createdAt: "2026-10-13T00:00:00Z",
    updatedAt: "2026-10-13T00:00:00Z",
  };
}
const observation = { title: "A useful secret", body: "Keep this secret and SECRET private." };

describe("captureRuleInputSchema", () => {
  it.each([
    { kind: "repo_owner", owner: "team", mode: "only_allow" },
    { kind: "repo_match", pattern: "team/*" },
    { kind: "path_match", pattern: "**/.env" },
    { kind: "content_category", category: "credentials" },
    { kind: "agent_or_client", agent: "codex", sessionType: "headless" },
    { kind: "agent_or_client", sessionType: "headless" },
    { kind: "keyword", pattern: "secret" },
  ])("parses $kind with existing rules enabled by default", (input) => {
    expect(rule(input)).toMatchObject({ ...input, enabled: true, scope: "member" });
  });
  it("canonicalizes multiple repo owners and accepts legacy singular input", () => {
    expect(rule({ kind: "repo_owner", owners: ["Team", "Other", "team"], mode: "deny" })).toMatchObject({ owners: ["team", "other"] });
    expect(rule({ kind: "repo_owner", owner: "Team", mode: "deny" })).toMatchObject({ owners: ["team"] });
    expect(captureRuleInputSchema.safeParse({ name: "Rule", action: "drop", kind: "repo_owner", owners: [], mode: "deny" }).success).toBe(false);
  });
  it("exports a JSON schema for proposal tools", () => {
    expect(() => z.toJSONSchema(captureRuleInputSchema)).not.toThrow();
  });
  it("preserves rule provenance and defaults its source", () => {
    expect(rule({ kind: "keyword", pattern: "secret" }).source).toBe("web");
    expect(rule({ kind: "keyword", pattern: "secret", source: "slack", naturalText: "Exclude secrets" })).toMatchObject({ source: "slack", naturalText: "Exclude secrets", createdBy: "member-1" });
    expect(captureRuleInputSchema.safeParse({ name: "Rule", action: "drop", kind: "keyword", pattern: "secret", source: "other" }).success).toBe(false);
  });
  it("supplies keyword defaults and accepts team scope and disabled rules", () => {
    expect(rule({ kind: "keyword", pattern: "secret", enabled: false, scope: "team" })).toMatchObject({ regex: false, caseSensitive: false, enabled: false, scope: "team" });
  });
  it.each([
    { name: " " }, { name: "x".repeat(121) }, { scope: "global" }, { action: "allow" },
    { kind: "unknown" }, { kind: "repo_owner", owner: "team/repo", mode: "deny" },
    { kind: "repo_owner", owner: "team", mode: "allow" },
    { kind: "content_category", category: "other" },
    { kind: "keyword", pattern: "" },
    { kind: "keyword", pattern: "x".repeat(capturePatternLimit + 1) },
    { kind: "path_match", pattern: "{one,two}" },
    { kind: "path_match", pattern: "[ab]*" },
    { kind: "agent_or_client", agent: "" },
    { kind: "agent_or_client" },
    { kind: "agent_or_client", agent: "codex", sessionType: "" },
  ])("rejects invalid fields %j", (input) => {
    expect(captureRuleInputSchema.safeParse({ name: "Rule", action: "drop", kind: "keyword", pattern: "secret", ...input }).success).toBe(false);
  });
  it.each(["(a+)+$", "(a|aa)+$", "a+a+$", "a**", "a+?", "(?=secret)", "(secret)", "a\\1", "\\bsecret", "[a-", "a{99}", "a{2,1}", "a{1,}", ".*", "^$"])("rejects unsafe or unsupported regex %s", (pattern) => {
    expect(captureRuleInputSchema.safeParse({ name: "Rule", action: "drop", kind: "keyword", regex: true, pattern }).success).toBe(false);
  });
  it("treats unsafe regex syntax as literal text when regex is false", () => {
    expect(rule({ kind: "keyword", pattern: "(a+)+$" })).toMatchObject({ regex: false });
  });
});

describe("evaluateCaptureRules", () => {
  it("exports the shared plain Node matcher through core", () => {
    expect(evaluateCaptureRules).toBe(evaluateSharedCaptureRules);
  });
  it("allows unchanged captures without active matches", () => {
    expect(evaluateCaptureRules([rule({ kind: "keyword", pattern: "secret", enabled: false })], observation)).toEqual({ ...observation, action: "allow", flagged: false, redacted: false, matches: [], neededCategories: [] });
  });
  it.each([
    { repo: "Team/Repo" },
    { repo: "https://github.com/Team/Repo.git" },
    { remote: "https://user:password@git.example/Team/Repo.git/" },
    { remote: "git@github.com:Team/Repo.git" },
    { remote: "ssh://git@git.example:2222/Team/Repo.git" },
    { repo: "invalid", remote: "git@git.example:Team/Repo.git" },
  ])("derives the owner from %j", (metadata) => {
    expect(evaluateCaptureRules([rule({ kind: "repo_owner", owner: "TEAM", mode: "deny" })], { ...observation, ...metadata }).action).toBe("drop");
    expect(evaluateCaptureRules([rule({ kind: "repo_owner", owner: "TEAM", mode: "only_allow" })], { ...observation, ...metadata }).action).toBe("allow");
  });
  it("accepts any canonical owner for only_allow and deny", () => {
    for (const owner of ["team", "other"]) {
      expect(evaluateCaptureRules([rule({ kind: "repo_owner", owners: ["team", "other"], mode: "only_allow" })], { ...observation, repo: `${owner}/repo` }).action).toBe("allow");
      expect(evaluateCaptureRules([rule({ kind: "repo_owner", owners: ["team", "other"], mode: "deny" })], { ...observation, repo: `${owner}/repo` }).action).toBe("drop");
    }
  });
  it("prefers an explicit repo over a remote and does not confuse owner prefixes", () => {
    const denied = rule({ kind: "repo_owner", owner: "team", mode: "deny" });
    expect(evaluateCaptureRules([denied], { ...observation, repo: "team-other/repo", remote: "git@host:team/repo" }).action).toBe("allow");
  });
  it("only_allow excludes missing and unrelated owners; deny leaves missing owners alone", () => {
    const allowed = rule({ kind: "repo_owner", owner: "team", mode: "only_allow" });
    expect(evaluateCaptureRules([allowed], observation).action).toBe("drop");
    expect(evaluateCaptureRules([allowed], { ...observation, repo: "other/repo" }).action).toBe("drop");
    expect(evaluateCaptureRules([rule({ kind: "repo_owner", owner: "team", mode: "deny" })], observation).action).toBe("allow");
  });
  it("matches normalized repositories with safe globs", () => {
    const input = rule({ kind: "repo_match", pattern: "TEAM/re?o*" });
    expect(evaluateCaptureRules([input], { ...observation, remote: "git@host:team/repository.git" }).action).toBe("drop");
    expect(evaluateCaptureRules([input], { ...observation, repo: "other/repository" }).action).toBe("allow");
  });
  it.each([
    "https://github.com/Team/Repo.git",
    "git@github.com:Team/Repo.git",
    "ssh://git@git.example:2222/Team/Repo.git",
    "https://git.example/group/nested/Repo.git",
  ])("matches the exact remote string %s", (remote) => {
    const input = rule({ kind: "repo_match", pattern: remote });
    expect(evaluateCaptureRules([input], { ...observation, repo: "other/repo", remote }).action).toBe("drop");
    expect(evaluateCaptureRules([input], { ...observation, remote: remote.replace("Repo", "Other") }).action).toBe("allow");
    expect(evaluateCaptureRules([input], { ...observation, remote: remote.toLowerCase() }).action).toBe("allow");
    expect(evaluateCaptureRules([input], observation).action).toBe("allow");
  });
  it("matches wildcard remote URLs without ignoring URL case", () => {
    const input = rule({kind: "repo_match", pattern: "https://github.com/Team/*.git"});
    expect(evaluateCaptureRules([input], {...observation, remote: "https://github.com/Team/Repo.git"}).action).toBe("drop");
    expect(evaluateCaptureRules([input], {...observation, remote: "https://github.com/team/Repo.git"}).action).toBe("allow");
  });
  it.each([
    ["**/.env", ".env", true], ["**/.env", "app/.env", true],
    ["**/.env", "app/nested/.env", true], ["**/.env", "app/env", false],
    ["src/*.ts", "src/index.ts", true], ["src/*.ts", "src/nested/index.ts", false],
    ["src/**/*.ts", "src/index.ts", true], ["src/**/*.ts", "src/nested/index.ts", true],
    ["secret?.txt", "secret1.txt", true], ["secret?.txt", "secret12.txt", false],
    ["file.txt", "fileXtxt", false], ["private/**", "private/a/b", true],
    ["src/**/private/*.ts", "src/x/public/private/y/z.ts", false],
    ["src/**/private/*.ts", "src/x/private/z.ts", true],
    ["src/*.ts", "src\\index.ts", true],
  ])("matches path glob %s against %s: %s", (pattern, path, matches) => {
    expect(evaluateCaptureRules([rule({ kind: "path_match", pattern })], { ...observation, paths: [path] }).action).toBe(matches ? "drop" : "allow");
  });
  it("matches cwd and any path, with case-sensitive full path matches", () => {
    const input = rule({ kind: "path_match", pattern: "**/private/**" });
    expect(evaluateCaptureRules([input], { ...observation, cwd: "/work/private/project" }).action).toBe("drop");
    expect(evaluateCaptureRules([input], { ...observation, paths: ["public/file", "private/file"] }).action).toBe("drop");
    expect(evaluateCaptureRules([input], { ...observation, cwd: "/work/Private/project" }).action).toBe("allow");
  });
  it.each([
    { cwd: "/Users/person/personal/project" },
    { cwd: "/home/person/personal/project" },
    { cwd: "/root/personal/project" },
    { paths: ["/Users/person/personal/file.md"] },
    { paths: ["/home/person/personal/file.md"] },
    { paths: ["/root/personal/file.md"] },
    { paths: ["~/personal/file.md"] },
    { home: "/custom/person/", cwd: "/custom/person/personal/project" },
    { home: "/custom/person*", cwd: "/custom/person*/personal/project" },
    { home: "/custom/person", cwd: "/work/project", paths: ["/custom/person/personal/file.md"] },
    { cwd: "/home/person/work", paths: ["/home/person/personal/file.md"] },
  ])("resolves home-relative paths from capture metadata %j", (metadata) => {
    expect(evaluateCaptureRules([rule({ kind: "path_match", pattern: "~/personal/**" })], { ...observation, ...metadata }).action).toBe("drop");
  });
  it.each([
    { cwd: "/Users-other/person/personal/project" },
    { cwd: "/root-other/personal/project" },
    { cwd: "/Users/person/../other/personal/project" },
    { cwd: "/Users/person/work", paths: ["/Users/other/personal/file.md"] },
    { home: "/home/other", cwd: "/home/person/personal/project" },
    { home: "/custom/person*", cwd: "/custom/person-other/personal/project" },
    { home: "relative/home", cwd: "/home/person/personal/project" },
    { home: "/home/../person", cwd: "/home/person/personal/project" },
    { home: "/", cwd: "/personal/project" },
    { cwd: "/work/personal/project", paths: null },
    { cwd: null, home: null, paths: null },
  ])("does not derive an unrelated or unsafe home %j", (metadata) => {
    expect(evaluateCaptureRules([rule({ kind: "path_match", pattern: "~/personal/**" })], { ...observation, ...metadata }).action).toBe("allow");
  });
  it("never expands a capture path using the server process home", () => {
    vi.stubEnv("HOME", "/server/account");
    try {
      expect(evaluateCaptureRules([rule({ kind: "path_match", pattern: "~/personal/**" })], { ...observation, cwd: "/server/account/personal/project" }).action).toBe("allow");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("matches agents and optionally session type without matching missing metadata", () => {
    const input = rule({ kind: "agent_or_client", agent: "CODEX", sessionType: "headless" });
    expect(evaluateCaptureRules([input], { ...observation, agent: "codex", sessionType: "HEADLESS" }).action).toBe("drop");
    expect(evaluateCaptureRules([input], { ...observation, agent: "codex", sessionType: "interactive" }).action).toBe("allow");
    expect(evaluateCaptureRules([input], { ...observation, agent: "other", sessionType: "headless" }).action).toBe("allow");
    expect(evaluateCaptureRules([input], { ...observation, agent: "codex" }).action).toBe("allow");
    expect(evaluateCaptureRules([input], { ...observation, sessionType: "headless" }).action).toBe("allow");
    expect(evaluateCaptureRules([input], observation).action).toBe("allow");
    expect(evaluateCaptureRules([rule({ kind: "agent_or_client", agent: "codex" })], { ...observation, agent: "codex" }).action).toBe("drop");
  });
  it("supports session-only predicates without requiring agent metadata", () => {
    const input = rule({ kind: "agent_or_client", sessionType: "headless" });
    expect(evaluateCaptureRules([input], { ...observation, sessionType: "HEADLESS" }).action).toBe("drop");
    expect(evaluateCaptureRules([input], { ...observation, sessionType: "headless", agent: "other" }).action).toBe("drop");
    expect(evaluateCaptureRules([input], { ...observation, sessionType: "interactive" }).action).toBe("allow");
    expect(evaluateCaptureRules([input], observation).action).toBe("allow");
  });
  it("requests only missing active category judgments, deduplicated", () => {
    const rules = [
      rule({ kind: "content_category", category: "personal_info" }, "r1"),
      rule({ kind: "content_category", category: "personal_info" }, "r2"),
      rule({ kind: "content_category", category: "credentials" }, "r3"),
      rule({ kind: "content_category", category: "non_work", enabled: false }, "r4"),
    ];
    expect(evaluateCaptureRules(rules, { ...observation, categories: { credentials: false } }).neededCategories).toEqual(["personal_info"]);
  });
  it.each(["personal_info", "credentials", "customer_data", "non_work"])("matches category %s only on a true boolean", (category) => {
    const rules = [rule({ kind: "content_category", category })];
    expect(evaluateCaptureRules(rules, { ...observation, categories: { [category]: true } })).toMatchObject({ action: "drop", neededCategories: [] });
    expect(evaluateCaptureRules(rules, { ...observation, categories: { [category]: false } })).toMatchObject({ action: "allow", neededCategories: [] });
  });
  it("never reads categories when a cheap rule drops, regardless of rule order", () => {
    const input = { ...observation, get categories(): Record<string, boolean> { throw new Error("Classification must not run"); } };
    expect(evaluateCaptureRules([
      rule({ kind: "content_category", category: "credentials" }),
      rule({ kind: "keyword", pattern: "secret" }),
    ], input)).toMatchObject({ action: "drop", neededCategories: [] });
  });
  it("discards pending category requests once a known category drops", () => {
    expect(evaluateCaptureRules([
      rule({ kind: "content_category", category: "non_work" }, "r1"),
      rule({ kind: "content_category", category: "credentials" }, "r2"),
    ], { ...observation, categories: { credentials: true } })).toMatchObject({ action: "drop", neededCategories: [] });
  });
  it("redacts all literal spans in both fields, case insensitive by default", () => {
    expect(evaluateCaptureRules([rule({ kind: "keyword", pattern: "secret", action: "redact" })], observation)).toMatchObject({ title: "A useful [removed]", body: "Keep this [removed] and [removed] private.", action: "redact", redacted: true, flagged: false });
  });
  it("keeps case-sensitive literals and regex characters literal", () => {
    expect(evaluateCaptureRules([rule({ kind: "keyword", pattern: "SECRET", caseSensitive: true, action: "redact" })], observation).body).toBe("Keep this secret and [removed] private.");
    expect(evaluateCaptureRules([rule({ kind: "keyword", pattern: "a+b", action: "redact" })], { title: "a+b aaaab", body: "Details" }).title).toBe("[removed] aaaab");
  });
  it.each([
    ["secret-\\d+", "secret-123 next secret-4", "[removed] next [removed]"],
    ["^secret", "secret other secret", "[removed] other secret"],
    ["secret$", "secret other secret", "secret other [removed]"],
    ["s[eE]cret", "secret SECRET", "[removed] [removed]"],
    ["id:[0-9]{2,4}", "id:1 id:12345", "id:1 [removed]5"],
    ["token\\s*[:=]\\w+", "token =abc token:xyz", "[removed] [removed]"],
    ["colou?r", "color colour", "[removed] [removed]"],
    ["a*b", "aaab b", "[removed] [removed]"],
    ["a{0}b", "b ab", "[removed] a[removed]"],
    ["[^ ]+", "one two", "[removed] [removed]"],
    ["a.b", "a\nb axb", "a\nb [removed]"],
    ["a\\.b", "a.b axb", "[removed] axb"],
  ])("redacts regex %s", (pattern, body, expected) => {
    expect(evaluateCaptureRules([rule({ kind: "keyword", pattern, regex: true, action: "redact" })], { title: "Title", body }).body).toBe(expected);
  });
  it("matches supported regex semantics across short inputs", () => {
    const patterns = ["a*b", "a+b", "a?b", "a{1,2}b", "a*ba*", "a+ba+c", "^a*b", "ab*$", "[ab]+c", "a.b", "[^b]+b"];
    for (const pattern of patterns) {
      for (let encoded = 0; encoded < 243; encoded++) {
        let value = encoded;
        let body = "";
        for (let index = 0; index < 5; index++) {
          body += "abc"[value % 3];
          value = Math.floor(value / 3);
        }
        const result = evaluateCaptureRules([rule({ kind: "keyword", pattern, regex: true, caseSensitive: true, action: "redact" })], { title: "Title", body });
        expect(result.body, `${pattern}: ${body}`).toBe(body.replace(new RegExp(pattern, "g"), "[removed]"));
      }
    }
  });
  it("preserves offsets in Unicode case-insensitive text", () => {
    expect(evaluateCaptureRules([rule({ kind: "keyword", pattern: "secret", action: "redact" })], { title: "İ secret", body: "İ secret" }).title).toBe("İ [removed]");
  });
  it("merges overlapping spans without redacting unrelated text or mutating inputs", () => {
    const rules = [rule({ kind: "keyword", pattern: "secret", action: "redact" }, "r1"), rule({ kind: "keyword", pattern: "ret data", action: "redact" }, "r2")];
    const input = { title: "secret data okay", body: "Other" };
    expect(evaluateCaptureRules(rules, input).title).toBe("[removed] okay");
    expect(input.title).toBe("secret data okay");
  });
  it.each([
    { kind: "repo_owner", owner: "team", mode: "deny" },
    { kind: "repo_match", pattern: "team/*" },
    { kind: "path_match", pattern: "private/*" },
    { kind: "agent_or_client", agent: "codex" },
    { kind: "content_category", category: "credentials" },
  ])("masks both fields for non-span $kind redactions", (input) => {
    expect(evaluateCaptureRules([rule({ ...input, action: "redact" })], { ...observation, repo: "team/repo", paths: ["private/file"], agent: "codex", categories: { credentials: true } })).toMatchObject({ title: "[removed]", body: "[removed]", redacted: true, action: "redact" });
  });
  it("combines redaction and flagging, and evaluates drops against original content", () => {
    const redact = rule({ kind: "keyword", pattern: "secret", action: "redact" }, "redact");
    const flag = rule({ kind: "keyword", pattern: "secret", action: "flag" }, "flag");
    const drop = rule({ kind: "keyword", pattern: "secret", action: "drop" }, "drop");
    expect(evaluateCaptureRules([redact, flag], observation)).toMatchObject({ action: "redact", redacted: true, flagged: true, matches: [{ ruleId: "redact", kind: "keyword", action: "redact" }, { ruleId: "flag", kind: "keyword", action: "flag" }] });
    expect(evaluateCaptureRules([redact, flag, drop], observation)).toMatchObject({ action: "drop", redacted: true, flagged: true });
    expect(evaluateCaptureRules([flag], observation)).toMatchObject({ ...observation, action: "flag", flagged: true, redacted: false });
  });
  it("caps matching input without silently ignoring trailing sensitive text", () => {
    const input = rule({ kind: "keyword", pattern: "secret" });
    expect(() => evaluateCaptureRules([input], { title: "Title", body: "x".repeat(captureInputLimit + 1) + "secret" })).toThrow(RangeError);
    expect(() => evaluateCaptureRules([rule({ kind: "path_match", pattern: "**" })], { ...observation, cwd: "x".repeat(captureInputLimit + 1) })).toThrow(RangeError);
    expect(() => evaluateCaptureRules([rule({ kind: "path_match", pattern: "~/personal/**" })], { ...observation, cwd: "x".repeat(captureInputLimit + 1) })).toThrow(RangeError);
  });
  it.each([false, true])("accepts maximal push title and body with independent field bounds, regex: %s", (regex) => {
    const input = hivePushInput.parse({ title: "x".repeat(194) + "secret", body: "x".repeat(captureInputLimit - 6) + "secret" });
    expect(evaluateCaptureRules([rule({ kind: "keyword", pattern: "secret", regex, action: "redact" })], {...input, title: input.title!, body: input.body!})).toMatchObject({
      action: "redact",
      title: "x".repeat(194) + "[removed]",
      body: "x".repeat(captureInputLimit - 6) + "[removed]",
    });
  });
  it("handles maximal adversarial regex and glob inputs without backtracking", () => {
    const regex = rule({ kind: "keyword", pattern: "a+ba+ba+ba+b", regex: true });
    const glob = rule({ kind: "path_match", pattern: "*a".repeat(100) + "b" });
    expect(evaluateCaptureRules([regex, glob], { title: "Title", body: "a".repeat(captureInputLimit), paths: ["a".repeat(captureInputLimit)] }).action).toBe("allow");
  });
});

describe("capture push metadata", () => {
  it("preserves remote, cwd, home, agent and sessionType through validation", () => {
    const metadata = { remote: "git@host:team/repo.git", cwd: "/work/repo", home: "/home/person", agent: "codex", sessionType: "headless" };
    expect(hivePushInput.parse({ ...observation, ...metadata })).toMatchObject(metadata);
  });
  it("bounds push metadata", () => {
    expect(hivePushInput.safeParse({ ...observation, remote: "x".repeat(2001) }).success).toBe(false);
    expect(hivePushInput.safeParse({ ...observation, cwd: "x".repeat(4001) }).success).toBe(false);
    expect(hivePushInput.safeParse({ ...observation, home: "x".repeat(4001) }).success).toBe(false);
    expect(hivePushInput.safeParse({ ...observation, agent: "x".repeat(121) }).success).toBe(false);
  });
});

it("canonicalises projects without credentials and keeps hosts and nested namespaces distinct", async () => {
  const {canonicalProject, projectFromContext, evaluateProjectPolicy} = await import("./capture-matchers.mjs");
  expect(canonicalProject("https://user:credential@GitHub.com/Team/Repo.git?token=secret")).toBe("github.com/team/repo");
  expect(canonicalProject("git@gitlab.com:group/subgroup/repo.git")).toBe("gitlab.com/group/subgroup/repo");
  expect(canonicalProject("git@gitlab.example:Group/Repo.git")).toBe("gitlab.example/Group/Repo");
  expect(canonicalProject("file:///tmp/project")).toBeNull();
  expect(canonicalProject("github.com/team/../repo")).toBeNull();
  expect(canonicalProject("github.com/team/**", true)).toBeNull();
  expect(projectFromContext({repo: "team/repo", remote: "git@gitlab.com:team/repo.git"})).toBe("gitlab.com/team/repo");
  expect(projectFromContext({repo: "github.com/team/repo", remote: "git@gitlab.com:team/repo.git"})).toBeNull();
  const policy = {include: ["github.com/team/*"], exclude: ["github.com/team/private-*"], revision: 1};
  expect(evaluateProjectPolicy(policy, {repo: "team/allowed"}).allowed).toBe(true);
  for (const context of [{}, {repo: "team/private-tool"}, {repo: "another/allowed"}, {repo: "gitlab.com/team/allowed"}, {repo: "team/allowed", remote: "git@github.com:other/repo.git"}]) expect(evaluateProjectPolicy(policy, context).allowed).toBe(false);
  expect(evaluateProjectPolicy({...policy, include: []}, {repo: "team/allowed"}).allowed).toBe(false);
});

it("captures from every known repository by default, never from exclusions, unknown repos or home directories", async () => {
  const {evaluateProjectPolicy} = await import("./capture-matchers.mjs");
  const everything = {mode: "everything" as const, include: [], exclude: ["github.com/team/private-*"], revision: 0};
  expect(evaluateProjectPolicy(everything, {repo: "team/anything"})).toEqual({allowed: true, project: "github.com/team/anything", reason: "captured"});
  expect(evaluateProjectPolicy(everything, {remote: "git@gitlab.com:group/tool.git"}).allowed).toBe(true);
  expect(evaluateProjectPolicy(everything, {repo: "team/private-notes"}).reason).toBe("excluded_project");
  expect(evaluateProjectPolicy(everything, {}).reason).toBe("unknown_project");
  expect(evaluateProjectPolicy(everything, {remote: "file:///tmp/project"}).allowed).toBe(false);
  expect(evaluateProjectPolicy(everything, {repo: "team/anything", cwd: "/Users/fixture/", home: "/Users/fixture"}).reason).toBe("home_directory");
  expect(evaluateProjectPolicy(everything, {repo: "team/anything", cwd: "/Users/fixture/work", home: "/Users/fixture"}).allowed).toBe(true);
  expect(evaluateProjectPolicy({...everything, mode: "selected"}, {repo: "team/anything"}).reason).toBe("no_selection");
  expect(evaluateProjectPolicy({include: [], exclude: [], revision: 0}, {repo: "team/anything"}).reason).toBe("no_selection");
});

it("parses free-text work areas and matches them without becoming an allow-list", async () => {
  const {parseWorkAreas, matchWorkAreas, describeWorkAreas, hiveShareProjectsInput} = await import("./project-sharing");
  expect(parseWorkAreas("frontend React, dbt models and infra")).toEqual(["frontend React", "dbt models", "infra"]);
  expect(parseWorkAreas("")).toEqual([]);
  expect(describeWorkAreas("frontend React, dbt models, infra")).toBe("frontend React, dbt models and infra");
  expect(describeWorkAreas("infra")).toBe("infra");
  expect(matchWorkAreas("frontend React, dbt models, infra", "React hydration warning fixed by moving formatting to the server")).toEqual(["frontend React"]);
  expect(matchWorkAreas("frontend React, dbt models", "The dbt model for revenue needs a unique key")).toEqual(["dbt models"]);
  expect(matchWorkAreas("", "anything")).toEqual([]);
  expect(hiveShareProjectsInput.parse({workAreas: " frontend React ", revision: 1})).toEqual({workAreas: "frontend React", revision: 1});
  expect(hiveShareProjectsInput.safeParse({workAreas: "x".repeat(301), revision: 1}).success).toBe(false);
});

it("supports inverted repository matching with unknown repositories denied", () => {
  const rule = captureRuleInputSchema.parse({name: "One project", kind: "repo_match", pattern: "team/allowed", mode: "only_allow", action: "drop"});
  const stored = {...rule, id: "allow", teamId: "team", memberId: "owner", createdBy: "owner", createdAt: "", updatedAt: ""};
  expect(evaluateCaptureRules([stored], {repo: "team/allowed", title: "", body: ""}).action).toBe("allow");
  expect(evaluateCaptureRules([stored], {repo: "team/other", title: "", body: ""}).action).toBe("drop");
  expect(evaluateCaptureRules([stored], {title: "", body: ""}).action).toBe("drop");
});
