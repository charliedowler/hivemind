import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInstallSnippets } from "./install";

describe("install snippets", () => {
  const snippets = buildInstallSnippets({
    baseUrl: "https://hive.example/",
    apiKey: "<YOUR_KEY>",
  });
  it("keeps the required order and exact connection commands", () => {
    expect(snippets.map(({ id }) => id)).toEqual([
      "claude",
      "codex",
      "instructions",
      "stop-script",
      "stop-settings",
      "check",
    ]);
    expect(snippets[0]?.code).toBe(
      'claude mcp add --transport http hive https://hive.example/api/mcp --header "Authorization: Bearer <YOUR_KEY>" --scope user',
    );
    expect(snippets[1]?.code).toBe(
      "export HIVE_KEY=<YOUR_KEY>\ncodex mcp add hive --url https://hive.example/api/mcp --bearer-token-env-var HIVE_KEY",
    );
    expect(JSON.parse(snippets[4]!.code).hooks.Stop[0].hooks[0].command).toBe(
      "$HOME/.claude/hooks/hive-stop.sh",
    );
    expect(snippets[5]?.code).toBe("claude mcp list");
  });
  it("substitutes the issued key in only the connection snippets", () => {
    const result = buildInstallSnippets({
      baseUrl: "http://localhost:4340",
      apiKey: "test-key",
    });
    expect(result[0]?.code).toContain("Bearer test-key");
    expect(result[1]?.code).toContain("export HIVE_KEY=test-key\n");
    expect(result.slice(2).some(({ code }) => code.includes("test-key"))).toBe(
      false,
    );
  });
  it.each(["cli", "sdk-cli", "sdk-test", undefined])(
    "uses the correct ending and guards for entrypoint %s",
    (entrypoint) => {
      const directory = mkdtempSync(join(tmpdir(), "hivemind-hook-test-"));
      const run = (input: object) =>
        execFileSync("bash", ["-c", snippets[3]!.code], {
          input: JSON.stringify(input),
          encoding: "utf8",
          env: {
            ...process.env,
            TMPDIR: directory,
            CLAUDE_CODE_ENTRYPOINT: entrypoint,
          },
        });
      try {
        expect(run({ session_id: "active", stop_hook_active: true })).toBe("");
        const first = JSON.parse(run({ session_id: "first" }));
        expect(first.decision).toBe("block");
        expect(first.reason).toContain("https://hive.example/api/mcp");
        if (entrypoint === undefined || entrypoint === "cli") {
          expect(first.reason).toMatch(
            /If nothing qualifies, stop now without comment\.$/,
          );
          expect(first.reason).not.toContain("headless");
        } else {
          expect(first.reason).toMatch(
            /This is a headless run and the caller reads only your last message, so finish by repeating your previous final answer word for word and nothing else\.$/,
          );
        }
        expect(run({ session_id: "first" })).toBe("");
        expect(JSON.parse(run({ session_id: "second" })).decision).toBe("block");
        expect(JSON.parse(run({ session_id: "active" }))).toEqual(first);
      } finally {
        rmSync(directory, { recursive: true });
      }
    },
  );
});
