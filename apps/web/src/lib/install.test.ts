import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
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
      "headless",
    ]);
    expect(snippets[0]?.code).toBe(
      'claude mcp add --transport http hive https://hive.example/api/mcp --scope user',
    );
    expect(snippets[1]?.code).toBe(
      "codex mcp add hive --url https://hive.example/api/mcp\ncodex mcp login hive",
    );
    expect(JSON.parse(snippets[4]!.code).hooks.Stop[0].hooks[0].command).toBe(
      "$HOME/.claude/hooks/hive-stop.sh",
    );
    expect(snippets[5]?.code).toBe("claude mcp list");
  });
  it("keeps OAuth commands keyless and keys only in the headless fallback", () => {
    const result = buildInstallSnippets({
      baseUrl: "http://localhost:4340",
      apiKey: "test-key",
    });
    expect(result.slice(0, 6).some(({ code }) => code.includes("test-key"))).toBe(false);
    expect(result[6]?.code).toContain("Bearer test-key");
    expect(result[6]?.code).toContain("export HIVE_KEY=test-key\n");
  });
  it("leaves quiet sessions alone without a network call or marker", () => {
    const directory = mkdtempSync(join(tmpdir(), "hive-quiet-test-"));
    const transcript = join(directory, "quiet.jsonl");
    writeFileSync(
      transcript,
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "The repository uses TypeScript." }],
        },
      }),
    );
    try {
      const script =
        'globalThis.fetch = () => { throw new Error("Quiet session called network"); };\n' +
        snippets[3]!.code.replace(/^#![^\n]*\n/, "");
      const result = execFileSync("node", ["-e", script], {
        input: JSON.stringify({
          session_id: "quiet",
          transcript_path: transcript,
        }),
        encoding: "utf8",
        env: { ...process.env, TMPDIR: directory, HIVE_KEY: "fixture" },
      });
      expect(result).toBe("");
      expect(readdirSync(directory)).toEqual(["quiet.jsonl"]);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
  it("obeys the server's noise decision before asking the agent", () => {
    const directory = mkdtempSync(join(tmpdir(), "hive-noise-test-"));
    const transcript = join(directory, "noise.jsonl");
    writeFileSync(
      transcript,
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: "Learned the general rule that tests can fail.",
            },
          ],
        },
      }),
    );
    try {
      const script =
        'globalThis.fetch = async () => ({ ok: true, json: async () => ({ decision: "skip" }) });\n' +
        snippets[3]!.code.replace(/^#![^\n]*\n/, "");
      expect(
        execFileSync("node", ["-e", script], {
          input: JSON.stringify({
            session_id: "noise",
            transcript_path: transcript,
          }),
          encoding: "utf8",
          env: { ...process.env, TMPDIR: directory, HIVE_KEY: "fixture" },
        }),
      ).toBe("");
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
  it.each(["cli", "sdk-cli", "sdk-test", undefined])(
    "uses the correct ending and guards for entrypoint %s",
    (entrypoint) => {
      const directory = mkdtempSync(join(tmpdir(), "hivemind-hook-test-"));
      const transcript = join(directory, "transcript.jsonl");
      writeFileSync(
        transcript,
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: "Discovered a specific workaround for the migration lock.",
              },
            ],
          },
        }),
      );
      const run = (input: object) =>
        execFileSync(
          "node",
          ["-e", snippets[3]!.code.replace(/^#![^\n]*\n/, "")],
          {
            input: JSON.stringify({ transcript_path: transcript, ...input }),
            encoding: "utf8",
            env: {
              ...process.env,
              TMPDIR: directory,
              CLAUDE_CODE_ENTRYPOINT: entrypoint,
            },
          },
        );
      try {
        expect(run({ session_id: "active", stop_hook_active: true })).toBe("");
        const first = JSON.parse(run({ session_id: "first" }));
        expect(first.decision).toBe("block");
        expect(first.reason).toContain("https://hive.example/api/mcp");
        expect(first.reason).toContain("supersedes");
        expect(first.reason).toContain("verify_after");
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
        expect(JSON.parse(run({ session_id: "second" })).decision).toBe(
          "block",
        );
        expect(JSON.parse(run({ session_id: "active" }))).toEqual(first);
      } finally {
        rmSync(directory, { recursive: true });
      }
    },
  );
});
