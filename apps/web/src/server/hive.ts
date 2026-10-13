import {
  earlyAccessInput,
  hivePushInput,
  hiveSearchInput,
  hiveAskInput,
  hiveRecentInput,
  normalizeRepo,
  canonicalProject,
  projectFromContext,
  normalizeTags,
  parseSince,
  rankCandidates,
  type RankCandidate,
  redactSecrets,
  type AskResult,
  type EarlyAccessInput,
  type HiveAskInput,
  type HiveContext,
  type HivePushInput,
  type HiveRecentInput,
  type HiveSearchInput,
  type LearningView,
  type LearningStanding,
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
  currentOrigin,
} from "./analytics/events";
import { createHash } from "node:crypto";
import {
  deriveCaptureDetails,
  evidenceText,
  cleanEvidence,
} from "./llm/capture";
import { frictionSummary, frictionAnswer, isFrictionAsk } from "./friction";
import {
  classifyPush,
  classifyAsk,
  classificationJson,
  frictionAreaForTopic,
} from "./classify";
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
import { feedbackStandingSql, retrievalEligibleSql } from "./feedback";
import { judgeMemory, rerankMemory } from "./memory-judgments";
import {
  queueEvidence,
  scheduleKnowledge,
  ensureKnowledge,
} from "./knowledge-tree";
import { enforceCaptureRules } from "./capture-rules";
import {
  audienceCellsSql,
  learningVisibleSql,
  visibleSupersededBySql,
} from "./capture-visibility";
import {
  requireSelectedProject,
  lockCapturePolicy,
  refreshProjectPublications,
} from "./project-sharing";
import { after } from "next/server";
import { z } from "zod";
import { getSql, hasEmbeddingColumn } from "./db/client";
import { newId } from "./db/ids";
import { saveEarlyAccess } from "./early-access";
import { HiveError, HiveInputError, HiveNotFoundError } from "./errors";
import {
  embedText,
  synthesizeAnswer,
  extractiveAnswer,
  suggestTags,
} from "@/server/llm";

import { searchSlack, getSlackMessage } from "./slack/search";

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

export async function pushLearning(
  ctx: HiveContext,
  input: HivePushInput,
): Promise<PushResult> {
  if (!["slack", "scheduled"].includes(currentOrigin()?.entrypoint ?? "")) {
    const data = validate(hivePushInput, input);
    const project = {
      ...data.context,
      ...Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      ),
    };
    if (
      data.context &&
      (data.context.repo != null || data.context.remote != null)
    ) {
      const nested = projectFromContext({
        ...data.context,
        remote: data.context.remote ?? project.remote,
      });
      if (!nested || nested !== projectFromContext(project))
        throw new HiveError(
          "Supply one consistent repository context before capture.",
          403,
        );
    }
    ctx = (await requireSelectedProject(ctx, project)).personal;
  }
  return withOperation(ctx, "push", () => pushLearningAction(ctx, input));
}

async function pushLearningAction(
  ctx: HiveContext,
  input: HivePushInput,
): Promise<PushResult> {
  const supplied = validate(hivePushInput, input);
  const envelope: HivePushInput = {
    ...supplied.context,
    ...Object.fromEntries(
      Object.entries(supplied).filter(([, value]) => value !== undefined),
    ),
  };
  const source =
    supplied.source ??
    (envelope.agent === "codex"
      ? "codex"
      : envelope.agent === "claude-code"
        ? "claude-code"
        : "manual");
  let data: HivePushInput & {
    source: LearningView["source"];
    tags: string[];
    paths: string[];
    confidence: number;
  } = {
    ...envelope,
    source,
    tags: supplied.tags ?? [],
    paths: envelope.paths ?? [],
    confidence: supplied.confidence ?? 0.7,
  };
  const organisationCapture = ["slack", "scheduled"].includes(
    currentOrigin()?.entrypoint ?? "",
  );
  if (
    organisationCapture &&
    !(
      await getSql()`SELECT id FROM teams WHERE id = ${ctx.teamId} AND personal_owner_member_id IS NULL`
    ).length
  )
    throw new HiveError("Slack capture requires an organisation hive.", 403);
  const selection = organisationCapture
    ? null
    : await requireSelectedProject(ctx, data);
  if (selection) {
    ctx = selection.personal;
    data = { ...data, repo: selection.project, remote: undefined };
  }
  const rawBody = data.body ?? data.observation!;
  const sidecar = [
    data.observation,
    data.workaround,
    ...data.tags,
    ...data.paths,
    data.repo,
    data.remote,
    data.cwd,
    data.home,
    data.branch,
    data.agent,
    data.sessionType,
    data.sessionRef,
    evidenceText(data.evidence),
  ].filter((value): value is string => Boolean(value));
  const capture = await enforceCaptureRules(
    ctx,
    {
      title: data.title ?? "",
      body: rawBody,
      repo: data.repo,
      remote: data.remote,
      cwd: data.cwd,
      paths: data.paths,
      home: data.home,
      agent: data.agent ?? data.source,
      sessionType: data.sessionType,
    },
    undefined,
    sidecar,
  );
  if (capture.action === "drop") {
    const matched = capture.matches.find((match) => match.action === "drop");
    if (!matched)
      throw new HiveError("Hive could not check what to keep. Try again.", 503);
    return { dropped: true, rule: matched.kind };
  }
  const captureRedacted = capture.redacted;
  const captureFlagged = capture.flagged;
  const captureRuleIds = capture.matches.map((match) => match.ruleId);
  const captureContext = captureRedacted
    ? {}
    : Object.fromEntries(
        Object.entries({
          remote: data.remote,
          cwd: data.cwd,
          home: data.home,
          agent: data.agent ?? data.source,
          sessionType: data.sessionType,
          branch: data.branch,
        })
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, redactSecrets(value!).text]),
      );
  data = {
    ...data,
    title: capture.title || undefined,
    body: capture.body,
    observation: data.observation ? capture.body : undefined,
    context: undefined,
    evidence: cleanEvidence(data.evidence),
  };
  if (captureRedacted)
    data = {
      ...data,
      repo: undefined,
      remote: undefined,
      cwd: undefined,
      home: undefined,
      branch: undefined,
      agent: undefined,
      sessionType: undefined,
      paths: [],
      tags: [],
      evidence: undefined,
      sessionRef: undefined,
      workaround: undefined,
    };
  const repo =
    selection && !captureRedacted
      ? selection.project
      : normalizeRepo(
          data.repo
            ? redactSecrets(data.repo).text
            : data.remote
              ? redactSecrets(data.remote).text.replace(
                  /^git@[^:]+:|^ssh:\/\/git@[^/]+\//,
                  "",
                )
              : undefined,
        );
  const tags = normalizeTags(data.tags.map((tag) => redactSecrets(tag).text));
  const paths = [
    ...new Set(
      data.paths.map((path) => redactSecrets(path.trim()).text).filter(Boolean),
    ),
  ];
  const body = redactSecrets(data.body!.trim());
  let title = redactSecrets(data.title?.trim() ?? "");
  let workaround = redactSecrets(data.workaround ?? "");
  if (!body.text) throw new HiveInputError("Share one observation.");
  const evidence = evidenceText(data.evidence);
  const { classification, decision } = await classifyPush({
    title: title.text,
    body: body.text,
    evidence,
    repo,
    workaround: workaround.text,
    blocked: data.blocked ?? null,
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
  const details =
    !title.text || kind === "friction"
      ? await deriveCaptureDetails(body.text, evidence)
      : { title: title.text, cost: null, blocked: null, workaround: null };
  if (!title.text) title = redactSecrets(details.title);
  const inferredArea =
    kind === "friction" ? frictionAreaForTopic(decision.tags[0]) : undefined;
  data = {
    ...data,
    title: title.text,
    body: body.text,
    area: data.area ?? inferredArea,
    blocked:
      data.blocked !== undefined
        ? data.blocked
        : kind === "friction"
          ? details.blocked
          : null,
    cost:
      data.cost !== undefined
        ? data.cost
        : kind === "friction"
          ? details.cost
          : null,
    workaround:
      data.workaround !== undefined
        ? data.workaround
        : kind === "friction"
          ? details.workaround
          : null,
  };
  workaround = redactSecrets(data.workaround ?? "");
  if (supplied.tags === undefined)
    tags.push(...decision.tags.filter((tag) => !tags.includes(tag)));
  const captureKey =
    supplied.observation && !data.supersedes
      ? createHash("sha256")
          .update(
            JSON.stringify({
              body: body.text.trim().toLowerCase().replace(/\s+/g, " "),
              repo,
              session: data.sessionRef
                ? redactSecrets(data.sessionRef).text
                : null,
            }),
          )
          .digest("hex")
      : null;
  const sql = getSql();
  const supportsVector = await hasEmbeddingColumn();
  const embedding = supportsVector
    ? await embedText(`${title.text}\n\n${body.text}`)
    : null;
  const vector = embedding ? JSON.stringify(embedding) : null;
  const normalizedTitle = title.text.toLowerCase().replace(/\s+/g, " ");
  const candidateRows = vector
    ? await sql`SELECT id, title, body, revision FROM learnings WHERE team_id = ${ctx.teamId} AND owner_member_id = ${selection?.ownerId ?? ctx.memberId} AND capture_redacted = ${captureRedacted} AND capture_flagged = ${captureFlagged} AND (NOT capture_flagged OR member_id = ${ctx.memberId}) AND kind = ${kind} AND repo IS NOT DISTINCT FROM ${repo} AND lifecycle IN ('fresh','confirmed') AND (lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = ${normalizedTitle} OR lower(regexp_replace(trim(body), '\\s+', ' ', 'g')) = ${body.text.toLowerCase().replace(/\s+/g, " ")} OR (embedding IS NOT NULL AND 1 - (embedding <=> ${vector}::vector) >= 0.8)) ORDER BY (lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = ${normalizedTitle}) DESC, embedding <=> ${vector}::vector LIMIT 4`
    : await sql`SELECT id, title, body, revision FROM learnings WHERE team_id = ${ctx.teamId} AND owner_member_id = ${selection?.ownerId ?? ctx.memberId} AND capture_redacted = ${captureRedacted} AND capture_flagged = ${captureFlagged} AND (NOT capture_flagged OR member_id = ${ctx.memberId}) AND kind = ${kind} AND repo IS NOT DISTINCT FROM ${repo} AND lifecycle IN ('fresh','confirmed') AND (lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = ${normalizedTitle} OR lower(regexp_replace(trim(body), '\\s+', ' ', 'g')) = ${body.text.toLowerCase().replace(/\s+/g, " ")}) ORDER BY created_at DESC LIMIT 4`;
  const judgment = await judgeMemory(
    { title: title.text, body: body.text, repo },
    candidateRows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      revision: row.revision,
    })),
  );
  if (supplied.tags === undefined)
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
      if (selection) {
        await lockCapturePolicy(tx, selection.ownerId);
        const live = await requireSelectedProject(ctx, data, tx);
        if (live.policy.revision !== selection.policy.revision)
          throw new HiveError(
            "The project selection changed while Hive checked this capture. Retry it.",
            409,
          );
      }
      await lockLearningWrites(tx, ctx);
      if (captureKey) {
        const replay =
          await tx`SELECT l.*, m.name AS author_name, m.actor_type AS author_actor_type, (SELECT owner.name FROM members owner WHERE owner.id = l.owner_member_id AND owner.actor_type = 'human') AS owner_name, p.id AS push_id FROM learning_pushes p JOIN learnings l ON l.id = p.learning_id AND l.team_id = p.team_id JOIN members m ON m.id = l.member_id WHERE p.team_id = ${ctx.teamId} AND p.member_id = ${ctx.memberId} AND p.capture_key = ${captureKey} AND ${learningVisibleSql(ctx)}`;
        if (replay[0]) {
          const learning = view(replay[0], ctx);
          return {
            id: learning.id,
            pushId: replay[0].push_id as string,
            merged: true,
            replayed: true,
            pushCount: learning.pushCount,
            redactions: 0,
            learning,
          };
        }
      }
      const current =
        await tx`SELECT * FROM learnings WHERE team_id = ${ctx.teamId} AND owner_member_id = ${selection?.ownerId ?? ctx.memberId} AND capture_redacted = ${captureRedacted} AND capture_flagged = ${captureFlagged} AND (NOT capture_flagged OR member_id = ${ctx.memberId}) AND kind = ${kind} AND repo IS NOT DISTINCT FROM ${repo} AND lifecycle IN ('fresh','confirmed') AND (id = ANY(${candidateRows.map((row) => row.id)}::text[]) OR lower(regexp_replace(trim(title), '\\s+', ' ', 'g')) = ${normalizedTitle} OR lower(regexp_replace(trim(body), '\\s+', ' ', 'g')) = ${body.text.toLowerCase().replace(/\s+/g, " ")}) ORDER BY created_at DESC FOR UPDATE`;
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
              ((supplied.observation ||
                normalize(row.title) === normalizedTitle) &&
                normalize(row.body) === normalize(body.text)) ||
              (kind === "friction" &&
                normalize(row.title) === normalizedTitle) ||
              (relation?.relation === "same" && relation.confidence >= 0.9)
            );
          });
      let merged = Boolean(duplicate);
      let id: string = duplicate?.id ?? newId("lrn");
      if (merged) {
        await tx`UPDATE learnings SET push_count = push_count + 1, last_pushed_at = now(), updated_at = now(), tags = ARRAY(SELECT DISTINCT unnest(tags || ${tags}::text[])), paths = ARRAY(SELECT DISTINCT unnest(paths || ${paths}::text[])), confidence = greatest(confidence, ${data.confidence}), lifecycle = 'confirmed', classification = ${classification ? tx.json(classificationJson(classification)) : null}, area = coalesce(area, ${data.area ?? null}), cost = CASE WHEN cost IS NULL AND ${data.cost ?? null}::integer IS NULL THEN NULL ELSE coalesce(cost, 0) + coalesce(${data.cost ?? null}::integer, 0) END, blocked = blocked OR ${data.blocked ?? null}::boolean, workaround = coalesce(nullif(${workaround.text}, ''), workaround), capture_redacted = capture_redacted OR ${captureRedacted}, capture_rule_ids = ARRAY(SELECT DISTINCT unnest(capture_rule_ids || ${captureRuleIds}::text[])), capture_categories = capture_categories || ${tx.json(capture.categories)}::jsonb, capture_context = CASE WHEN ${captureRedacted} THEN '{}'::jsonb ELSE capture_context END WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      } else {
        await tx`INSERT INTO learnings (id, team_id, member_id, title, body, kind, tags, repo, paths, confidence, source, session_ref, area, cost, blocked, workaround, classification, verify_after, capture_flagged, capture_redacted, capture_rule_ids, capture_categories, capture_context) VALUES (${id}, ${ctx.teamId}, ${ctx.memberId}, ${title.text}, ${body.text}, ${kind}, ${tags}, ${repo}, ${paths}, ${data.confidence}, ${data.source}, ${data.sessionRef ? redactSecrets(data.sessionRef).text : null}, ${data.area ?? null}, ${data.cost ?? null}, ${data.blocked ?? null}, ${workaround.text || null}, ${classification ? tx.json(classificationJson(classification)) : null}, ${verificationHorizon(kind, data.area, tags, data.verify_after)}, ${captureFlagged}, ${captureRedacted}, ${captureRuleIds}, ${tx.json(capture.categories)}, ${tx.json(captureContext)})`;
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
      await tx`INSERT INTO learning_pushes (id, learning_id, team_id, member_id, source, session_ref, merged, area, cost, blocked, classification, capture_key) VALUES (${pushId}, ${id}, ${ctx.teamId}, ${ctx.memberId}, ${data.source}, ${data.sessionRef ? redactSecrets(data.sessionRef).text : null}, ${merged}, ${data.area ?? null}, ${data.cost ?? null}, ${data.blocked ?? null}, ${classification ? tx.json(classificationJson(classification)) : null}, ${captureKey})`;
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
            await tx`SELECT * FROM learnings WHERE id = ${proposal.id} AND team_id = ${ctx.teamId} AND owner_member_id = ${selection?.ownerId ?? ctx.memberId} AND capture_redacted = ${captureRedacted} AND capture_flagged = ${captureFlagged} AND (NOT capture_flagged OR member_id = ${ctx.memberId}) FOR UPDATE`;
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
      await refreshProjectPublications(tx, ctx, id);
      const rows =
        await tx`SELECT l.*, ${visibleSupersededBySql(ctx)} AS superseded_by, m.name AS author_name, m.actor_type AS author_actor_type, (SELECT owner.name FROM members owner WHERE owner.id = l.owner_member_id AND owner.actor_type = 'human') AS owner_name FROM learnings l JOIN members m ON m.id = l.member_id WHERE l.id = ${id} AND l.team_id = ${ctx.teamId} AND (NOT l.capture_flagged OR l.member_id = ${ctx.memberId})`;
      const stored = view(rows[0], ctx);
      const learning =
        organisationCapture && stored.captureFlagged
          ? { ...stored, title: "Kept private", body: "" }
          : stored;
      return {
        id,
        pushId,
        merged,
        pushCount: learning.pushCount,
        redactions:
          title.count + body.count + workaround.count + Number(captureRedacted),
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
  const retried = captureFlagged
    ? []
    : await retryRelatedConflicts(
        ctx,
        result.id,
        applied.map((record) => record.edgeId),
      );
  if (retried.length) {
    result.learning = (await getLearning(ctx, result.id)) ?? result.learning;
    result.pushCount = result.learning.pushCount;
  }
  if (!classification && supplied.tags === undefined)
    scheduleTags(ctx, result.learning);
  scheduleKnowledge(ctx);
  const replacements =
    await sql`SELECT s.older_id FROM learning_supersessions s JOIN learnings l ON l.id = s.older_id AND l.team_id = s.team_id WHERE s.team_id = ${ctx.teamId} AND s.newer_id = ${result.id} AND s.status = 'accepted' AND ${learningVisibleSql(ctx)}`;
  return {
    ...result,
    correction: {
      tool: "hive_correct",
      id: result.id,
      revision: result.learning.revision!,
    },
    inferred: {
      title: result.learning.title,
      kind: result.learning.kind,
      tags: result.learning.tags,
      area: result.learning.area,
      blocked: result.learning.blocked,
      workaround: result.learning.workaround,
      cost: result.learning.cost,
      confidence: result.learning.confidence,
      repo: result.learning.repo,
      source: result.learning.source,
      sessionRef: result.learning.sessionRef,
      paths: result.learning.paths,
      verifyAfter: result.learning.verifyAfter,
      supersededBy: result.learning.supersededBy,
      context: captureContext,
      relations: judgment.relations,
      supersedes: replacements.map((row) => String(row.older_id)),
      overrides: Object.keys(supplied).filter(
        (key) => !["observation", "evidence", "context"].includes(key),
      ),
    },
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
  options: {
    publicOnly?: boolean;
    cellsOnly?: boolean;
    excludeFlagged?: boolean;
  } = {},
): Promise<(SearchHit & LearningStanding)[]> {
  return withOperation(ctx, "search", () =>
    searchLearningsAction(ctx, input, options),
  );
}

async function searchLearningsAction(
  ctx: HiveContext,
  input: HiveSearchInput,
  options: {
    publicOnly?: boolean;
    cellsOnly?: boolean;
    excludeFlagged?: boolean;
  } = {},
): Promise<(SearchHit & LearningStanding)[]> {
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
  const excludeFlagged =
    options.excludeFlagged ??
    ["slack", "scheduled"].includes(currentOrigin()?.entrypoint ?? "");
  const filter = sql`${learningVisibleSql(ctx)} AND (NOT ${excludeFlagged} OR NOT l.capture_flagged) AND ${retrievalEligibleSql(data.include_history)} AND (${tags.length === 0} OR l.tags && ${tags}::text[]) AND (${data.kind ?? null}::text IS NULL OR l.kind = ${data.kind ?? null}) AND (${!options.publicOnly} OR l.source <> 'slack' OR EXISTS(SELECT 1 FROM slack_channels sc WHERE sc.team_id=l.team_id AND sc.private=false AND sc.bot_member=true AND l.session_ref LIKE '%' || '/archives/' || sc.channel_id || '/%'))`;
  const ftsRows =
    await sql`SELECT l.*, fs.*, ${visibleSupersededBySql(ctx)} AS superseded_by, m.name AS author_name, m.actor_type AS author_actor_type, (SELECT owner.name FROM members owner WHERE owner.id = l.owner_member_id AND owner.actor_type = 'human') AS owner_name, ts_rank_cd(l.search, ${tsquery}) AS fts FROM ${audienceCellsSql(ctx)} l CROSS JOIN LATERAL ${feedbackStandingSql()} fs JOIN members m ON m.id = l.member_id WHERE ${filter} AND l.search @@ ${tsquery} AND ${coverage} >= ${minimumLexemeCoverage} ORDER BY fts DESC LIMIT 40`;
  const vectorRows = embedding
    ? await sql`SELECT l.*, fs.*, ${visibleSupersededBySql(ctx)} AS superseded_by, m.name AS author_name, m.actor_type AS author_actor_type, (SELECT owner.name FROM members owner WHERE owner.id = l.owner_member_id AND owner.actor_type = 'human') AS owner_name, 1 - (l.embedding <=> ${JSON.stringify(embedding)}::vector) AS vector, ts_rank_cd(l.search, ${tsquery}) AS fts FROM ${audienceCellsSql(ctx)} l CROSS JOIN LATERAL ${feedbackStandingSql()} fs JOIN members m ON m.id = l.member_id WHERE ${filter} AND l.embedding IS NOT NULL ORDER BY l.embedding <=> ${JSON.stringify(embedding)}::vector LIMIT 40`
    : [];
  const candidates = new Map<string, RankCandidate>();
  for (const row of ftsRows)
    candidates.set(row.id, {
      ...view(row, ctx),
      vector: null,
      fts: Number(row.fts),
    });
  for (const row of vectorRows) {
    const vector = Number(row.vector);
    if (vector >= minimumVectorSimilarity || candidates.has(row.id))
      candidates.set(row.id, {
        ...view(row, ctx),
        vector,
        fts: Number(row.fts),
      });
  }
  let prefixUsed = false;
  if (!candidates.size) {
    const words = data.query.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length) {
      prefixUsed = true;
      const prefix = words.map((word) => `${word}:*`).join(" & ");
      const rows =
        await sql`SELECT l.*, fs.*, ${visibleSupersededBySql(ctx)} AS superseded_by, m.name AS author_name, m.actor_type AS author_actor_type, (SELECT owner.name FROM members owner WHERE owner.id = l.owner_member_id AND owner.actor_type = 'human') AS owner_name, ts_rank_cd(l.search, to_tsquery('english', ${prefix})) AS fts FROM ${audienceCellsSql(ctx)} l CROSS JOIN LATERAL ${feedbackStandingSql()} fs JOIN members m ON m.id = l.member_id WHERE ${filter} AND l.search @@ to_tsquery('english', ${prefix}) ORDER BY fts DESC LIMIT 40`;
      for (const row of rows)
        candidates.set(row.id, {
          ...view(row, ctx),
          vector: null,
          fts: Number(row.fts),
        });
    }
  }
  const cells = rankCandidates(
    [...candidates.values()],
    data.repo,
    new Date(),
    { includeHistory: data.include_history },
  );
  const slack =
    options.cellsOnly ||
    (data.kind && data.kind !== "learning") ||
    tags.some((tag) => tag !== "slack")
      ? []
      : await searchSlack(
          ctx,
          { query: data.query, limit: data.limit },
          options.publicOnly,
        );
  const hits = [...cells, ...slack]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, data.limit);
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

async function retrievalLifecycleContext(
  ctx: HiveContext,
  hits: LearningView[],
  includeHistory = false,
) {
  const context = await answerLifecycleContext(ctx, hits);
  if (includeHistory) return context;
  const prompt = JSON.parse(context.prompt);
  return {
    ...context,
    prompt: JSON.stringify({ ...prompt, history: [] }),
    text: context.text
      .split("\n\n")
      .filter(
        (line) =>
          !line.startsWith("Replaced ") &&
          !line.startsWith("Earlier history is truncated"),
      )
      .join("\n\n"),
    citations: [],
  };
}

export function askHive(
  ctx: HiveContext,
  input: HiveAskInput,
  options: { publicOnly?: boolean } = {},
): Promise<AskResult> {
  return withOperation(ctx, "ask", () => askHiveAction(ctx, input, options));
}

async function askHiveAction(
  ctx: HiveContext,
  input: HiveAskInput,
  options: { publicOnly?: boolean } = {},
): Promise<AskResult> {
  const started = performance.now();
  const data = validate(hiveAskInput, input);
  const friction =
    !data.include_history && !options.publicOnly && isFrictionAsk(data.question)
      ? await frictionSummary(ctx, data.repo)
      : null;
  const frictionEligible = friction?.count
    ? await getSql()`SELECT l.id FROM ${audienceCellsSql(ctx)} l CROSS JOIN LATERAL ${feedbackStandingSql()} fs WHERE l.id = ANY(${friction.cells.map((cell) => cell.id)}::text[]) AND ${retrievalEligibleSql()}`
    : [];
  if (
    friction &&
    friction.count &&
    frictionEligible.length === friction.cells.length
  ) {
    const cells =
      await getSql()`SELECT l.*, fs.*, ${visibleSupersededBySql(ctx)} AS superseded_by, m.name AS author_name, m.actor_type AS author_actor_type, (SELECT owner.name FROM members owner WHERE owner.id = l.owner_member_id AND owner.actor_type = 'human') AS owner_name FROM ${audienceCellsSql(ctx)} l CROSS JOIN LATERAL ${feedbackStandingSql()} fs JOIN members m ON m.id = l.member_id WHERE ${learningVisibleSql(ctx)} AND l.id = ANY(${friction.cells.map((cell) => cell.id)}::text[])`;
    const result = appendLifecycleContext(
      frictionAnswer(friction),
      await retrievalLifecycleContext(
        ctx,
        cells.map((row) => view(row, ctx)),
        data.include_history,
      ),
    );
    const dates = new Map(
      cells.map((cell) => [
        String(cell.id),
        new Date(cell.last_pushed_at).toISOString().slice(0, 10),
      ]),
    );
    result.citations = result.citations.map((citation) => ({
      ...citation,
      date: dates.get(citation.id) ?? citation.date,
    }));
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
    await searchLearnings(
      ctx,
      {
        query: data.question.slice(0, 500),
        repo: data.repo,
        limit: 8,
        include_history: data.include_history,
      },
      { ...options, excludeFlagged: true },
    ),
    { includeHistory: data.include_history },
  );
  const [context, relevance] = await Promise.all([
    retrievalLifecycleContext(ctx, hits, data.include_history),
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
  const slackHits = hits.filter((h) => h.id.startsWith("slk_"));
  const permitted = await Promise.all(
    slackHits.map((h) => getSlackMessage(ctx, h.id)),
  );
  if (permitted.some((h) => !h))
    result = {
      answer:
        "Slack source permissions changed while the hive was answering. Ask again with the current sources.",
      citations: [],
      confidence: "low",
      gaps: "Some retrieved Slack evidence is no longer available.",
      synthesized: false,
    };
  const visibleIds = new Set(
    (
      await getSql()`SELECT l.id FROM ${audienceCellsSql(ctx)} l CROSS JOIN LATERAL ${feedbackStandingSql()} fs WHERE ${retrievalEligibleSql(data.include_history)} AND l.id = ANY(${hits.filter((h) => !h.id.startsWith("slk_")).map((h) => h.id)}::text[])`
    ).map((row) => String(row.id)),
  );
  if (hits.some((hit) => !hit.id.startsWith("slk_") && !visibleIds.has(hit.id)))
    return {
      answer: "Cell permissions changed while Hive answered. Ask again.",
      citations: [],
      confidence: "low",
      gaps: "A publication was withdrawn.",
      synthesized: false,
    };
  const sources = new Map(
    hits
      .filter((h) => h.source === "slack" && h.permalink)
      .map((h) => [h.id, h.permalink!]),
  );
  result = {
    ...result,
    citations: result.citations.map((c) => ({
      ...c,
      date:
        hits.find((hit) => hit.id === c.id)?.lastPushedAt.slice(0, 10) ??
        c.date,
      ...(sources.has(c.id)
        ? { source: "slack" as const, permalink: sources.get(c.id) }
        : {}),
    })),
  };
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
): Promise<LearningStanding[]> {
  return withOperation(ctx, "recent", () => recentLearningsAction(ctx, input));
}

async function recentLearningsAction(
  ctx: HiveContext,
  input: HiveRecentInput,
): Promise<LearningStanding[]> {
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
  const canonicalRepo = data.repo ? canonicalProject(data.repo) : null;
  const excludeFlagged = ["slack", "scheduled"].includes(
    currentOrigin()?.entrypoint ?? "",
  );
  const rows =
    await getSql()`SELECT l.*, fs.*, ${visibleSupersededBySql(ctx)} AS superseded_by, m.name AS author_name, m.actor_type AS author_actor_type, (SELECT owner.name FROM members owner WHERE owner.id = l.owner_member_id AND owner.actor_type = 'human') AS owner_name FROM ${audienceCellsSql(ctx)} l CROSS JOIN LATERAL ${feedbackStandingSql()} fs JOIN members m ON m.id = l.member_id WHERE ${learningVisibleSql(ctx)} AND (NOT ${excludeFlagged} OR NOT l.capture_flagged) AND ${retrievalEligibleSql(data.include_history)} AND (${data.kind ?? null}::text IS NULL OR l.kind = ${data.kind ?? null}) AND l.last_pushed_at >= ${since} AND (${repo}::text IS NULL OR l.repo = ${repo} OR l.repo = ${canonicalRepo}) ORDER BY l.last_pushed_at DESC LIMIT ${data.limit}`;
  await recordEvent({
    name: "recent.performed",
    properties: { resultCount: rows.length, kind: data.kind },
  });
  return rows.map((row) => view(row, ctx));
}

export { recordFeedback } from "./feedback";

export async function getLearning(
  ctx: HiveContext,
  id: string,
): Promise<LearningStanding | null> {
  if (id.startsWith("slk_")) return getSlackMessage(ctx, id);
  const rows =
    await getSql()`SELECT l.*, fs.*, ${visibleSupersededBySql(ctx)} AS superseded_by, m.name AS author_name, m.actor_type AS author_actor_type, (SELECT owner.name FROM members owner WHERE owner.id = l.owner_member_id AND owner.actor_type = 'human') AS owner_name FROM ${audienceCellsSql(ctx)} l CROSS JOIN LATERAL ${feedbackStandingSql()} fs JOIN members m ON m.id = l.member_id WHERE l.id = ${id} AND ${learningVisibleSql(ctx)}`;
  return rows[0] ? view(rows[0], ctx) : null;
}

export async function listMembers(ctx: HiveContext): Promise<MemberView[]> {
  const rows =
    await getSql()`SELECT m.*, h.role AS membership_role, h.joined_at, count(l.id)::int AS learning_count FROM members m JOIN hive_memberships h ON h.member_id = m.id LEFT JOIN ${audienceCellsSql(ctx)} l ON l.member_id = m.id AND l.team_id = ${ctx.teamId} AND ${learningVisibleSql(ctx)} WHERE h.team_id = ${ctx.teamId} AND h.removed_at IS NULL AND m.disabled_at IS NULL GROUP BY m.id, h.role, h.joined_at ORDER BY h.joined_at`;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    joinedAt: row.joined_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    learningCount: Number(row.learning_count),
    email: row.email,
    emailVerified: row.email_verified,
    role: row.membership_role,
  }));
}

export async function teamOverview(ctx: HiveContext): Promise<TeamOverview> {
  const sql = getSql();
  const rows =
    await sql`SELECT name, invite_expires_at, (SELECT count(*)::int FROM ${audienceCellsSql(ctx)} l) AS learning_count, (SELECT count(*)::int FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.team_id = ${ctx.teamId} AND h.removed_at IS NULL AND m.disabled_at IS NULL) AS member_count FROM teams WHERE id = ${ctx.teamId}`;
  if (!rows[0]) throw new HiveNotFoundError("Team not found.");
  const repos =
    await sql`SELECT DISTINCT repo FROM ${audienceCellsSql(ctx)} l WHERE repo IS NOT NULL ORDER BY repo`;
  return {
    teamName: rows[0].name,
    role: (
      await sql`SELECT role FROM hive_memberships WHERE member_id = ${ctx.memberId} AND team_id = ${ctx.teamId} AND removed_at IS NULL`
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
