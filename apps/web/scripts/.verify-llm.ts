import type { SearchHit } from "@hivemind/core";
import { synthesizeAnswer } from "../src/server/llm/synthesize";
import { suggestTags } from "../src/server/llm/tagger";

process.loadEnvFile(".env.local");

function fixture(
  id: string,
  title: string,
  body: string,
  pushed: string,
  up: number,
  outdated = 0,
): SearchHit {
  return {
    id,
    title,
    body,
    kind: "gotcha",
    tags: ["postgres", "connection-pool"],
    repo: "team/api",
    paths: ["src/server/db.ts"],
    confidence: 0.9,
    source: "codex",
    author: { id: "mem_fixture", name: "Maya" },
    pushCount: 3,
    votes: { up, down: 0, outdated },
    createdAt: pushed,
    updatedAt: pushed,
    lastPushedAt: pushed,
    score: 0.9,
    signals: {
      vector: 0.9,
      fts: 0.9,
      recency: 0.9,
      votes: 0.9,
      repoMatch: true,
    },
  };
}
const hits = [
  fixture(
    "lrn_aaaaaaaaaaaa",
    "Disable prepared statements for pooled Postgres",
    "Our Next.js API connects to Postgres through the provider's transaction pooler. Configure postgres.js with `prepare: false`. Named prepared statements fail when the pooler reuses different database connections. Keep the client cached on globalThis so hot reload does not create extra clients.",
    "2026-10-12T10:00:00Z",
    6,
  ),
  fixture(
    "lrn_bbbbbbbbbbbb",
    "Keep the API connection pool small",
    "The API uses `const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3 });`. Use the provider's pooled DATABASE_URL for production. Each process can open three connections; this fixture does not record the production instance count or provider connection limit.",
    "2026-10-12T11:00:00Z",
    5,
  ),
  fixture(
    "lrn_cccccccccccc",
    "Enable prepared statements on pooled connections",
    "Set `prepare: true` when connecting our API to pooled Postgres. Our early prototype expected this to improve repeated query latency. This guidance conflicts with the current transaction pooler configuration.",
    "2026-06-01T10:00:00Z",
    1,
  ),
  fixture(
    "lrn_dddddddddddd",
    "Old workaround disables database TLS",
    "During an early connection investigation we set `ssl: false` for the production provider URL. This workaround predates the current managed database setup and has been voted outdated. Do not use it as current production guidance.",
    "2026-05-01T10:00:00Z",
    0,
    4,
  ),
  fixture(
    "lrn_eeeeeeeeeeee",
    "Use stable React list keys",
    "The feed component uses each learning id as the React key. Array positions produce incorrect state when new learnings arrive.",
    "2026-10-11T10:00:00Z",
    3,
  ),
];
const question =
  "How should our Next.js API connect to pooled Postgres, and what production pool size should we use?";
const timed = async (name: string, operation: () => Promise<unknown>) => {
  const start = performance.now();
  const result = await operation();
  console.log(
    `${name} ${JSON.stringify({ wallClockMs: Math.round(performance.now() - start), result })}`,
  );
  return result;
};
async function main(): Promise<void> {
  const answer = (await timed("synthesis", () =>
    synthesizeAnswer(question, hits),
  )) as Awaited<ReturnType<typeof synthesizeAnswer>>;
  const allowedIds = new Set(hits.map((hit) => hit.id));
  console.log(
    `citationFixtureCheck ${answer.citations.every((citation) => allowedIds.has(citation.id)) && [...answer.answer.matchAll(/\[(lrn_[a-z0-9]+)\]/g)].every((match) => allowedIds.has(match[1]))}`,
  );
  await timed("tags", () => suggestTags(hits[0]));
  delete process.env.ANTHROPIC_API_KEY;
  await timed("synthesisWithoutKey", () => synthesizeAnswer(question, hits));
  await timed("tagsWithoutKey", () => suggestTags(hits[0]));
}
void main();
