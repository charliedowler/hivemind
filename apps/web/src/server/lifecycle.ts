import {
  analyticsTransaction,
  recordMutation,
  withActor,
} from "./analytics/events";
import { invalidateKnowledgeSnapshots, scheduleKnowledge } from "./knowledge-tree";
import type postgres from "postgres";
import { deriveCaptureDetails, cleanEvidence, evidenceText } from "./llm/capture";
import { classifyPush, classificationJson, frictionAreaForTopic } from "./classify";
import { queueEvidence } from "./knowledge-tree";
import { newId } from "./db/ids";
import { redactFeedback } from "./feedback";
import {
  learningEditInput,
  hiveCorrectInput,
  type HiveCorrectInput,
  redactSecrets,
  type HiveContext,
  type LearningConflict,
  type LearningVersion,
  type LearningKind,
} from "@hivemind/core";
import type { z } from "zod";
import { captureOwner, lockCapturePolicy, refreshProjectPublications, requireSelectedProject } from "./project-sharing";
import { getSql, hasEmbeddingColumn } from "./db/client";
import { HiveError, HiveInputError, HiveNotFoundError } from "./errors";
import { embedText } from "./llm/embeddings";
import { audienceCellsSql, learningVisibleSql } from "./capture-visibility";

export type LearningTransaction = postgres.TransactionSql;

export async function lockLearningWrites(
  tx: LearningTransaction,
  ctx: HiveContext,
) {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${ctx.teamId}), 7291)`;
  await tx`SELECT set_config('hive.actor', ${ctx.memberId}, true)`;
}

export function verificationHorizon(
  kind: LearningKind,
  area: string | undefined,
  tags: string[],
  explicit?: string,
): Date {
  if (explicit) return new Date(explicit);
  let days = {
    learning: 90,
    insight: 90,
    gotcha: 45,
    friction: 45,
    decision: 180,
    snippet: 30,
    incident: 30,
  }[kind];
  if (area === "environment") days = 14;
  if (
    tags.some((tag) => /^(versions?|dependencies|dependency|urls?)$/.test(tag))
  )
    days = Math.min(days, 30);
  return new Date(Date.now() + days * 86400000);
}

export async function acceptSupersession(
  tx: LearningTransaction,
  ctx: HiveContext,
  edgeId: string,
  reason: string,
) {
  const edges =
    await tx`SELECT * FROM learning_supersessions WHERE id = ${edgeId} AND team_id = ${ctx.teamId} FOR UPDATE`;
  const edge = edges[0];
  if (!edge) throw new HiveNotFoundError("Cell change not found in your hive.");
  const cells =
    await tx`SELECT l.id, l.revision, l.lifecycle, l.owner_member_id FROM learnings l WHERE l.team_id = ${ctx.teamId} AND ${learningVisibleSql(ctx)} AND l.id = ANY(${[edge.older_id, edge.newer_id]}::text[]) ORDER BY l.id FOR UPDATE`;
  const older = cells.find((row) => row.id === edge.older_id),
    newer = cells.find((row) => row.id === edge.newer_id);
  if (!older || !newer) throw new HiveNotFoundError();
  if (older.owner_member_id !== newer.owner_member_id) throw new HiveError("Cells from different owners cannot replace each other.", 403);
  if (edge.status === "accepted") return;
  if (edge.status !== "candidate")
    throw new HiveInputError("Hive has already settled which cell to keep.");
  if (
    older.revision !== edge.older_revision ||
    newer.revision !== edge.newer_revision
  )
    throw new HiveError(
      "A cell has changed since then. Review a new correction.",
      409,
    );
  if (
    !["fresh", "confirmed", "outdated"].includes(older.lifecycle) ||
    !["fresh", "confirmed"].includes(newer.lifecycle)
  )
    throw new HiveError("Replace the current cell in the chain instead.", 409);
  const cycle =
    await tx`WITH RECURSIVE successors(id) AS (SELECT newer_id FROM learning_supersessions WHERE team_id = ${ctx.teamId} AND older_id = ${edge.newer_id} AND status = 'accepted' UNION SELECT s.newer_id FROM learning_supersessions s JOIN successors p ON s.older_id = p.id WHERE s.team_id = ${ctx.teamId} AND s.status = 'accepted') SELECT id FROM successors WHERE id = ${edge.older_id}`;
  if (edge.older_id === edge.newer_id || cycle.length)
    throw new HiveInputError("A replacement cannot create a cycle.");
  await tx`UPDATE learnings SET lifecycle = 'superseded', superseded_by = ${edge.newer_id} WHERE id = ${edge.older_id} AND team_id = ${ctx.teamId}`;
  await tx`UPDATE learning_supersessions SET status = 'accepted', reason = ${reason}, decided_by = ${ctx.memberId}, decided_at = now() WHERE id = ${edgeId} AND team_id = ${ctx.teamId}`;
  await recordMutation({
    name: "learning.superseded",
    key: edgeId,
    learningId: edge.older_id,
    properties: { newerLearningId: edge.newer_id },
  });
  await recordMutation({
    name: "learning.lifecycle_changed",
    key: edgeId,
    learningId: edge.older_id,
    reasonCode: "replacement",
    properties: { previousState: older.lifecycle, state: "superseded" },
  });
}

export async function listConflicts(
  ctx: HiveContext,
  history = false,
): Promise<LearningConflict[]> {
  const rows =
    await getSql()`SELECT s.*, (a.capture_redacted OR b.capture_redacted) AS capture_redacted, a.title AS older_title, a.body AS older_body, a.revision AS current_older_revision, b.title AS newer_title, b.body AS newer_body, b.revision AS current_newer_revision, am.name AS older_author, bm.name AS newer_author, (SELECT count(*)::int FROM learning_conflict_votes v WHERE v.edge_id = s.id AND v.team_id = ${ctx.teamId}) AS votes, EXISTS (SELECT 1 FROM learning_conflict_votes v WHERE v.edge_id = s.id AND v.team_id = ${ctx.teamId} AND v.member_id = ${ctx.memberId}) AS voted, EXISTS (SELECT 1 FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.role = 'admin' AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional) AS can_admin FROM learning_supersessions s JOIN learnings a ON a.id = s.older_id AND a.team_id = s.team_id JOIN learnings b ON b.id = s.newer_id AND b.team_id = s.team_id JOIN members am ON am.id = a.member_id JOIN members bm ON bm.id = b.member_id WHERE s.team_id = ${ctx.teamId} AND ${learningVisibleSql(ctx, "a")} AND ${learningVisibleSql(ctx, "b")} AND (${history} OR s.status = 'candidate') ORDER BY s.created_at DESC LIMIT 100`;
  return rows.map((row) => ({
    id: row.id,
    older: {
      id: row.older_id,
      title: row.older_title,
      body: row.older_body,
      author: row.older_author,
      revision: row.current_older_revision,
    },
    newer: {
      id: row.newer_id,
      title: row.newer_title,
      body: row.newer_body,
      author: row.newer_author,
      revision: row.current_newer_revision,
    },
    relation: row.relation,
    confidence: Number(row.confidence),
    status: row.status,
    reason: row.capture_redacted ? "Hive removed excluded content from a cell." : row.reason,
    votes: Number(row.votes),
    voted: row.voted,
    canAdmin: row.can_admin,
    stale:
      row.status === "candidate" &&
      (row.older_revision !== row.current_older_revision ||
        row.newer_revision !== row.current_newer_revision),
    createdAt: row.created_at.toISOString(),
  }));
}

export function resolveConflict(
  ctx: HiveContext,
  id: string,
  action: "confirm" | "reject",
) {
  return withActor(ctx, () => resolveConflictAction(ctx, id, action));
}
async function resolveConflictAction(
  ctx: HiveContext,
  id: string,
  action: "confirm" | "reject",
) {
  const result = await analyticsTransaction(() =>
    getSql().begin(async (tx) => {
      await lockLearningWrites(tx, ctx);
      const members =
        await tx`SELECT h.role FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional`;
      if (!members.length) throw new HiveNotFoundError("Member not found.");
      const admin = members[0].role === "admin";
      const edges =
        await tx`SELECT s.status FROM learning_supersessions s JOIN learnings a ON a.id = s.older_id AND a.team_id = s.team_id JOIN learnings b ON b.id = s.newer_id AND b.team_id = s.team_id WHERE s.id = ${id} AND s.team_id = ${ctx.teamId} AND ${learningVisibleSql(ctx, "a")} AND ${learningVisibleSql(ctx, "b")} FOR UPDATE OF s, a, b`;
      if (!edges.length)
        throw new HiveNotFoundError("Cell change not found in your hive.");
      if (edges[0].status !== "candidate")
        throw new HiveError("Hive has already settled which cell to keep.", 409);
      if (action === "reject") {
        if (!admin)
          throw new HiveError(
            "A team admin is needed to reject a replacement.",
            403,
          );
        await tx`UPDATE learning_supersessions SET status = 'rejected', reason = 'Admin keeps both cells', decided_by = ${ctx.memberId}, decided_at = now() WHERE id = ${id} AND team_id = ${ctx.teamId}`;
        return { status: "rejected" };
      }
      await tx`INSERT INTO learning_conflict_votes (edge_id, team_id, member_id) VALUES (${id}, ${ctx.teamId}, ${ctx.memberId}) ON CONFLICT DO NOTHING`;
      const votes =
        await tx`SELECT count(*)::int AS count FROM learning_conflict_votes v JOIN members m ON m.id = v.member_id JOIN hive_memberships h ON h.member_id = v.member_id AND h.team_id = v.team_id WHERE v.edge_id = ${id} AND v.team_id = ${ctx.teamId} AND m.disabled_at IS NULL AND h.removed_at IS NULL`;
      if (admin || votes[0].count >= 2) {
        await acceptSupersession(
          tx,
          ctx,
          id,
          admin
            ? "Admin confirms replacement"
            : "Two members confirm replacement",
        );
        return { status: "accepted" };
      }
      return { status: "candidate" };
    }),
  );
  scheduleKnowledge(ctx);
  return result;
}

export async function learningVersions(
  ctx: HiveContext,
  id: string,
): Promise<LearningVersion[]> {
  const visible = (await getSql()`SELECT l.* FROM ${audienceCellsSql(ctx)} l WHERE l.id = ${id}`)[0];
  if (!visible) throw new HiveNotFoundError();
  if (visible.is_share) {
    const published = (await getSql()`SELECT s.public_content, s.revision, s.updated_at, m.name AS author FROM learning_shares s JOIN members m ON m.id = (s.public_content->>'member_id') WHERE s.learning_id = ${id} AND s.team_id = ${visible.team_id} AND s.withdrawn_at IS NULL`)[0];
    if (!published) throw new HiveNotFoundError();
    const {embedding, search, ...content} = published.public_content;
    return [{revision: Number(published.revision), author: String(published.author), createdAt: published.updated_at.toISOString(), content, diff: {}}];
  }
  ctx = {...ctx, teamId: String(visible.team_id)};
  const rows =
    await getSql()`SELECT v.*, m.name AS author FROM learning_versions v JOIN learnings l ON l.id = v.learning_id AND l.team_id = v.team_id JOIN members m ON m.id = v.member_id WHERE v.learning_id = ${id} AND v.team_id = ${ctx.teamId} AND ${learningVisibleSql(ctx)} AND (l.member_id = ${ctx.memberId} OR (coalesce((v.content->>'capture_flagged')::boolean, false) = false AND coalesce((v.diff->'capture_flagged'->>'before')::boolean, false) = false)) ORDER BY v.revision DESC LIMIT 100`;
  if (!rows.length) throw new HiveNotFoundError();
  const targets = [...new Set(rows.flatMap((row) => [
    row.content?.superseded_by,
    row.diff?.superseded_by?.before,
    row.diff?.superseded_by?.after,
  ]).filter((target): target is string => typeof target === "string"))];
  const visibleTargets = new Set(targets.length
    ? (await getSql()`SELECT l.id FROM learnings l WHERE l.team_id = ${ctx.teamId} AND l.id = ANY(${targets}::text[]) AND ${learningVisibleSql(ctx)}`).map((row) => String(row.id))
    : []);
  const visibleTarget = (target: unknown) =>
    typeof target === "string" && !visibleTargets.has(target) ? null : target;
  return rows.map((row) => ({
    revision: row.revision,
    author: row.author,
    createdAt: row.created_at.toISOString(),
    content: {
      ...row.content,
      ...(Object.hasOwn(row.content, "superseded_by")
        ? { superseded_by: visibleTarget(row.content.superseded_by) }
        : {}),
    },
    diff: {
      ...row.diff,
      ...(row.diff.superseded_by
        ? { superseded_by: {
            before: visibleTarget(row.diff.superseded_by.before),
            after: visibleTarget(row.diff.superseded_by.after),
          } }
        : {}),
    },
  }));
}

export function editLearning(
  ctx: HiveContext,
  id: string,
  input: z.infer<typeof learningEditInput>,
) {
  return withActor(ctx, () => editLearningAction(ctx, id, input));
}
async function editLearningAction(
  ctx: HiveContext,
  id: string,
  input: z.infer<typeof learningEditInput>,
) {
  const data = learningEditInput.parse(input);
  const ownership = await captureOwner(ctx);
  const originals = await getSql()`SELECT owner_member_id, team_id FROM learnings WHERE id = ${id}`;
  if (originals[0]?.owner_member_id === ownership.ownerId && originals[0]?.team_id === ownership.personal.teamId) ctx = ownership.personal;
  const candidates =
    await getSql()`SELECT l.*, EXISTS (SELECT 1 FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.role = 'admin' AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional) AS admin FROM learnings l WHERE l.id = ${id} AND l.team_id = ${ctx.teamId} AND ${learningVisibleSql(ctx)}`;
  const candidate = candidates[0];
  if (!candidate) throw new HiveNotFoundError();
  if (candidate.member_id !== ctx.memberId && candidate.owner_member_id !== ownership.ownerId && !candidate.admin)
    throw new HiveError("Only the author or a team admin can edit this cell.", 403);
  if (candidate.revision !== data.revision)
    throw new HiveError("This cell changed. Reload it before editing.", 409);
  if (candidate.lifecycle === "superseded")
    throw new HiveError("Edit the current cell in the chain instead.", 409);
  const contentChange = Boolean(data.title || data.body || data.observation || data.evidence);
  const selection = candidate.team_id === ownership.personal.teamId && contentChange ? await requireSelectedProject(ctx, {repo: candidate.repo}) : null;
  const retractOnly = data.lifecycle === "retracted" && !contentChange;
  const { enforceCaptureRules } = await import("./capture-rules");
  const capture = retractOnly ? {title: candidate.title, body: candidate.body, action: "allow", redacted: false, flagged: candidate.capture_flagged, categories: candidate.capture_categories, matches: []} : await enforceCaptureRules(ctx, {
    title: data.title ?? candidate.title,
    body: data.observation ?? data.body ?? candidate.body,
    remote: candidate.capture_context?.remote,
    cwd: candidate.capture_context?.cwd,
    home: candidate.capture_context?.home,
    sessionType: candidate.capture_context?.sessionType,
    repo: candidate.repo ?? undefined,
    paths: candidate.paths,
    agent: candidate.capture_context?.agent ?? candidate.source,
    categories: data.title || data.body || data.observation ? undefined : candidate.capture_categories,
  }, undefined, [
    evidenceText(data.evidence),
    ...(candidate.tags ?? []),
    ...(candidate.paths ?? []),
    candidate.repo ?? "",
    candidate.workaround ?? "",
    candidate.session_ref ?? "",
    ...Object.values(candidate.capture_context ?? {}).filter((value): value is string => typeof value === "string"),
  ]);
  if (capture.action === "drop" && (data.lifecycle !== "retracted" || data.observation || data.body || data.title))
    throw new HiveError("Hive excluded this edit based on what you or your team chose to keep.", 422);
  const evidence = capture.redacted || capture.action === "drop" ? undefined : cleanEvidence(data.evidence);
  let correctedTitle = redactSecrets(capture.title).text;
  let correctedMetadata: {kind: LearningKind; tags: string[]; area: string | null; blocked: boolean | null; cost: number | null; workaround: string | null; classification: ReturnType<typeof classificationJson> | null} | undefined;
  if (data.observation) {
    const classification = await classifyPush({title: "", body: redactSecrets(capture.body).text, repo: capture.redacted ? null : candidate.repo, evidence: evidenceText(evidence), workaround: "", blocked: null});
    if (classification.decision.action === "refuse") throw new HiveInputError("Remove identifying details before sharing this correction.");
    const details = await deriveCaptureDetails(redactSecrets(capture.body).text, evidenceText(evidence));
    correctedTitle = details.title;
    const kind = classification.decision.kind;
    correctedMetadata = {kind, tags: classification.decision.tags, area: kind === "friction" ? frictionAreaForTopic(classification.decision.tags[0]) ?? null : null, blocked: kind === "friction" ? details.blocked : null, cost: kind === "friction" ? details.cost : null, workaround: kind === "friction" ? details.workaround : null, classification: classification.classification ? classificationJson(classification.classification) : null};
  }
  const result = await analyticsTransaction(() =>
    getSql().begin(async (tx) => {
      await lockCapturePolicy(tx, ownership.ownerId);
      if (selection) {
        const live = await requireSelectedProject(ctx, {repo: candidate.repo}, tx);
        if (live.policy.revision !== selection.policy.revision) throw new HiveError("The project selection changed while Hive checked this edit.", 409);
      }
      await lockLearningWrites(tx, ctx);
      const rows =
        await tx`SELECT l.*, EXISTS (SELECT 1 FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.role = 'admin' AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional) AS admin FROM learnings l WHERE l.id = ${id} AND l.team_id = ${ctx.teamId} AND ${learningVisibleSql(ctx)} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new HiveNotFoundError();
      if (row.member_id !== ctx.memberId && row.owner_member_id !== ownership.ownerId && !row.admin)
        throw new HiveError(
          "Only the author or a team admin can edit this cell.",
          403,
        );
      if (row.revision !== data.revision)
        throw new HiveError(
          "This cell changed. Reload it before editing.",
          409,
        );
      if (row.lifecycle === "superseded")
        throw new HiveError("Edit the current cell in the chain instead.", 409);
      const title = redactSecrets(correctedTitle).text,
        body = redactSecrets(capture.body).text;
      if (
        row.admin_outdated &&
        data.lifecycle &&
        ["fresh", "confirmed"].includes(data.lifecycle) &&
        !row.admin
      )
        throw new HiveError("A team admin must clear the outdated mark.", 403);
      await tx`UPDATE learnings SET kind = ${correctedMetadata?.kind ?? row.kind}, area = ${correctedMetadata ? correctedMetadata.area : row.area}, blocked = ${correctedMetadata ? correctedMetadata.blocked : row.blocked}, cost = ${correctedMetadata ? correctedMetadata.cost : row.cost}, title = ${title}, body = ${body}, verify_after = ${data.verify_after ? new Date(data.verify_after) : correctedMetadata ? verificationHorizon(correctedMetadata.kind, correctedMetadata.area ?? undefined, correctedMetadata.tags) : row.verify_after}, lifecycle = ${data.lifecycle ?? row.lifecycle}, admin_outdated = ${data.lifecycle && ["fresh", "confirmed"].includes(data.lifecycle) ? false : row.admin_outdated}, capture_flagged = capture_flagged OR ${capture.flagged}, capture_redacted = capture_redacted OR ${capture.redacted}, capture_rule_ids = ARRAY(SELECT DISTINCT unnest(capture_rule_ids || ${capture.matches.map(match => match.ruleId)}::text[])), capture_categories = ${tx.json(capture.categories)}, repo = ${capture.redacted ? null : row.repo}, tags = ${capture.redacted ? [] : correctedMetadata?.tags ?? row.tags}, paths = ${capture.redacted ? [] : row.paths}, workaround = ${capture.redacted ? null : correctedMetadata ? correctedMetadata.workaround : row.workaround}, session_ref = ${capture.redacted ? null : row.session_ref}, capture_context = ${tx.json(capture.redacted ? {} : row.capture_context ?? {})}, classification = ${capture.redacted ? null : correctedMetadata ? correctedMetadata.classification ? tx.json(correctedMetadata.classification) : null : row.classification ? tx.json(row.classification) : null} WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      if ((data.title || data.body || data.observation || capture.redacted) && (await hasEmbeddingColumn())) {
        const embedding = await embedText(`${title}\n\n${body}`);
        await tx`UPDATE learnings SET embedding = ${embedding ? JSON.stringify(embedding) : null}::vector WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      }
      await refreshProjectPublications(tx, ctx, id);
      const updated =
        await tx`SELECT revision FROM learnings WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      if (capture.redacted) {
        await redactFeedback(tx, ctx, id);
        await tx`DELETE FROM learning_versions WHERE learning_id = ${id} AND team_id = ${ctx.teamId} AND revision <> ${updated[0].revision}`;
        await tx`UPDATE learning_versions SET diff = '{}'::jsonb WHERE learning_id = ${id} AND team_id = ${ctx.teamId} AND revision = ${updated[0].revision}`;
        await tx`DELETE FROM learning_evidence WHERE learning_id = ${id} AND team_id = ${ctx.teamId}`;
        await tx`UPDATE learning_pushes SET session_ref = NULL, classification = NULL WHERE learning_id = ${id} AND team_id = ${ctx.teamId}`;
      }
      if (evidence || data.observation) {
        const pushId = newId("psh");
        await tx`INSERT INTO learning_pushes (id, learning_id, team_id, member_id, source, session_ref, merged, blocked, is_correction) VALUES (${pushId}, ${id}, ${ctx.teamId}, ${ctx.memberId}, ${row.source}, ${capture.redacted ? null : row.session_ref}, true, NULL, true)`;
        await queueEvidence(tx, ctx, id, pushId, {observation: body, evidence, revision: data.revision, retract: data.lifecycle === "retracted"});
      }
      if (capture.redacted || (capture.flagged && !row.capture_flagged))
        await invalidateKnowledgeSnapshots(tx, ctx);
      if (data.lifecycle && data.lifecycle !== row.lifecycle)
        await recordMutation({
          name: "learning.lifecycle_changed",
          learningId: id,
          reasonCode: "manual",
          properties: { previousState: row.lifecycle, state: data.lifecycle },
        });
      return { revision: updated[0].revision };
    }),
  );
  scheduleKnowledge(ctx);
  return result;
}

export function correctLearning(ctx: HiveContext, input: HiveCorrectInput) {
  const data = hiveCorrectInput.parse(input);
  return editLearning(ctx, data.id, {
    revision: data.revision,
    observation: data.observation,
    evidence: data.evidence,
    ...(data.retract ? {lifecycle: "retracted" as const} : {}),
  });
}

export async function answerLifecycleContext(
  ctx: HiveContext,
  hits: import("@hivemind/core").LearningView[],
) {
  hits = hits.filter((hit) => !hit.captureFlagged);
  const ids = hits.map((hit) => hit.id);
  const rows = ids.length
    ? await getSql()`WITH RECURSIVE visible_edges AS (SELECT s.* FROM learning_supersessions s JOIN learnings a ON a.id = s.older_id AND a.team_id = s.team_id JOIN learnings b ON b.id = s.newer_id AND b.team_id = s.team_id WHERE s.team_id = ${ctx.teamId} AND s.status = 'accepted' AND a.capture_flagged = false AND b.capture_flagged = false), history AS (SELECT s.older_id, s.newer_id, s.decided_at, 1 AS depth FROM visible_edges s WHERE s.team_id = ${ctx.teamId} AND s.newer_id = ANY(${ids}::text[]) AND s.status = 'accepted' UNION ALL SELECT s.older_id, s.newer_id, s.decided_at, h.depth + 1 FROM visible_edges s JOIN history h ON s.newer_id = h.older_id WHERE s.team_id = ${ctx.teamId} AND s.status = 'accepted' AND h.depth < 16) SELECT DISTINCT h.*, l.title, n.title AS newer_title, l.last_pushed_at AS older_date, n.last_pushed_at AS newer_date FROM history h JOIN learnings l ON l.id = h.older_id AND l.team_id = ${ctx.teamId} JOIN learnings n ON n.id = h.newer_id AND n.team_id = ${ctx.teamId} ORDER BY h.depth, h.older_id`
    : [];
  const asOf = new Date().toISOString();
  const lines = [`As of ${asOf.slice(0, 10)}.`];
  const citations: import("@hivemind/core").AskCitation[] = rows.flatMap(
    (row) => [
      {
        id: String(row.older_id),
        title: String(row.title),
        why: "Historical cell replaced by a newer learning.",
        date: new Date(row.older_date).toISOString().slice(0, 10),
      },
      {
        id: String(row.newer_id),
        title: String(row.newer_title),
        why: "Replacement in this learning's history.",
        date: new Date(row.newer_date).toISOString().slice(0, 10),
      },
    ],
  );
  for (const row of rows)
    lines.push(
      `Replaced [${row.older_id}] with [${row.newer_id}] on ${new Date(row.decided_at).toISOString().slice(0, 10)}.`,
    );
  for (const hit of hits.filter((hit) => hit.verifyBeforeUse))
    lines.push(
      `Verify before use: [${hit.id}] passed its verification date ${hit.verifyAfter?.slice(0, 10)}.`,
    );
  if (rows.some((row) => row.depth === 16))
    lines.push(
      "Earlier history is truncated after 16 links. Read the oldest cited cell for more context.",
    );
  return {
    prompt: JSON.stringify({
      asOf,
      history: rows.map((row) => ({
        older: row.older_id,
        title: row.title,
        newer: row.newer_id,
        date: row.decided_at,
      })),
      verifyBeforeUse: hits
        .filter((hit) => hit.verifyBeforeUse)
        .map((hit) => hit.id),
    }),
    text: lines.join("\n\n"),
    citations,
  };
}

export function appendLifecycleContext(
  result: import("@hivemind/core").AskResult,
  context: Awaited<ReturnType<typeof answerLifecycleContext>>,
) {
  const primaryIds = new Set(result.citations.map((citation) => citation.id));
  const titles = new Map(
    context.citations.map((citation) => [
      citation.id,
      citation.title.trim().toLowerCase(),
    ]),
  );
  const paragraphs = context.text.split("\n\n").filter((paragraph) => {
    const replacement =
      /^Replaced \[(lrn_[a-z0-9]+)\] with \[(lrn_[a-z0-9]+)\]/.exec(paragraph);
    if (replacement)
      return (
        (primaryIds.has(replacement[1]) || primaryIds.has(replacement[2])) &&
        titles.get(replacement[1]) !== titles.get(replacement[2])
      );
    const ids = [...paragraph.matchAll(/\[(lrn_[a-z0-9]+)\]/g)].map(
      (match) => match[1],
    );
    return !ids.length || ids.some((id) => primaryIds.has(id));
  });
  const hasReplacement = paragraphs.some((paragraph) =>
    paragraph.startsWith("Replaced "),
  );
  const relevantParagraphs = paragraphs.filter(
    (paragraph) =>
      !paragraph.startsWith("Earlier history is truncated") || hasReplacement,
  );
  const historyIds = new Set(
    relevantParagraphs.flatMap((paragraph) =>
      [...paragraph.matchAll(/\[(lrn_[a-z0-9]+)\]/g)].map((match) => match[1]),
    ),
  );
  return {
    ...result,
    answer: `${result.answer}\n\n${relevantParagraphs.join("\n\n")}`,
    citations: [
      ...new Map(
        [
          ...result.citations,
          ...context.citations.filter((citation) =>
            historyIds.has(citation.id),
          ),
        ].map((citation) => [citation.id, citation]),
      ).values(),
    ],
  };
}
