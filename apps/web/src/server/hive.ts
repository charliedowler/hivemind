import {
  earlyAccessInput,
  hivePushInput,
  hiveSearchInput,
  hiveAskInput,
  hiveRecentInput,
  hiveFeedbackInput,
  normalizeRepo,
  normalizeTags,
  parseSince,
  rankCandidates,
  redactSecrets,
  type AskResult,
  type EarlyAccessInput,
  type FeedbackResult,
  type HiveAskInput,
  type HiveContext,
  type HiveFeedbackInput,
  type HivePushInput,
  type HiveRecentInput,
  type HiveSearchInput,
  type LearningView,
  type MemberView,
  type PushResult,
  type SearchHit,
  type TeamOverview,
} from "@hivemind/core";
import {
  analyticsTransaction,
  recordEvent,
  recordMutation,
  withOperation,
  pushSource,
} from "./analytics/events";
import { frictionSummary, frictionAnswer, isFrictionAsk } from "./friction";
import { classifyPush, classifyAsk, classificationJson } from "./classify";
import { learningView as view } from "./learning-view";
import {
  lockLearningWrites,
  acceptSupersession,
  verificationHorizon,
  answerLifecycleContext,
  appendLifecycleContext,
} from "./lifecycle";
import {
  prepareConflicts,
  applyConflictDecision,
  recordConflictEvent,
  retryRelatedConflicts,
} from "./conflict-decisions";
import { judgeMemory, rerankMemory } from "./memory-judgments";
import {
  queueEvidence,
  scheduleKnowledge,
  ensureKnowledge,
} from "./knowledge-tree";
import { after } from "next/server";
import { z } from "zod";
import { getSql, hasEmbeddingColumn } from "./db/client";
import { newId } from "./db/ids";
import { saveEarlyAccess } from "./early-access";
import { HiveInputError, HiveNotFoundError } from "./errors";
import {
  embedText,
  synthesizeAnswer,
  extractiveAnswer,
  suggestTags,
} from "@/server/llm";

const minimumVectorSimilarity = 0.3;
const minimumLexemeCoverage = 0.5;

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HiveInputError("Check the tool's fields and limits.");
  return result.data;
}

function scheduleTags(ctx: HiveContext, learning: LearningView) {
  if (learning.tags.length || !process.env.ANTHROPIC_API_KEY) return;
  try {
    after(async () => {
      try {
        const tags = normalizeTags(await suggestTags(learning)).slice(0, 5);
        if (tags.length) {
          await getSql()`UPDATE learnings SET tags = ${tags}, updated_at = now() WHERE id = ${learning.id} AND team_id = ${ctx.teamId} AND cardinality(tags) = 0`;
          await ensureKnowledge(ctx);
        }
      } catch {}
    });
  } catch {}
}

export function pushLearning(
  ctx: HiveContext,
  input: HivePushInput,
): Promise<PushResult> {
  return withOperation(ctx, "push", () => pushLearningAction(ctx, input));
}

async function pushLearningAction(
  ctx: HiveContext,
  input: HivePushInput,
): Promise<PushResult> {
  const data = validate(hivePushInput, input);
  const repo = normalizeRepo(
    data.repo ? redactSecrets(data.repo).text : undefined,
  );
  const tags = normalizeTags(data.tags.map((tag) => redactSecrets(tag).text));
  const paths = [
    ...new Set(
      data.paths.map((path) => redactSecrets(path.trim()).text).filter(Boolean),
    ),
  ];
  const title = redactSecrets(data.title.trim());
  const body = redactSecrets(data.body.trim());
  const workaround = redactSecrets(data.workaround ?? "");
  if (!title.text || !body.text)
    throw new HiveInputError("Enter a title and a body for the learning.");
  const { classification, decision } = await classifyPush({
    title: title.text,
    body: body.text,
    repo,
    workaround: workaround.text,
    blocked: data.blocked,
    cost: data.cost,
    kind: data.kind,
  });
  if (decision.action === "refuse") {
    await recordEvent({
      name: "learning.pushed",
      outcome: "refused",
      reasonCode: "sensitive_refused",
      properties: {
        kind: decision.kind,
        source: pushSource(data.source),
        sensitiveRefused: true,
        worthSharingProbability: classification?.answers.worthSharing.noul,
        sensitiveProbability: classification?.answers.sensitive.noul,
        kindProbability: classification?.answers.kind.confidence,
        kindProbabilities: classification?.answers.kind.probabilities,
        repoAreaProbability: classification?.answers.repoArea.confidence,
        severity: classification?.answers.severity.score,
      },
    });
    throw new HiveInputError(
      "This observation may contain a secret or personal data. Remove identifying details before sharing it.",
    );
  }
  const kind = decision.kind;
  if (classification)
    tags.push(...decision.tags.filter((tag) => !tags.includes(tag)));
  const sql = getSql();
  const supportsVector = await hasEmbeddingColumn();
  const embedding = supportsVector
    ? await embedText(`${title.text}\n\n${body.text}`)
    : null;
  const vector = embedding ? JSON.stringify(embedding) : null;
  const normalizedTitle = title.text.toLowerCase().replace(/\s+/g, " ");
  const candidateRows = vector
    ? await sql`SELECT id, title, body, revision FROM learnings WHERE team_id = ${ctx.teamId} AND kind = ${kind} AND repo IS NOT DISTINCT FROM ${repo} AND lifecycle IN ('fresh','confirmed') AND (lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = ${normalizedTitle} OR (embedding IS NOT NULL AND 1 - (embedding <=> ${vector}::vector) >= 0.8)) ORDER BY (lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = ${normalizedTitle}) DESC, embedding <=> ${vector}::vector LIMIT 4`
    : await sql`SELECT id, title, body, revision FROM learnings WHERE team_id = ${ctx.teamId} AND kind = ${kind} AND repo IS NOT DISTINCT FROM ${repo} AND lifecycle IN ('fresh','confirmed') AND lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = ${normalizedTitle} ORDER BY created_at DESC LIMIT 4`;
  const judgment = await judgeMemory(
    { title: title.text, body: body.text, repo },
    candidateRows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      revision: row.revision,
    })),
  );
  tags.push(...judgment.tags.filter((tag) => !tags.includes(tag)));
  const prepared = data.supersedes
    ? []
    : await prepareConflicts(
        ctx,
        judgment.relations.filter(
          (item) =>
            ["update", "contradiction"].includes(item.relation) &&
            item.confidence >= 0.7,
        ),
        {
          id: "incoming",
          revision: 1,
          title: title.text,
          body: body.text,
          author: ctx.memberName,
          createdAt: new Date().toISOString(),
          lastPushedAt: new Date().toISOString(),
          votes: { up: 0, down: 0, outdated: 0 },
          evidence: [
            {
              payload: JSON.parse(redactSecrets(JSON.stringify(data)).text),
              digest: "incoming",
              createdAt: new Date().toISOString(),
            },
          ],
        },
      );
  const preparedById = new Map(
    prepared.map((item) => [item.id, item.judgment]),
  );
  const applied: NonNullable<
    Awaited<ReturnType<typeof applyConflictDecision>>
  >[] = [];
  const result = await analyticsTransaction(() =>
    sql.begin(async (tx) => {
      await lockLearningWrites(tx, ctx);
      const current =
        await tx`SELECT * FROM learnings WHERE team_id = ${ctx.teamId} AND kind = ${kind} AND repo IS NOT DISTINCT FROM ${repo} AND lifecycle IN ('fresh','confirmed') AND (id = ANY(${candidateRows.map((row) => row.id)}::text[]) OR lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = ${normalizedTitle}) ORDER BY created_at DESC FOR UPDATE`;
      const relations = judgment.relations.filter((item) =>
        current.some(
          (row) => row.id === item.id && row.revision === item.revision,
        ),
      );
      const normalize = (text: string) =>
        text.trim().toLowerCase().replace(/\s+/g, " ");
      const duplicate = data.supersedes
        ? undefined
        : current.find((row) => {
            const relation = relations.find((item) => item.id === row.id);
            if (
              relation &&
              ["update", "contradiction"].includes(relation.relation)
            )
              return false;
            return (
              (normalize(row.title) === normalizedTitle &&
                normalize(row.body) === normalize(body.text)) ||
              (kind === "friction" &&
                normalize(row.title) === normalizedTitle) ||
              (relation?.relation === "same" && relation.confidence >= 0.9)
            );
          });
      let merged = Boolean(duplicate);
      let id: string = duplicate?.id ?? newId("lrn");
      if (merged) {
        await tx`UPDATE learnings SET push_count = push_count + 1, last_pushed_at = now(), updated_at = now(), tags = ARRAY(SELECT DISTINCT unnest(tags || ${tags}::text[])), paths = ARRAY(SELECT DISTINCT unnest(paths || ${paths}::text[])), confidence = greatest(confidence, ${data.confidence}), lifecycle = 'confirmed', classification = ${classification ? tx.json(classificationJson(classification)) : null}, area = coalesce(area, ${data.area ?? null}), cost = CASE WHEN cost IS NULL AND ${data.cost ?? null}::integer IS NULL THEN NULL ELSE coalesce(cost, 0) + coalesce(${data.cost ?? null}::integer, 0) END, blocked = blocked OR ${data.blocked}, workaround = coalesce(nullif(${workaround.text}, ''), workaround) WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      } else {
        await tx`INSERT INTO learnings (id, team_id, member_id, title, body, kind, tags, repo, paths, confidence, source, session_ref, area, cost, blocked, workaround, classification, verify_after) VALUES (${id}, ${ctx.teamId}, ${ctx.memberId}, ${title.text}, ${body.text}, ${kind}, ${tags}, ${repo}, ${paths}, ${data.confidence}, ${data.source}, ${data.sessionRef ? redactSecrets(data.sessionRef).text : null}, ${data.area ?? null}, ${data.cost ?? null}, ${data.blocked}, ${workaround.text || null}, ${classification ? tx.json(classificationJson(classification)) : null}, ${verificationHorizon(kind, data.area, tags, data.verify_after)})`;
        if (vector)
          await tx`UPDATE learnings SET embedding = ${vector}::vector WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      }
      if (duplicate && duplicate.lifecycle !== "confirmed")
        await recordMutation({
          name: "learning.lifecycle_changed",
          learningId: id,
          reasonCode: "duplicate",
          properties: {
            previousState: duplicate.lifecycle,
            state: "confirmed",
          },
        });
      const pushId = newId("psh");
      await tx`INSERT INTO learning_pushes (id, learning_id, team_id, member_id, source, session_ref, merged, area, cost, blocked, classification) VALUES (${pushId}, ${id}, ${ctx.teamId}, ${ctx.memberId}, ${data.source}, ${data.sessionRef ? redactSecrets(data.sessionRef).text : null}, ${merged}, ${data.area ?? null}, ${data.cost ?? null}, ${data.blocked}, ${classification ? tx.json(classificationJson(classification)) : null})`;
      await queueEvidence(tx, ctx, id, pushId, data);
      if (!merged) {
        const proposals = data.supersedes
          ? [
              {
                id: data.supersedes,
                relation: "update" as const,
                confidence: 1,
              },
            ]
          : relations
              .filter(
                (item) =>
                  ["update", "contradiction"].includes(item.relation) &&
                  item.confidence >= 0.7,
              )
              .sort((a, b) => {
                const terminal = (id: string) =>
                  ["keep_old", "mark_outdated", "retract_new"].includes(
                    preparedById.get(id)?.decision ?? "",
                  );
                return (
                  Number(terminal(b.id)) - Number(terminal(a.id)) ||
                  b.confidence - a.confidence
                );
              });
        for (const proposal of proposals) {
          const oldRows =
            await tx`SELECT * FROM learnings WHERE id = ${proposal.id} AND team_id = ${ctx.teamId} FOR UPDATE`;
          const old = oldRows[0];
          if (!old) throw new HiveNotFoundError();
          if (old.superseded_by || old.lifecycle === "retracted")
            throw new HiveInputError(
              "Replace the current cell in the chain instead.",
            );
          const edgeId = newId("sup");
          await tx`INSERT INTO learning_supersessions (id, team_id, older_id, newer_id, older_revision, newer_revision, relation, confidence, reason) VALUES (${edgeId}, ${ctx.teamId}, ${old.id}, ${id}, ${old.revision}, 1, ${proposal.relation}, ${proposal.confidence}, 'Jev proposes a replacement')`;
          if (data.supersedes)
            await acceptSupersession(
              tx,
              ctx,
              edgeId,
              "Pusher explicitly replaces this cell",
            );
          else {
            const judgment = preparedById.get(old.id);
            if (judgment) {
              const decision = await applyConflictDecision(
                tx,
                ctx,
                edgeId,
                judgment,
              );
              if (decision) {
                applied.push(decision);
                if (decision.mergedInto) {
                  id = decision.mergedInto;
                  merged = true;
                  break;
                }
                if (
                  ["retract_new", "mark_outdated"].includes(decision.decision)
                )
                  break;
              }
            }
          }
        }
      }
      const rows =
        await tx`SELECT l.*, m.name AS author_name FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE l.id = ${id} AND l.team_id = ${ctx.teamId}`;
      const learning = view(rows[0]);
      return {
        id,
        pushId,
        merged,
        pushCount: learning.pushCount,
        redactions: title.count + body.count + workaround.count,
        learning,
      };
    }),
  );
  await recordEvent({
    name: "learning.pushed",
    learningId: result.id,
    properties: {
      kind,
      source: pushSource(data.source),
      merged: result.merged,
      sensitiveRefused: false,
      worthSharingProbability: classification?.answers.worthSharing.noul,
      sensitiveProbability: classification?.answers.sensitive.noul,
      kindProbability: classification?.answers.kind.confidence,
      kindProbabilities: classification?.answers.kind.probabilities,
      repoAreaProbability: classification?.answers.repoArea.confidence,
      severity: classification?.answers.severity.score,
      area: data.area,
      frictionMinutes: kind === "friction" ? data.cost : null,
      blocked: kind === "friction" ? data.blocked : null,
    },
  });
  await Promise.all(
    applied.map((decision) => recordConflictEvent(ctx, decision)),
  );
  const retried = await retryRelatedConflicts(
    ctx,
    result.id,
    applied.map((record) => record.edgeId),
  );
  if (retried.length) {
    result.learning = (await getLearning(ctx, result.id)) ?? result.learning;
    result.pushCount = result.learning.pushCount;
  }
  if (!classification) scheduleTags(ctx, result.learning);
  scheduleKnowledge(ctx);
  return {
    ...result,
    decisions: [...applied, ...retried].map(
      ({ id, decision, reason, confidence, model }) => ({
        id,
        decision,
        reason,
        confidence,
        model,
      }),
    ),
  };
}

export function searchLearnings(
  ctx: HiveContext,
  input: HiveSearchInput,
): Promise<SearchHit[]> {
  return withOperation(ctx, "search", () => searchLearningsAction(ctx, input));
}

async function searchLearningsAction(
  ctx: HiveContext,
  input: HiveSearchInput,
): Promise<SearchHit[]> {
  const started = performance.now();
  const data = validate(hiveSearchInput, input);
  const sql = getSql();
  const tags = normalizeTags(data.tags ?? []);
  const embedding = (await hasEmbeddingColumn())
    ? await embedText(data.query)
    : null;
  const tsquery = sql`replace(plainto_tsquery('english', ${data.query})::text, '&', '|')::tsquery`;
  const queryLexemes = sql`tsvector_to_array(to_tsvector('english', ${data.query}))`;
  const coverage = sql`(SELECT count(*) FROM unnest(tsvector_to_array(l.search)) AS lexeme WHERE lexeme = ANY(${queryLexemes}))::float / greatest(cardinality(${queryLexemes}), 1)`;
  const filter = sql`l.team_id = ${ctx.teamId} AND (${data.include_history ?? false} OR l.lifecycle IN ('fresh','confirmed')) AND (${tags.length === 0} OR l.tags && ${tags}::text[]) AND (${data.kind ?? null}::text IS NULL OR l.kind = ${data.kind ?? null})`;
  const ftsRows =
    await sql`SELECT l.*, m.name AS author_name, ts_rank_cd(l.search, ${tsquery}) AS fts FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE ${filter} AND l.search @@ ${tsquery} AND ${coverage} >= ${minimumLexemeCoverage} ORDER BY fts DESC LIMIT 40`;
  const vectorRows = embedding
    ? await sql`SELECT l.*, m.name AS author_name, 1 - (l.embedding <=> ${JSON.stringify(embedding)}::vector) AS vector, ts_rank_cd(l.search, ${tsquery}) AS fts FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE ${filter} AND l.embedding IS NOT NULL ORDER BY l.embedding <=> ${JSON.stringify(embedding)}::vector LIMIT 40`
    : [];
  const candidates = new Map<
    string,
    LearningView & { vector: number | null; fts: number }
  >();
  for (const row of ftsRows)
    candidates.set(row.id, {
      ...view(row),
      vector: null,
      fts: Number(row.fts),
    });
  for (const row of vectorRows) {
    const vector = Number(row.vector);
    if (vector >= minimumVectorSimilarity || candidates.has(row.id))
      candidates.set(row.id, { ...view(row), vector, fts: Number(row.fts) });
  }
  let prefixUsed = false;
  if (!candidates.size) {
    const words = data.query.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length) {
      prefixUsed = true;
      const prefix = words.map((word) => `${word}:*`).join(" & ");
      const rows =
        await sql`SELECT l.*, m.name AS author_name, ts_rank_cd(l.search, to_tsquery('english', ${prefix})) AS fts FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE ${filter} AND l.search @@ to_tsquery('english', ${prefix}) ORDER BY fts DESC LIMIT 40`;
      for (const row of rows)
        candidates.set(row.id, {
          ...view(row),
          vector: null,
          fts: Number(row.fts),
        });
    }
  }
  const hits = rankCandidates([...candidates.values()], data.repo).slice(
    0,
    data.limit,
  );
  await recordEvent({
    name: "search.performed",
    latencyMs: performance.now() - started,
    properties: {
      resultCount: hits.length,
      topScoreBand: !hits.length
        ? "none"
        : hits[0].score >= 0.7
          ? "high"
          : hits[0].score >= 0.4
            ? "medium"
            : "low",
      vectorUsed: embedding !== null,
      textUsed: ftsRows.length > 0,
      prefixUsed,
      recencyUsed: true,
      votesUsed: true,
      repoBoostUsed: Boolean(data.repo),
    },
  });
  return hits;
}

export function askHive(
  ctx: HiveContext,
  input: HiveAskInput,
): Promise<AskResult> {
  return withOperation(ctx, "ask", () => askHiveAction(ctx, input));
}

async function askHiveAction(
  ctx: HiveContext,
  input: HiveAskInput,
): Promise<AskResult> {
  const started = performance.now();
  const data = validate(hiveAskInput, input);
  const friction = isFrictionAsk(data.question)
    ? await frictionSummary(ctx, data.repo)
    : null;
  if (friction && friction.count) {
    const cells =
      await getSql()`SELECT l.*, m.name AS author_name FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE l.team_id = ${ctx.teamId} AND l.id = ANY(${friction.cells.map((cell) => cell.id)}::text[])`;
    const result = appendLifecycleContext(
      frictionAnswer(friction),
      await answerLifecycleContext(ctx, cells.map(view)),
    );
    await getSql()`INSERT INTO ask_log (id, team_id, member_id, question, answer, cited_ids, synthesized) VALUES (${newId("ask")}, ${ctx.teamId}, ${ctx.memberId}, ${data.question}, ${result.answer}, ${result.citations.map((c) => c.id)}, false)`;
    await recordEvent({
      name: "ask.performed",
      latencyMs: performance.now() - started,
      reasonCode: "friction_summary",
      properties: {
        retrievedCount: cells.length,
        gateDecision: "answer",
        model: null,
        citedCount: result.citations.length,
        gapReported: Boolean(result.gaps),
        synthesized: false,
      },
    });
    return result;
  }
  const hits = await rerankMemory(
    data.question,
    await searchLearnings(ctx, {
      query: data.question.slice(0, 500),
      repo: data.repo,
      limit: 8,
    }),
  );
  const [context, relevance] = await Promise.all([
    answerLifecycleContext(ctx, hits),
    classifyAsk(data.question, hits),
  ]);
  let result: AskResult;
  if (relevance.decision === "gap")
    result = {
      answer:
        "The hive has no learning that answers this yet. Use hive_push to save what you find.",
      citations: [],
      confidence: "low",
      gaps: "The matching cells do not have enough evidence to answer this question.",
      synthesized: false,
    };
  else {
    try {
      result = await synthesizeAnswer(data.question, hits, context.prompt);
    } catch {
      result = extractiveAnswer(hits);
    }
    const ids = new Set(hits.map((hit) => hit.id));
    result = {
      ...result,
      citations: result.citations.filter((citation) => ids.has(citation.id)),
    };
  }
  if (result.citations.length) result = appendLifecycleContext(result, context);
  await getSql()`INSERT INTO ask_log (id, team_id, member_id, question, answer, cited_ids, synthesized, classification) VALUES (${newId("ask")}, ${ctx.teamId}, ${ctx.memberId}, ${data.question}, ${result.answer}, ${result.citations.map((citation) => citation.id)}, ${result.synthesized}, ${relevance.classification ? getSql().json(classificationJson(relevance.classification)) : null})`;
  await recordEvent({
    name: "ask.performed",
    latencyMs: performance.now() - started,
    outcome: relevance.decision,
    reasonCode:
      relevance.decision === "gap"
        ? hits.length
          ? "weak_evidence"
          : "no_results"
        : relevance.classification
          ? null
          : "fallback_gate",
    properties: {
      retrievedCount: hits.length,
      gateDecision: relevance.decision,
      relevanceProbability: relevance.classification?.answers.relevant.noul,
      model: result.synthesized ? "claude-sonnet-5-5" : null,
      citedCount: result.citations.length,
      gapReported: Boolean(result.gaps),
      synthesized: result.synthesized,
    },
  });
  return result;
}

export function recentLearnings(
  ctx: HiveContext,
  input: HiveRecentInput,
): Promise<LearningView[]> {
  return withOperation(ctx, "recent", () => recentLearningsAction(ctx, input));
}

async function recentLearningsAction(
  ctx: HiveContext,
  input: HiveRecentInput,
): Promise<LearningView[]> {
  const data = validate(hiveRecentInput, input);
  let since: Date;
  try {
    since = parseSince(data.since);
  } catch {
    throw new HiveInputError(
      "Since must be an ISO datetime or a positive duration such as 24h or 7d.",
    );
  }
  const repo = normalizeRepo(data.repo);
  const rows =
    await getSql()`SELECT l.*, m.name AS author_name FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE l.team_id = ${ctx.teamId} AND (${data.kind ?? null}::text IS NULL OR l.kind = ${data.kind ?? null}) AND l.last_pushed_at >= ${since} AND (${repo}::text IS NULL OR l.repo = ${repo}) ORDER BY l.last_pushed_at DESC LIMIT ${data.limit}`;
  await recordEvent({
    name: "recent.performed",
    properties: { resultCount: rows.length, kind: data.kind },
  });
  return rows.map(view);
}

export function recordFeedback(
  ctx: HiveContext,
  input: HiveFeedbackInput,
): Promise<FeedbackResult> {
  return withOperation(ctx, "feedback", () => recordFeedbackAction(ctx, input));
}

async function recordFeedbackAction(
  ctx: HiveContext,
  input: HiveFeedbackInput,
): Promise<FeedbackResult> {
  const data = validate(hiveFeedbackInput, input);
  const result = await analyticsTransaction(() =>
    getSql().begin(async (tx) => {
      await lockLearningWrites(tx, ctx);
      const rows =
        await tx`SELECT id, lifecycle FROM learnings WHERE id = ${data.id} AND team_id = ${ctx.teamId} FOR UPDATE`;
      if (!rows.length) throw new HiveNotFoundError();
      await tx`INSERT INTO feedback (learning_id, member_id, team_id, vote, note) VALUES (${data.id}, ${ctx.memberId}, ${ctx.teamId}, ${data.vote}, ${data.note ?? null}) ON CONFLICT (learning_id, member_id) DO UPDATE SET vote = EXCLUDED.vote, note = EXCLUDED.note, updated_at = now() WHERE feedback.team_id = ${ctx.teamId}`;
      const counts =
        await tx`SELECT count(*) FILTER (WHERE vote = 'up')::int AS up, count(*) FILTER (WHERE vote = 'down')::int AS down, count(*) FILTER (WHERE vote = 'outdated')::int AS outdated FROM feedback WHERE learning_id = ${data.id} AND team_id = ${ctx.teamId}`;
      const votes = {
        up: Number(counts[0].up),
        down: Number(counts[0].down),
        outdated: Number(counts[0].outdated),
      };
      await tx`UPDATE learnings SET up_votes = ${votes.up}, down_votes = ${votes.down}, outdated_votes = ${votes.outdated}, lifecycle = CASE WHEN lifecycle IN ('superseded','retracted') THEN lifecycle WHEN admin_outdated OR ${votes.outdated} > ${votes.up} THEN 'outdated' WHEN ${votes.up} > 0 OR push_count > 1 THEN 'confirmed' ELSE 'fresh' END, updated_at = now() WHERE id = ${data.id} AND team_id = ${ctx.teamId}`;
      const updated =
        await tx`SELECT lifecycle FROM learnings WHERE id = ${data.id} AND team_id = ${ctx.teamId}`;
      if (rows[0].lifecycle !== updated[0].lifecycle)
        await recordMutation({
          name: "learning.lifecycle_changed",
          learningId: data.id,
          reasonCode: "feedback",
          properties: {
            previousState: rows[0].lifecycle,
            state: updated[0].lifecycle,
          },
        });
      return { id: data.id, votes };
    }),
  );
  await recordEvent({
    name: "learning.feedback",
    learningId: data.id,
    properties: { vote: data.vote },
  });
  scheduleKnowledge(ctx);
  return result;
}

export async function getLearning(
  ctx: HiveContext,
  id: string,
): Promise<LearningView | null> {
  const rows =
    await getSql()`SELECT l.*, m.name AS author_name FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE l.id = ${id} AND l.team_id = ${ctx.teamId}`;
  return rows[0] ? view(rows[0]) : null;
}

export async function listMembers(ctx: HiveContext): Promise<MemberView[]> {
  const rows =
    await getSql()`SELECT m.*, count(l.id)::int AS learning_count FROM members m LEFT JOIN learnings l ON l.member_id = m.id AND l.team_id = ${ctx.teamId} WHERE m.team_id = ${ctx.teamId} AND m.removed_at IS NULL GROUP BY m.id ORDER BY m.created_at`;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    joinedAt: row.created_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    learningCount: Number(row.learning_count),
    email: row.email,
    emailVerified: row.email_verified,
    role: row.role,
  }));
}

export async function teamOverview(ctx: HiveContext): Promise<TeamOverview> {
  const sql = getSql();
  const rows =
    await sql`SELECT name, invite_expires_at, (SELECT count(*)::int FROM learnings WHERE team_id = ${ctx.teamId}) AS learning_count, (SELECT count(*)::int FROM members WHERE team_id = ${ctx.teamId} AND removed_at IS NULL) AS member_count FROM teams WHERE id = ${ctx.teamId}`;
  if (!rows[0]) throw new HiveNotFoundError("Team not found.");
  const repos =
    await sql`SELECT DISTINCT repo FROM learnings WHERE team_id = ${ctx.teamId} AND repo IS NOT NULL ORDER BY repo`;
  return {
    teamName: rows[0].name,
    role: (
      await sql`SELECT role FROM members WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} AND removed_at IS NULL`
    )[0].role,
    domains: (
      await sql`SELECT domain FROM team_domains WHERE team_id = ${ctx.teamId} ORDER BY domain`
    ).map((row) => row.domain),
    inviteExpiresAt: rows[0].invite_expires_at.toISOString(),
    learningCount: Number(rows[0].learning_count),
    memberCount: Number(rows[0].member_count),
    repos: repos.map((row) => row.repo),
  };
}

export async function submitEarlyAccess(
  input: EarlyAccessInput,
): Promise<{ id: string }> {
  const data = validate(earlyAccessInput, input);
  return saveEarlyAccess(data);
}
