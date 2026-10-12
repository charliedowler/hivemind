import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import tar from "tar-stream";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { hivePushInput, type HiveContext } from "@hivemind/core";
import { createTeam } from "./auth";
import { getSql } from "./db/client";
import { pushLearning } from "./hive";
import {
  browseKnowledge,
  downloadKnowledge,
  ensureKnowledge,
  knowledgePath,
  readKnowledge,
  snapshotKnowledge,
} from "./knowledge-tree";
import { putPrivateObject, readPrivateObject } from "./blob-store";
const state = vi.hoisted(() => ({
  jobs: [] as Array<() => Promise<void>>,
  blobs: new Map<string, Buffer>(),
}));
vi.mock("next/server", () => ({
  after: (job: () => Promise<void>) => state.jobs.push(job),
}));
vi.mock("./llm/embeddings", () => ({ embedText: async () => null }));
vi.mock("./blob-store", () => ({
  putPrivateObject: vi.fn(async (key: string, value: Buffer) => {
    state.blobs.set(key, value);
  }),
  readPrivateObject: vi.fn(async (key: string) => {
    const blob = state.blobs.get(key);
    if (!blob) throw new Error("Missing blob");
    return blob;
  }),
}));

it.each(["../other", "/other", "repos/../other", "a\\b", "a//b", "a\u0000b"])(
  "rejects unsafe path %s",
  (path) => expect(() => knowledgePath(path)).toThrow(),
);

async function unpack(archive: Buffer) {
  const files = new Map<string, string>(),
    extract = tar.extract();
  const done = new Promise<void>((resolve, reject) => {
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      expect(header.type).toBe("file");
      expect(header.name).not.toMatch(/^\//);
      stream.on("data", (chunk: unknown) => {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      });
      stream.on("end", () => {
        files.set(header.name, Buffer.concat(chunks).toString());
        next();
      });
      stream.resume();
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
  });
  extract.end(gunzipSync(archive));
  await done;
  return files;
}

describe.skipIf(!process.env.DATABASE_URL)(
  "knowledge publication integration",
  () => {
    let a: HiveContext, b: HiveContext;
    const teams: string[] = [];
    const push = (title: string, extra = {}) =>
      pushLearning(
        a,
        hivePushInput.parse({
          title,
          body: `${title} is a recorded fact.`,
          repo: "owner/service",
          tags: ["storage"],
          ...extra,
        }),
      );
    beforeAll(async () => {
      a = (await createTeam({ teamName: "Tree A", memberName: "Alice" })).ctx;
      b = (await createTeam({ teamName: "Tree B", memberName: "Bob" })).ctx;
      teams.push(a.teamId, b.teamId);
    });
    beforeEach(() => {
      state.jobs.length = 0;
      vi.mocked(putPrivateObject).mockClear();
    });
    afterAll(async () => {
      const sql = getSql();
      for (const table of [
        "feedback",
        "learning_pushes",
        "ask_log",
        "learnings",
        "api_keys",
        "web_sessions",
        "members",
        "teams",
      ]) {
        if (table === "teams")
          await sql`DELETE FROM teams WHERE id = ANY(${teams}::text[])`;
        else
          await sql`DELETE FROM ${sql(table)} WHERE team_id = ANY(${teams}::text[])`;
      }
      await sql.end();
    });
    it("regenerates on push and stores only redacted evidence in private objects", async () => {
      const secret = `ghp_${"z".repeat(36)}`;
      const result = await push("Tree cedar", {
        evidence: {
          session_excerpt: `Token ${secret}`,
          diff: "+ recorded fact",
        },
      });
      expect(state.jobs.length).toBeGreaterThan(0);
      for (const job of state.jobs) await job();
      const index = await readKnowledge(a, "INDEX.md");
      expect(index.content).toContain("Tree cedar");
      const listing = await browseKnowledge(a, "repos/owner/service/general");
      const path = listing.entries.find((entry) =>
        entry.path.includes(result.id),
      )!.path;
      expect((await readKnowledge(a, path)).content).toContain(
        "Tree cedar is a recorded fact.",
      );
      expect(
        (await browseKnowledge(a)).entries.map((entry) => entry.name),
      ).toContain("topics");
      expect((await readKnowledge(a, "topics/storage.md")).content).toContain(
        result.id,
      );
      const [evidence] =
        await getSql()`SELECT * FROM learning_evidence WHERE team_id = ${a.teamId} AND learning_id = ${result.id}`;
      expect(evidence.uploaded_at).not.toBeNull();
      expect(evidence.payload).toBeNull();
      const raw = (await readPrivateObject(evidence.object_key)).toString();
      expect(JSON.parse(raw).evidence.session_excerpt).toBe("Token [redacted]");
      expect(JSON.parse(raw).evidence.diff).toBe("+ recorded fact");
      expect(raw).toContain("[redacted]");
      expect(raw).not.toContain(secret);
      expect(createHash("sha256").update(raw).digest("hex")).toBe(
        evidence.digest,
      );
      expect((await readKnowledge(b, "INDEX.md")).content).not.toContain(
        "Tree cedar",
      );
      await expect(readKnowledge(b, path)).rejects.toThrow("not found");
      await expect(browseKnowledge(b, "repos/owner/service")).rejects.toThrow(
        "not found",
      );
    });
    it("preserves the last manifest and pending evidence when upload fails", async () => {
      const prior = await ensureKnowledge(a);
      const cell = await push("Tree willow");
      vi.mocked(putPrivateObject).mockRejectedValueOnce(
        new Error("Store unavailable"),
      );
      await expect(ensureKnowledge(a)).rejects.toThrow("Store unavailable");
      const [pending] =
        await getSql()`SELECT * FROM knowledge_state WHERE team_id = ${a.teamId}`;
      expect(Number(pending.published_revision)).toBe(prior.revision);
      expect(Number(pending.revision)).toBeGreaterThan(prior.revision);
      const [evidence] =
        await getSql()`SELECT uploaded_at, payload FROM learning_evidence WHERE team_id = ${a.teamId} AND learning_id = ${cell.id}`;
      expect(evidence.uploaded_at).toBeNull();
      expect(evidence.payload).not.toBeNull();
      expect((await readKnowledge(a, "INDEX.md")).content).toContain(
        "Tree willow",
      );
    });
    it("does not let an older generation replace a newer published tree", async () => {
      await push("Generation early");
      vi.mocked(putPrivateObject).mockImplementationOnce(async (key, value) => {
        state.blobs.set(key, value);
        await push("Generation late");
        await ensureKnowledge(a);
      });
      await ensureKnowledge(a);
      expect((await readKnowledge(a, "INDEX.md")).content).toContain(
        "Generation late",
      );
      const [row] =
        await getSql()`SELECT revision, published_revision FROM knowledge_state WHERE team_id = ${a.teamId}`;
      expect(row.revision).toBe(row.published_revision);
    });
    it("publishes changed verification markers without another push", async () => {
      const cell = await push("Deadline row", {
        verify_after: new Date(Date.now() + 60000).toISOString(),
      });
      await ensureKnowledge(a);
      await getSql()`UPDATE learnings SET verify_after = now() - interval '1 second' WHERE id = ${cell.id} AND team_id = ${a.teamId}`;
      const tree = await readKnowledge(a, "INDEX.md");
      expect(tree.content).toContain("verify before use");
      const before = tree.revision;
      await getSql()`UPDATE knowledge_state SET next_verify_at = now() - interval '1 second' WHERE team_id = ${a.teamId}`;
      expect((await ensureKnowledge(a)).revision).toBeGreaterThan(before);
    });
    it("round-trips a consistent tarball and expires or revokes download tokens", async () => {
      const snapshot = await snapshotKnowledge(a);
      const token = new URL(snapshot.url).searchParams.get("token")!;
      const files = await unpack(await downloadKnowledge(token));
      expect(files.get("INDEX.md")).toContain("Tree cedar");
      expect(files.size).toBe(snapshot.files);
      await expect(downloadKnowledge("wrong")).rejects.toThrow("not found");
      await getSql()`UPDATE knowledge_snapshots SET expires_at = now() - interval '1 minute' WHERE team_id = ${a.teamId}`;
      await expect(downloadKnowledge(token)).rejects.toThrow("expired");
      const second = await snapshotKnowledge(b);
      const bToken = new URL(second.url).searchParams.get("token")!;
      expect(
        (await unpack(await downloadKnowledge(bToken))).get("INDEX.md"),
      ).not.toContain("Tree cedar");
      await getSql()`UPDATE members SET removed_at = now() WHERE id = ${b.memberId} AND team_id = ${b.teamId}`;
      await expect(downloadKnowledge(bToken)).rejects.toThrow("expired");
    });
  },
);
