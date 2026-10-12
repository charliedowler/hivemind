import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { hivePushInput } from "@hivemind/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSeed } from "./seed";

const fixture = ["Charlie", "Maya", "Charlie", "Maya"].map((author, index) => ({
  author, title: `Learning ${index + 1}`, body: "Use pooled connections.", kind: "gotcha", tags: ["postgres"],
  repo: "team/service", paths: ["src/db.ts"], confidence: 0.9, source: "codex", sessionRef: "session-test",
}));
const originalKey = "hm_test-original-member-key";
const joinedKey = "hm_test-joined-member-key";
let server: Server | undefined;
let directory: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function fixtureFile(items: unknown = fixture): Promise<string> {
  directory = await mkdtemp(join(import.meta.dirname, ".seed-test-"));
  const file = join(directory, "fixture.json");
  await writeFile(file, JSON.stringify(items));
  return file;
}

async function startMock(failures = false, joinFails = false) {
  const calls: { path: string; headers: import("node:http").IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    calls.push({ path: request.url!, headers: request.headers, body });
    if (request.url === "/api/app/join") {
      response.writeHead(joinFails ? 403 : 201, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ apiKey: joinedKey, team: { id: "team_test", name: "Demo" }, member: { id: "mem_maya", name: "Maya" } }));
      return;
    }
    if (request.url !== "/api/mcp") { response.writeHead(404).end(); return; }
    const id = body.id as number;
    const result = failures && id === 2
      ? { jsonrpc: "2.0", id, error: { code: -32602, message: `Rejected ${joinedKey}` } }
      : { jsonrpc: "2.0", id, result: { ...(failures && id === 3 ? { isError: true } : {}), content: [{ type: "text", text: failures && id === 3 ? `Rejected ${originalKey}` : `Saved [lrn_fixture${id}]` }] } };
    if (id === 2) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(`: keepalive\r\n\r\nevent: message\r\ndata: ${JSON.stringify(result)}\r\n\r\n`);
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No mock address");
  return { url: `http://127.0.0.1:${address.port}`, calls };
}

const execute = promisify(execFile);

describe("runSeed", () => {
  it("runs the thin CLI with environment credentials and the pnpm argument separator", async () => {
    const { url, calls } = await startMock();
    const { stdout, stderr } = await execute(process.execPath, ["--import", "tsx", "scripts/seed.ts", "--", "--file", await fixtureFile()], {
      cwd: process.cwd(),
      env: { ...process.env, HIVEMIND_URL: url, HIVEMIND_KEY: originalKey, HIVEMIND_INVITE: "hive-test-invite" },
    });
    expect(calls.filter((call) => call.path === "/api/mcp")).toHaveLength(4);
    expect(stdout).toContain("Maya: Saved [lrn_fixture2] | Learning 2");
    expect(stdout + stderr).not.toContain(originalKey);
    expect(stdout + stderr).not.toContain(joinedKey);
  });

  it("exits nonzero after CLI item failures", async () => {
    const { url, calls } = await startMock(true);
    const result = await execute(process.execPath, ["--import", "tsx", "scripts/seed.ts", "--file", await fixtureFile()], {
      cwd: process.cwd(),
      env: { ...process.env, HIVEMIND_URL: url, HIVEMIND_KEY: originalKey, HIVEMIND_INVITE: "hive-test-invite" },
    }).catch((error: { code: number; stdout: string; stderr: string }) => error);
    expect(result).toHaveProperty("code", 1);
    expect(calls.filter((call) => call.path === "/api/mcp")).toHaveLength(4);
    expect(result.stdout).toContain("Saved [lrn_fixture4]");
    expect(result.stdout + result.stderr).not.toContain(originalKey);
    expect(result.stdout + result.stderr).not.toContain(joinedKey);
  });

  it("pushes four items sequentially with each author's key and parses JSON and SSE", async () => {
    const { url, calls } = await startMock();
    const log = vi.fn();
    const result = await runSeed({ file: await fixtureFile(), url, apiKey: originalKey, inviteCode: "hive-test-invite", log });
    expect(result).toEqual({ pushed: 4, failed: 0 });
    expect(calls.map((call) => call.path)).toEqual(["/api/mcp", "/api/app/join", "/api/mcp", "/api/mcp", "/api/mcp"]);
    expect(calls.find((call) => call.path === "/api/app/join")?.body).toEqual({ inviteCode: "hive-test-invite", memberName: "Maya" });
    const pushes = calls.filter((call) => call.path === "/api/mcp");
    expect(pushes.map((call) => call.headers.authorization)).toEqual([originalKey, joinedKey, originalKey, joinedKey].map((key) => `Bearer ${key}`));
    for (const [index, call] of pushes.entries()) {
      expect(call.headers).toMatchObject({ "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" });
      expect(call.body).toEqual({ jsonrpc: "2.0", id: index + 1, method: "tools/call", params: { name: "hive_push", arguments: hivePushInput.parse(fixture[index]) } });
    }
    expect(log.mock.calls.map(([line]) => line)).toEqual(fixture.map((item, index) => `${item.author}: Saved [lrn_fixture${index + 1}] | ${item.title}`));
    expect(JSON.stringify(log.mock.calls)).not.toContain(originalKey);
    expect(JSON.stringify(log.mock.calls)).not.toContain(joinedKey);
  });

  it("continues after JSON-RPC and tool errors and redacts keys from failures", async () => {
    const { url, calls } = await startMock(true);
    const log = vi.fn();
    expect(await runSeed({ file: await fixtureFile(), url, apiKey: originalKey, inviteCode: "hive-test-invite", log })).toEqual({ pushed: 2, failed: 2 });
    expect(calls.filter((call) => call.path === "/api/mcp")).toHaveLength(4);
    expect(log.mock.calls[1][0]).toContain("FAILED JSON-RPC -32602: Rejected [redacted]");
    expect(log.mock.calls[2][0]).toContain("FAILED Rejected [redacted]");
    expect(log.mock.calls[3][0]).toContain("lrn_fixture4");
    expect(JSON.stringify(log.mock.calls)).not.toContain(originalKey);
    expect(JSON.stringify(log.mock.calls)).not.toContain(joinedKey);
  });

  it("does not retry a failed join and continues pushing the existing member's items", async () => {
    const { url, calls } = await startMock(false, true);
    expect(await runSeed({ file: await fixtureFile(), url, apiKey: originalKey, inviteCode: "hive-test-invite", log: vi.fn() })).toEqual({ pushed: 2, failed: 2 });
    expect(calls.filter((call) => call.path === "/api/app/join")).toHaveLength(1);
    expect(calls.filter((call) => call.path === "/api/mcp").map((call) => call.body.id)).toEqual([1, 3]);
  });

  it("uses --as to identify the existing member", async () => {
    const { url, calls } = await startMock();
    const items = fixture.filter((item) => item.author === "Maya");
    expect(await runSeed({ file: await fixtureFile(items), url, apiKey: originalKey, as: "Maya", log: vi.fn() })).toEqual({ pushed: 2, failed: 0 });
    expect(calls.every((call) => call.path === "/api/mcp" && call.headers.authorization === `Bearer ${originalKey}`)).toBe(true);
  });

  it("validates dry runs and prints only authors and titles without networking", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const log = vi.fn();
    expect(await runSeed({ file: await fixtureFile(), dryRun: true, log })).toEqual({ pushed: 0, failed: 0 });
    expect(log.mock.calls.map(([line]) => line)).toEqual(fixture.map((item) => `${item.author}: ${item.title}`));
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects the whole file before networking if any item is invalid", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    await expect(runSeed({ file: await fixtureFile([fixture[0], { ...fixture[1], kind: "invalid" }]), dryRun: true, log: vi.fn() })).rejects.toThrow("Invalid seed data: 1.kind");
    expect(network).not.toHaveBeenCalled();
  });
});
