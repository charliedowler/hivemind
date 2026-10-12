import { createHash, randomBytes } from "node:crypto";
import { posix } from "node:path";
import { gzipSync } from "node:zlib";
import tar from "tar-stream";
import { after } from "next/server";
import {
  redactSecrets,
  type HiveContext,
  type KnowledgeFile,
  type KnowledgeListing,
  type LearningView,
} from "@hivemind/core";
import { getSql } from "./db/client";
import { learningView } from "./learning-view";
import {
  HiveError,
  HiveInputError,
  HiveNotFoundError,
  HiveUnavailableError,
} from "./errors";
import { putPrivateObject, readPrivateObject } from "./blob-store";
import type { LearningTransaction } from "./lifecycle";

type Manifest = Record<string, { key: string; digest: string }>;
const digest = (content: string | Buffer) =>
  createHash("sha256").update(content).digest("hex");
const slug = (input: string) =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "general";
const label = (input: string) => input.replace(/[\[\]\\\r\n]/g, " ");

export function knowledgePath(path: string): string {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\x00-\x1f\x7f]/.test(path) ||
    path.length > 500
  )
    throw new HiveInputError("Use a relative hive path without traversal.");
  const normalized = path.replace(/\/$/, "");
  if (
    normalized &&
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new HiveInputError("Use a relative hive path without traversal.");
  return normalized;
}

function cellPath(cell: LearningView) {
  const repo = cell.repo?.split("/");
  const folder =
    repo?.length === 2 ? `repos/${slug(repo[0])}/${slug(repo[1])}` : "notes";
  return `${folder}/${slug(cell.area ?? "general")}/${slug(cell.title)}-${cell.id}.md`;
}

export function renderKnowledgeTree(
  cells: LearningView[],
): Map<string, string> {
  const files = new Map<string, string>();
  const groups = new Map<string, { title: string; cells: LearningView[] }>();
  const add = (path: string, title: string, cell: LearningView) => {
    const group = groups.get(path) ?? { title, cells: [] };
    group.cells.push(cell);
    groups.set(path, group);
  };
  const predecessors = new Map<string, string[]>();
  for (const cell of cells)
    if (cell.supersededBy)
      predecessors.set(cell.supersededBy, [
        ...(predecessors.get(cell.supersededBy) ?? []),
        cell.id,
      ]);
  for (const cell of cells) {
    const path = cellPath(cell);
    const metadata = {
      id: cell.id,
      title: cell.title,
      lifecycle: cell.lifecycle,
      revision: cell.revision,
      author: cell.author.name,
      source: cell.source,
      session: cell.sessionRef,
      repo: cell.repo,
      area: cell.area,
      tags: cell.tags,
      paths: cell.paths,
      confidence: cell.confidence,
      updated_at: cell.updatedAt,
      verify_after: cell.verifyAfter,
      superseded_by: cell.supersededBy,
      supersedes: predecessors.get(cell.id) ?? [],
    };
    files.set(
      path,
      `---\n${Object.entries(metadata)
        .map(([key, value]) => `${key}: ${JSON.stringify(value ?? null)}`)
        .join(
          "\n",
        )}\n---\n\n# ${cell.title}\n\n${cell.supersededBy ? `Superseded by ${cell.supersededBy}. Read the replacement before acting.\n\n` : ""}${cell.verifyBeforeUse ? "Verify before use. The verification date has passed.\n\n" : ""}${cell.body}\n`,
    );
    for (const tag of cell.tags) add(`topics/${slug(tag)}.md`, tag, cell);
    add(`people/${cell.author.id}.md`, `${cell.author.name}'s cells`, cell);
    if (cell.kind === "friction")
      add(
        `friction/${slug(cell.area ?? "general")}.md`,
        `${cell.area ?? "General"} friction`,
        cell,
      );
  }
  const links = (items: LearningView[], from = "INDEX.md") =>
    items
      .map(
        (cell) =>
          `- [${label(cell.title)}](${posix.relative(posix.dirname(from), cellPath(cell))}) | ${cell.lifecycle ?? "fresh"} | ${cell.id}${cell.verifyBeforeUse ? " | verify before use" : ""}`,
      )
      .join("\n");
  for (const [path, group] of groups)
    files.set(path, `# ${group.title}\n\n${links(group.cells, path)}\n`);
  const current = cells.filter((cell) =>
    ["fresh", "confirmed"].includes(cell.lifecycle ?? "fresh"),
  );
  const currentIds = new Set(current.map((cell) => cell.id));
  files.set(
    "INDEX.md",
    `# The hive\n\nGenerated from the team's cells. This view is read-only. Use hive_push to add or correct a learning. Verification dates must be checked against today's date even in an older snapshot.\n\n## Current cells\n\n${links(current) || "No current cells."}\n\n## History\n\n${links(cells.filter((cell) => !currentIds.has(cell.id))) || "No historical cells."}\n`,
  );
  return files;
}

function canonicalJson(value: unknown): string {
  const ordered = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(ordered)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, ordered(value)]),
          )
        : item;
  return JSON.stringify(ordered(value));
}

function redactEvidence(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value).text;
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactEvidence(item)]),
    );
  return value;
}

export async function queueEvidence(
  tx: LearningTransaction,
  ctx: HiveContext,
  learningId: string,
  pushId: string,
  input: unknown,
) {
  const payload = canonicalJson(redactEvidence(input));
  const hash = digest(payload);
  const key = `teams/${ctx.teamId}/evidence/${pushId}-${hash}.json`;
  await tx`INSERT INTO learning_evidence (push_id, team_id, learning_id, payload, object_key, digest, bytes) VALUES (${pushId}, ${ctx.teamId}, ${learningId}, ${tx.json(JSON.parse(payload))}, ${key}, ${hash}, ${Buffer.byteLength(payload)})`;
}

async function withStorageWorkers<T>(
  items: Iterable<T>,
  operation: (item: T) => Promise<void>,
) {
  const iterator = items[Symbol.iterator]();
  async function runWorker(): Promise<void> {
    const item = iterator.next();
    if (item.done) return;
    await operation(item.value);
    return runWorker();
  }
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => runWorker()),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}

async function flushEvidence(ctx: HiveContext) {
  const rows =
    await getSql()`SELECT push_id, payload, object_key, digest FROM learning_evidence WHERE team_id = ${ctx.teamId} AND uploaded_at IS NULL ORDER BY created_at LIMIT 100`;
  await withStorageWorkers(rows, async (row) => {
    const payload = Buffer.from(canonicalJson(row.payload));
    const hash = digest(payload);
    const key = `teams/${ctx.teamId}/evidence/${row.push_id}-${hash}.json`;
    await putPrivateObject(key, payload, "application/json");
    await getSql()`UPDATE learning_evidence SET payload = NULL, uploaded_at = now(), digest = ${hash}, bytes = ${payload.length}, object_key = ${key} WHERE push_id = ${row.push_id} AND team_id = ${ctx.teamId} AND uploaded_at IS NULL`;
  });
}

export async function ensureKnowledge(
  ctx: HiveContext,
  force = false,
): Promise<{ revision: number; manifest: Manifest }> {
  const sql = getSql();
  await sql`INSERT INTO knowledge_state (team_id) VALUES (${ctx.teamId}) ON CONFLICT DO NOTHING`;
  await sql`UPDATE knowledge_state SET revision = revision + 1, next_verify_at = NULL WHERE team_id = ${ctx.teamId} AND next_verify_at <= now()`;
  await flushEvidence(ctx);
  for (let attempt = 0; attempt < 3; attempt++) {
    const [state] =
      await sql`SELECT * FROM knowledge_state WHERE team_id = ${ctx.teamId}`;
    if (!force && Number(state.revision) === Number(state.published_revision))
      return {
        revision: Number(state.published_revision),
        manifest: state.manifest as Manifest,
      };
    const rows =
      await sql`SELECT l.*, m.name AS author_name FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE l.team_id = ${ctx.teamId} ORDER BY l.id LIMIT 10001`;
    if (rows.length > 10000)
      throw new HiveUnavailableError(
        "This hive needs a streamed rebuild before it can publish more than 10000 cells.",
      );
    const renderedAt = Date.now();
    const files = renderKnowledgeTree(rows.map(learningView));
    const oldManifest = state.manifest as Manifest;
    const manifest: Manifest = {};
    await withStorageWorkers(files, async ([path, content]) => {
      const hash = digest(content),
        key = `teams/${ctx.teamId}/tree/${hash}.md`;
      if (force || oldManifest[path]?.digest !== hash)
        await putPrivateObject(
          key,
          Buffer.from(content),
          "text/markdown; charset=utf-8",
        );
      manifest[path] = { key, digest: hash };
    });
    const futureDates = rows
      .map((row) => row.verify_after && new Date(row.verify_after).getTime())
      .filter(
        (date): date is number => typeof date === "number" && date > renderedAt,
      );
    const nextVerifyAt = futureDates.length
      ? new Date(Math.min(...futureDates))
      : null;
    const published =
      await sql`UPDATE knowledge_state SET next_verify_at = ${nextVerifyAt}, manifest = ${sql.json(manifest)}, published_revision = ${state.revision} WHERE team_id = ${ctx.teamId} AND revision = ${state.revision} RETURNING published_revision`;
    if (published.length) return { revision: Number(state.revision), manifest };
  }
  throw new HiveError(
    "The hive changed during publication. Retry to read the latest tree.",
    409,
  );
}

export function scheduleKnowledge(ctx: HiveContext) {
  try {
    after(async () => {
      try {
        await ensureKnowledge(ctx);
      } catch {
        console.warn("Knowledge publication remains pending.");
      }
    });
  } catch {}
}

export async function browseKnowledge(
  ctx: HiveContext,
  path = "",
): Promise<KnowledgeListing> {
  path = knowledgePath(path);
  const { revision, manifest } = await ensureKnowledge(ctx);
  const prefix = path ? `${path}/` : "";
  const entries = new Map<string, KnowledgeListing["entries"][number]>();
  for (const name of Object.keys(manifest)) {
    if (!name.startsWith(prefix)) continue;
    const [child, rest] = name.slice(prefix.length).split("/");
    entries.set(child, {
      name: child,
      path: prefix + child,
      type: rest ? "directory" : "file",
    });
  }
  if (path && !entries.size)
    throw new HiveNotFoundError("Directory not found in your hive.");
  return {
    path,
    revision,
    entries: [...entries.values()].sort(
      (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
    ),
  };
}

export async function readKnowledge(
  ctx: HiveContext,
  path: string,
): Promise<KnowledgeFile> {
  path = knowledgePath(path);
  const { revision, manifest } = await ensureKnowledge(ctx);
  const file = manifest[path];
  if (!file) throw new HiveNotFoundError("File not found in your hive.");
  const content = await readPrivateObject(file.key);
  if (digest(content) !== file.digest)
    throw new HiveUnavailableError(
      "This hive file failed its integrity check. Rebuild the tree.",
    );
  return { path, revision, content: content.toString("utf8") };
}

export async function snapshotKnowledge(ctx: HiveContext) {
  const { revision, manifest } = await ensureKnowledge(ctx);
  const pack = tar.pack(),
    chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    pack.on("data", (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    });
    pack.on("end", () => resolve(gzipSync(Buffer.concat(chunks))));
    pack.on("error", reject);
  });
  let bytes = 0;
  try {
    await withStorageWorkers(Object.entries(manifest), async ([path, file]) => {
      const content = await readPrivateObject(file.key);
      if (digest(content) !== file.digest)
        throw new HiveUnavailableError(
          "A snapshot file failed its integrity check.",
        );
      bytes += content.length;
      if (bytes > 50 * 1024 * 1024)
        throw new HiveUnavailableError(
          "This hive needs a streamed snapshot for more than 50 MB.",
        );
      pack.entry(
        {
          name: knowledgePath(path),
          mode: 0o444,
          type: "file",
          mtime: new Date(0),
        },
        content,
      );
    });
    pack.finalize();
    const archive = await complete;
    const key = `teams/${ctx.teamId}/snapshots/${revision}-${digest(archive)}.tar.gz`;
    await putPrivateObject(key, archive, "application/gzip");
    const token = randomBytes(32).toString("base64url"),
      expiresAt = new Date(Date.now() + 15 * 60000);
    await getSql()`INSERT INTO knowledge_snapshots (token_hash, team_id, member_id, revision, object_key, expires_at) VALUES (${digest(token)}, ${ctx.teamId}, ${ctx.memberId}, ${revision}, ${key}, ${expiresAt})`;
    return {
      revision,
      url: `${process.env.PUBLIC_URL ?? "https://gohive.dev"}/api/knowledge/snapshot?token=${token}`,
      expiresAt: expiresAt.toISOString(),
      files: Object.keys(manifest).length,
    };
  } catch (error) {
    pack.destroy();
    throw error;
  }
}

export async function downloadKnowledge(token: string): Promise<Buffer> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new HiveNotFoundError("Snapshot not found or expired.");
  const rows =
    await getSql()`SELECT s.object_key FROM knowledge_snapshots s JOIN members m ON m.id = s.member_id AND m.team_id = s.team_id WHERE s.token_hash = ${digest(token)} AND s.expires_at > now() AND m.removed_at IS NULL`;
  if (!rows.length)
    throw new HiveNotFoundError("Snapshot not found or expired.");
  return readPrivateObject(rows[0].object_key);
}
