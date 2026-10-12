import {
  earlyAccessInput, hivePushInput, hiveSearchInput, hiveAskInput, hiveRecentInput, hiveFeedbackInput,
  normalizeRepo, normalizeTags, parseSince, rankCandidates, redactSecrets,
  type AskResult, type EarlyAccessInput, type FeedbackResult, type HiveAskInput, type HiveContext,
  type HiveFeedbackInput, type HivePushInput, type HiveRecentInput, type HiveSearchInput,
  type LearningView, type MemberView, type PushResult, type SearchHit, type TeamOverview,
} from "@hivemind/core";
import { after } from "next/server";
import { z } from "zod";
import { getSql, hasEmbeddingColumn } from "./db/client";
import { newId } from "./db/ids";
import { HiveInputError, HiveNotFoundError } from "./errors";
import { embedText, synthesizeAnswer, extractiveAnswer, suggestTags } from "@/server/llm";

const minimumVectorSimilarity = 0.3;
const minimumLexemeCoverage = 0.5;

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HiveInputError("The input is invalid. Check the tool's fields and limits.");
  return result.data;
}

function view(row: Record<string, unknown>): LearningView {
  const date = (value: unknown) => new Date(value as string | Date).toISOString();
  return {
    id: String(row.id), title: String(row.title), body: String(row.body), kind: row.kind as LearningView["kind"],
    tags: row.tags as string[], repo: row.repo as string | null, paths: row.paths as string[], confidence: Number(row.confidence), source: row.source as LearningView["source"],
    author: { id: String(row.member_id), name: String(row.author_name) }, pushCount: Number(row.push_count),
    votes: { up: Number(row.up_votes), down: Number(row.down_votes), outdated: Number(row.outdated_votes) },
    createdAt: date(row.created_at), updatedAt: date(row.updated_at), lastPushedAt: date(row.last_pushed_at),
  };
}

function scheduleTags(ctx: HiveContext, learning: LearningView) {
  if (learning.tags.length || !process.env.ANTHROPIC_API_KEY) return;
  try {
    after(async () => {
      try {
        const tags = normalizeTags(await suggestTags(learning)).slice(0, 5);
        if (tags.length) await getSql()`UPDATE learnings SET tags = ${tags}, updated_at = now() WHERE id = ${learning.id} AND team_id = ${ctx.teamId} AND cardinality(tags) = 0`;
      } catch {}
    });
  } catch {}
}

export async function pushLearning(ctx: HiveContext, input: HivePushInput): Promise<PushResult> {
  const data = validate(hivePushInput, input);
  const repo = normalizeRepo(data.repo);
  const tags = normalizeTags(data.tags);
  const paths = [...new Set(data.paths.map((path) => path.trim()).filter(Boolean))];
  const title = redactSecrets(data.title.trim());
  const body = redactSecrets(data.body.trim());
  if (!title.text || !body.text) throw new HiveInputError("The title and body cannot be blank.");
  const sql = getSql();
  const supportsVector = await hasEmbeddingColumn();
  const embedding = supportsVector ? await embedText(`${title.text}\n\n${body.text}`) : null;
  const vector = embedding ? JSON.stringify(embedding) : null;
  const normalizedTitle = title.text.toLowerCase().replace(/\s+/g, " ");
  const result = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${ctx.teamId}), hashtext(${repo ?? ""}))`;
    const duplicates = vector
      ? await tx`SELECT id FROM learnings WHERE team_id = ${ctx.teamId} AND repo IS NOT DISTINCT FROM ${repo} AND embedding IS NOT NULL AND 1 - (embedding <=> ${vector}::vector) >= 0.90 ORDER BY embedding <=> ${vector}::vector LIMIT 1 FOR UPDATE`
      : await tx`SELECT id FROM learnings WHERE team_id = ${ctx.teamId} AND repo IS NOT DISTINCT FROM ${repo} AND lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = ${normalizedTitle} ORDER BY created_at LIMIT 1 FOR UPDATE`;
    const merged = duplicates.length > 0;
    const id: string = duplicates[0]?.id ?? newId("lrn");
    if (merged) {
      await tx`UPDATE learnings SET push_count = push_count + 1, last_pushed_at = now(), updated_at = now(), tags = ARRAY(SELECT DISTINCT unnest(tags || ${tags}::text[])), paths = ARRAY(SELECT DISTINCT unnest(paths || ${paths}::text[])), confidence = greatest(confidence, ${data.confidence}), body = CASE WHEN length(${body.text}) >= 1.5 * length(body) THEN ${body.text} ELSE body END WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      if (vector) await tx`UPDATE learnings SET embedding = ${vector}::vector WHERE id = ${id} AND team_id = ${ctx.teamId} AND body = ${body.text}`;
    } else {
      await tx`INSERT INTO learnings (id, team_id, member_id, title, body, kind, tags, repo, paths, confidence, source, session_ref) VALUES (${id}, ${ctx.teamId}, ${ctx.memberId}, ${title.text}, ${body.text}, ${data.kind}, ${tags}, ${repo}, ${paths}, ${data.confidence}, ${data.source}, ${data.sessionRef ?? null})`;
      if (vector) await tx`UPDATE learnings SET embedding = ${vector}::vector WHERE id = ${id} AND team_id = ${ctx.teamId}`;
    }
    await tx`INSERT INTO learning_pushes (id, learning_id, team_id, member_id, source, session_ref, merged) VALUES (${newId("psh")}, ${id}, ${ctx.teamId}, ${ctx.memberId}, ${data.source}, ${data.sessionRef ?? null}, ${merged})`;
    const rows = await tx`SELECT l.*, m.name AS author_name FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE l.id = ${id} AND l.team_id = ${ctx.teamId}`;
    const learning = view(rows[0]);
    return { id, merged, pushCount: learning.pushCount, redactions: title.count + body.count, learning };
  });
  scheduleTags(ctx, result.learning);
  return result;
}

export async function searchLearnings(ctx: HiveContext, input: HiveSearchInput): Promise<SearchHit[]> {
  const data = validate(hiveSearchInput, input);
  const sql = getSql();
  const tags = normalizeTags(data.tags ?? []);
  const embedding = await hasEmbeddingColumn() ? await embedText(data.query) : null;
  const tsquery = sql`replace(plainto_tsquery('english', ${data.query})::text, '&', '|')::tsquery`;
  const queryLexemes = sql`tsvector_to_array(to_tsvector('english', ${data.query}))`;
  const coverage = sql`(SELECT count(*) FROM unnest(tsvector_to_array(l.search)) AS lexeme WHERE lexeme = ANY(${queryLexemes}))::float / greatest(cardinality(${queryLexemes}), 1)`;
  const filter = sql`l.team_id = ${ctx.teamId} AND (${tags.length === 0} OR l.tags && ${tags}::text[])`;
  const ftsRows = await sql`SELECT l.*, m.name AS author_name, ts_rank_cd(l.search, ${tsquery}) AS fts FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE ${filter} AND l.search @@ ${tsquery} AND ${coverage} >= ${minimumLexemeCoverage} ORDER BY fts DESC LIMIT 40`;
  const vectorRows = embedding ? await sql`SELECT l.*, m.name AS author_name, 1 - (l.embedding <=> ${JSON.stringify(embedding)}::vector) AS vector, ts_rank_cd(l.search, ${tsquery}) AS fts FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE ${filter} AND l.embedding IS NOT NULL ORDER BY l.embedding <=> ${JSON.stringify(embedding)}::vector LIMIT 40` : [];
  const candidates = new Map<string, LearningView & { vector: number | null; fts: number }>();
  for (const row of ftsRows) candidates.set(row.id, { ...view(row), vector: null, fts: Number(row.fts) });
  for (const row of vectorRows) {
    const vector = Number(row.vector);
    if (vector >= minimumVectorSimilarity || candidates.has(row.id)) candidates.set(row.id, { ...view(row), vector, fts: Number(row.fts) });
  }
  if (!candidates.size) {
    const words = data.query.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length) {
      const prefix = words.map((word) => `${word}:*`).join(" & ");
      const rows = await sql`SELECT l.*, m.name AS author_name, ts_rank_cd(l.search, to_tsquery('english', ${prefix})) AS fts FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE ${filter} AND l.search @@ to_tsquery('english', ${prefix}) ORDER BY fts DESC LIMIT 40`;
      for (const row of rows) candidates.set(row.id, { ...view(row), vector: null, fts: Number(row.fts) });
    }
  }
  return rankCandidates([...candidates.values()], data.repo).slice(0, data.limit);
}

export async function askHive(ctx: HiveContext, input: HiveAskInput): Promise<AskResult> {
  const data = validate(hiveAskInput, input);
  const hits = await searchLearnings(ctx, { query: data.question.slice(0, 500), repo: data.repo, limit: 8 });
  let result: AskResult;
  if (!hits.length) result = { answer: "The hive has nothing on this yet. Use hive_push once you find the answer.", citations: [], confidence: "low", gaps: "No matching learnings have been shared yet.", synthesized: false };
  else {
    try { result = await synthesizeAnswer(data.question, hits); } catch { result = extractiveAnswer(hits); }
    const ids = new Set(hits.map((hit) => hit.id));
    result = { ...result, citations: result.citations.filter((citation) => ids.has(citation.id)) };
  }
  await getSql()`INSERT INTO ask_log (id, team_id, member_id, question, answer, cited_ids, synthesized) VALUES (${newId("ask")}, ${ctx.teamId}, ${ctx.memberId}, ${data.question}, ${result.answer}, ${result.citations.map((citation) => citation.id)}, ${result.synthesized})`;
  return result;
}

export async function recentLearnings(ctx: HiveContext, input: HiveRecentInput): Promise<LearningView[]> {
  const data = validate(hiveRecentInput, input);
  let since: Date;
  try { since = parseSince(data.since); } catch { throw new HiveInputError("Since must be an ISO datetime or a positive duration such as 24h or 7d."); }
  const repo = normalizeRepo(data.repo);
  const rows = await getSql()`SELECT l.*, m.name AS author_name FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE l.team_id = ${ctx.teamId} AND l.last_pushed_at >= ${since} AND (${repo}::text IS NULL OR l.repo = ${repo}) ORDER BY l.last_pushed_at DESC LIMIT ${data.limit}`;
  return rows.map(view);
}

export async function recordFeedback(ctx: HiveContext, input: HiveFeedbackInput): Promise<FeedbackResult> {
  const data = validate(hiveFeedbackInput, input);
  return getSql().begin(async (tx) => {
    const rows = await tx`SELECT id FROM learnings WHERE id = ${data.id} AND team_id = ${ctx.teamId} FOR UPDATE`;
    if (!rows.length) throw new HiveNotFoundError();
    await tx`INSERT INTO feedback (learning_id, member_id, team_id, vote, note) VALUES (${data.id}, ${ctx.memberId}, ${ctx.teamId}, ${data.vote}, ${data.note ?? null}) ON CONFLICT (learning_id, member_id) DO UPDATE SET vote = EXCLUDED.vote, note = EXCLUDED.note, updated_at = now() WHERE feedback.team_id = ${ctx.teamId}`;
    const counts = await tx`SELECT count(*) FILTER (WHERE vote = 'up')::int AS up, count(*) FILTER (WHERE vote = 'down')::int AS down, count(*) FILTER (WHERE vote = 'outdated')::int AS outdated FROM feedback WHERE learning_id = ${data.id} AND team_id = ${ctx.teamId}`;
    const votes = { up: Number(counts[0].up), down: Number(counts[0].down), outdated: Number(counts[0].outdated) };
    await tx`UPDATE learnings SET up_votes = ${votes.up}, down_votes = ${votes.down}, outdated_votes = ${votes.outdated}, updated_at = now() WHERE id = ${data.id} AND team_id = ${ctx.teamId}`;
    return { id: data.id, votes };
  });
}

export async function getLearning(ctx: HiveContext, id: string): Promise<LearningView | null> {
  const rows = await getSql()`SELECT l.*, m.name AS author_name FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE l.id = ${id} AND l.team_id = ${ctx.teamId}`;
  return rows[0] ? view(rows[0]) : null;
}

export async function listMembers(ctx: HiveContext): Promise<MemberView[]> {
  const rows = await getSql()`SELECT m.*, count(l.id)::int AS learning_count FROM members m LEFT JOIN learnings l ON l.member_id = m.id AND l.team_id = ${ctx.teamId} WHERE m.team_id = ${ctx.teamId} GROUP BY m.id ORDER BY m.created_at`;
  return rows.map((row) => ({ id: row.id, name: row.name, joinedAt: row.created_at.toISOString(), lastSeenAt: row.last_seen_at?.toISOString() ?? null, learningCount: Number(row.learning_count) }));
}

export async function teamOverview(ctx: HiveContext): Promise<TeamOverview> {
  const sql = getSql();
  const rows = await sql`SELECT name, invite_code, (SELECT count(*)::int FROM learnings WHERE team_id = ${ctx.teamId}) AS learning_count, (SELECT count(*)::int FROM members WHERE team_id = ${ctx.teamId}) AS member_count FROM teams WHERE id = ${ctx.teamId}`;
  if (!rows[0]) throw new HiveNotFoundError("Team not found.");
  const repos = await sql`SELECT DISTINCT repo FROM learnings WHERE team_id = ${ctx.teamId} AND repo IS NOT NULL ORDER BY repo`;
  return { teamName: rows[0].name, inviteCode: rows[0].invite_code, learningCount: Number(rows[0].learning_count), memberCount: Number(rows[0].member_count), repos: repos.map((row) => row.repo) };
}

export async function submitEarlyAccess(input: EarlyAccessInput): Promise<{ id: string }> {
  const data = validate(earlyAccessInput, input);
  const id = newId("ea");
  await getSql()`INSERT INTO early_access (id, name, email, company, team_size, source) VALUES (${id}, ${data.name}, ${data.email}, ${data.company}, ${data.teamSize}, ${data.source ?? null})`;
  return { id };
}
