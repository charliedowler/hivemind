import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createTeam } from "../src/server/auth";
import { searchLearnings } from "../src/server/hive";
import { getSql } from "../src/server/db/client";

loadEnvFile(".env.local");
const mode = process.argv[2];
if (mode === "no-key") process.env.OPENAI_API_KEY = "";

function call(body: unknown, key?: string) {
  const args = [
    "-sS",
    "-i",
    "http://localhost:4320/api/mcp",
    "-H",
    "Content-Type: application/json",
    "-H",
    "Accept: application/json, text/event-stream",
    "-H",
    "MCP-Protocol-Version: 2025-06-18",
    "-H",
    "User-Agent: codex-r2-smoke",
    "--data-binary",
    "@-",
  ];
  if (key) args.push("-H", `Authorization: Bearer ${key}`);
  const output = spawnSync("curl", args, {
    input: JSON.stringify(body),
    encoding: "utf8",
  });
  assert.equal(output.status, 0);
  const split = output.stdout.indexOf("\r\n\r\n");
  const headers = output.stdout.slice(0, split);
  const raw = output.stdout.slice(split + 4);
  const data = raw.startsWith("event:")
    ? raw
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim()
    : raw;
  const parsed = JSON.parse(data || "{}");
  return { headers, parsed };
}

async function main() {
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "codex-smoke", version: "1" },
    },
  };
  for (const key of [undefined, "hm_invalid"]) {
    const result = call(init, key);
    assert.match(result.headers, /401/);
    assert.match(result.headers, /www-authenticate: Bearer/i);
    console.log(
      `${key ? "wrong key" : "no key"}: ${result.headers.split("\r\n")[0]}, ${JSON.stringify(result.parsed)}`,
    );
  }
  const team = await createTeam({
    teamName: `Smoke ${mode}`,
    memberName: "Smoke author",
  });
  try {
    const initialized = call(init, team.apiKey);
    assert.equal(initialized.parsed.result.serverInfo.name, "hivemind");
    console.log(
      `initialize: ${initialized.headers.split("\r\n")[0]}, hivemind`,
    );
    const listed = call(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      team.apiKey,
    );
    assert.equal(listed.parsed.result.tools.length, 5);
    console.log(
      `tools/list: ${listed.parsed.result.tools.map((tool: { name: string }) => tool.name).join(", ")}`,
    );
    const tool = (name: string, input: unknown, id: number) => {
      const result = call(
        {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: input },
        },
        team.apiKey,
      );
      assert.ok(!result.parsed.error, JSON.stringify(result.parsed.error));
      assert.ok(
        !result.parsed.result.isError,
        result.parsed.result.content[0].text,
      );
      console.log(
        `${name}: ${result.parsed.result.content[0].text.slice(0, 500)}`,
      );
      return result.parsed.result.content[0].text as string;
    };
    const body =
      "Postgres generated search columns require immutable expressions. Convert text array tags to a weighted English tsvector with an immutable helper function. Keep the migration transactional.";
    const saved = tool(
      "hive_push",
      {
        title: "Postgres search migration requires immutable expressions",
        body,
        repo: "demo/core",
        tags: ["postgres"],
      },
      3,
    );
    const id = saved.match(/lrn_[a-z2-7]{12}/)?.[0];
    assert.ok(id);
    const second = tool(
      "hive_push",
      {
        title:
          mode === "vector"
            ? "Postgres search migrations need immutable expressions"
            : "postgres SEARCH migration requires immutable expressions",
        body,
        repo: "demo/core",
        tags: ["database"],
      },
      4,
    );
    assert.ok(second.includes(`Merged into ${id} (seen 2 times)`));
    tool("hive_search", { query: "Postgres immutable", repo: "demo/core" }, 5);
    tool("hive_recent", { since: "1h" }, 6);
    tool("hive_feedback", { id, vote: "up" }, 7);
    tool("hive_ask", { question: "Postgres immutable" }, 8);
    const hits = await searchLearnings(team.ctx, {
      query: "Postgres immutable",
      limit: 8,
    });
    assert.equal(hits[0].source, "codex");
    if (mode === "vector") assert.ok(hits[0].signals.vector !== null);
    else assert.equal(hits[0].signals.vector, null);
    console.log(
      `mode=${mode}, vector signal=${hits[0].signals.vector}, source=${hits[0].source}, semantic/title merge verified`,
    );
  } finally {
    const sql = getSql();
    for (const table of [
      "feedback",
      "learning_pushes",
      "ask_log",
      "learnings",
      "api_keys",
      "web_sessions",
      "members",
    ])
      await sql`DELETE FROM ${sql(table)} WHERE team_id = ${team.ctx.teamId}`;
    await sql`DELETE FROM teams WHERE id = ${team.ctx.teamId}`;
    await sql.end();
  }
}
main().catch(() => {
  console.error("MCP smoke test failed.");
  process.exitCode = 1;
});
