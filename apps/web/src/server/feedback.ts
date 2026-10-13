import type postgres from "postgres";
import {
  hiveFeedbackInput,
  hiveOutcomeInput,
  redactSecrets,
  type CaptureEvidence,
  type FeedbackHistoryEntry,
  type FeedbackResult,
  type FeedbackVote,
  type HiveContext,
  type HiveFeedbackInput,
  type HiveOutcomeInput,
  type OutcomeKind,
} from "@hivemind/core";
import { getSql } from "./db/client";
import { newId } from "./db/ids";
import { lockLearningWrites, type LearningTransaction } from "./lifecycle";
import { HiveError, HiveNotFoundError } from "./errors";
import {
  analyticsTransaction,
  recordEvent,
  recordMutation,
  withOperation,
} from "./analytics/events";
import { audienceCellsSql, learningVisibleSql } from "./capture-visibility";
import { enforceCaptureRules } from "./capture-rules";
import { cleanEvidence, evidenceText } from "./llm/capture";
import { classifyOutcome } from "./outcome-judgments";
import { scheduleKnowledge } from "./knowledge-tree";

export function feedbackStandingSql(alias = "l") {
  const q = getSql();
  return q`(SELECT
    coalesce(sum((CASE f.vote WHEN 'up' THEN 1 WHEN 'down' THEN -1 ELSE 0 END) * power(0.5, greatest(0, extract(epoch FROM (now() - coalesce(r.created_at, f.updated_at))) / 86400) / 90)), 0)::float AS weighted_net_votes,
    count(*) FILTER (WHERE r.classification = 'useful')::int AS useful_outcomes,
    count(*) FILTER (WHERE r.classification = 'contradicted')::int AS contradicted_outcomes,
    count(*) FILTER (WHERE r.classification = 'stale')::int AS stale_outcomes,
    (array_agg(r.classification ORDER BY r.created_at DESC, r.id DESC) FILTER (WHERE r.classification IS NOT NULL))[1] AS last_outcome,
    max(r.created_at) FILTER (WHERE r.classification IS NOT NULL) AS last_outcome_at,
    max(r.created_at) FILTER (WHERE r.classification = 'useful') AS last_confirmed_at,
    max(r.created_at) FILTER (WHERE r.classification = 'contradicted' AND btrim(CASE WHEN jsonb_typeof(r.evidence) = 'string' THEN r.evidence #>> '{}' ELSE concat_ws('', r.evidence->>'session_excerpt', r.evidence->>'diff', r.evidence->>'command_output') END) <> '') AS last_contradicted_at
    FROM feedback f LEFT JOIN feedback_receipts r ON r.id = f.receipt_id AND r.learning_id = f.learning_id AND r.team_id = f.team_id AND r.member_id = f.member_id
    WHERE f.learning_id = ${q(`${alias}.id`)} AND f.team_id = ${q(`${alias}.team_id`)})`;
}

export function retrievalEligibleSql(includeHistory = false, alias = "l", standingAlias = "fs") {
  const q = getSql();
  return q`(${includeHistory} OR (
    ${q(`${alias}.lifecycle`)} IN ('fresh','confirmed')
    AND NOT (${q(`${alias}.down_votes`)} >= 2 AND ${q(`${alias}.down_votes`)} > ${q(`${alias}.up_votes`)})
    AND (${q(`${standingAlias}.last_contradicted_at`)} IS NULL OR ${q(`${standingAlias}.last_confirmed_at`)} >= ${q(`${standingAlias}.last_contradicted_at`)})))`;
}

async function scopedCell(ctx: HiveContext, id: string) {
  const rows =
    await getSql()`SELECT l.* FROM ${audienceCellsSql(ctx)} l WHERE l.id = ${id} AND ${learningVisibleSql(ctx)}`;
  if (!rows[0]) throw new HiveNotFoundError();
  return rows[0];
}

async function filterReport(
  ctx: HiveContext,
  id: string,
  text: string,
  evidence?: CaptureEvidence,
) {
  const cell = await scopedCell(ctx, id);
  const capture = await enforceCaptureRules(
    ctx,
    {
      title: cell.title,
      body: cell.body,
      repo: cell.repo,
      paths: cell.paths,
      ...cell.capture_context,
      agent: cell.capture_context?.agent ?? cell.source,
    },
    undefined,
    [text, evidenceText(evidence)],
  );
  if (capture.action === "drop")
    throw new HiveError("Hive excluded this result based on what you or your team chose to keep.", 422);
  return {
    cell,
    flagged: capture.flagged,
    text: capture.redacted
      ? "Hive removed excluded content from this result."
      : redactSecrets(text).text,
    evidence: capture.redacted ? undefined : cleanEvidence(evidence),
    redacted: capture.redacted,
  };
}

export function reportOutcome(
  ctx: HiveContext,
  input: HiveOutcomeInput,
): Promise<FeedbackResult> {
  return withOperation(ctx, "feedback", async () => {
    const data = hiveOutcomeInput.parse(input);
    const filtered = await filterReport(
      ctx,
      data.id,
      data.outcome,
      data.evidence,
    );
    const classified =
      filtered.redacted || filtered.flagged
        ? {
            classification: "inconclusive" as const,
            judgment: { model: "capture_rule" },
          }
        : await classifyOutcome(
            { title: filtered.cell.title, body: filtered.cell.body },
            filtered.text,
            evidenceText(filtered.evidence),
          );
    const vote = (
      {
        useful: "up",
        contradicted: "down",
        stale: "outdated",
        inconclusive: null,
      } as const
    )[classified.classification];
    return writeFeedback(ctx, data.id, {
      vote,
      outcome: filtered.text,
      evidence: filtered.evidence,
      classification: classified.classification,
      judgment: classified.judgment,
      flagged: filtered.flagged,
      revision: filtered.cell.revision,
    });
  });
}

export function recordFeedback(
  ctx: HiveContext,
  input: HiveFeedbackInput,
): Promise<FeedbackResult> {
  return withOperation(ctx, "feedback", async () => {
    const data = hiveFeedbackInput.parse(input);
    if (data.withdraw)
      return writeFeedback(ctx, data.id, {
        withdraw: true,
        receipt: data.receipt,
      });
    const filtered = await filterReport(
      ctx,
      data.id,
      data.note ?? "",
      undefined,
    );
    return writeFeedback(ctx, data.id, {
      vote: filtered.flagged || filtered.redacted ? null : data.vote!,
      outcome: filtered.text || undefined,
      flagged: filtered.flagged,
      revision: filtered.cell.revision,
    });
  });
}

type FeedbackChange = {
  vote?: FeedbackVote | null;
  outcome?: string;
  evidence?: CaptureEvidence;
  classification?: OutcomeKind;
  judgment?: postgres.JSONValue;
  flagged?: boolean;
  revision?: number;
  withdraw?: boolean;
  receipt?: string;
};

async function writeFeedback(
  ctx: HiveContext,
  id: string,
  change: FeedbackChange,
): Promise<FeedbackResult> {
  const audience = await scopedCell(ctx, id);
  ctx = {...ctx, teamId: String(audience.team_id)};
  const result = await analyticsTransaction(() =>
    getSql().begin(async (tx) => {
      await lockLearningWrites(tx, ctx);
      await tx`SELECT id FROM learnings WHERE id = ${id} FOR UPDATE`;
      await tx`SELECT learning_id FROM learning_shares WHERE learning_id = ${id} AND team_id = ${ctx.teamId} FOR UPDATE`;
      const [members, rows] = await Promise.all([
        tx`SELECT h.member_id FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = ${ctx.teamId} AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional FOR SHARE`,
        tx`SELECT l.* FROM ${audienceCellsSql(ctx)} l WHERE l.id = ${id} AND ${learningVisibleSql(ctx)}`,
      ]);
      const cell = rows[0];
      if (!cell || !members.length) throw new HiveNotFoundError();
      if (change.revision !== undefined && cell.revision !== change.revision)
        throw new HiveError(
          "This cell changed while Hive checked the result. Report against its current revision.",
          409,
        );
      const previous = (
        await tx`SELECT vote, receipt_id, updated_at FROM feedback WHERE learning_id = ${id} AND team_id = ${ctx.teamId} AND member_id = ${ctx.memberId} FOR UPDATE`
      )[0];
      const receipt = newId("fbr");
      let target: string | null = previous?.receipt_id ?? null;
      const before = {
        lifecycle: cell.lifecycle,
        votes: {
          up: cell.up_votes,
          down: cell.down_votes,
          outdated: cell.outdated_votes,
        },
        previousVote: previous?.vote ?? null,
        previousReceipt: target,
        previousUpdatedAt: previous?.updated_at?.toISOString() ?? null,
      };
      let affectsLifecycle = Boolean(change.vote);
      let restoredVote: FeedbackVote | null = null;
      if (change.withdraw) {
        target = change.receipt ?? target;
        const submitted = target
          ? (
              await tx`SELECT r.* FROM feedback_receipts r WHERE r.id = ${target} AND r.learning_id = ${id} AND r.team_id = ${ctx.teamId} AND r.member_id = ${ctx.memberId} AND r.action = 'report'`
            )[0]
          : null;
        if (target && !submitted)
          throw new HiveNotFoundError(
            "Feedback receipt not found for your account.",
          );
        if (
          submitted &&
          (
            await tx`SELECT id FROM feedback_receipts WHERE target_receipt_id = ${target} AND team_id = ${ctx.teamId} AND member_id = ${ctx.memberId} AND action = 'withdraw'`
          ).length
        )
          throw new HiveError(
            "This feedback receipt was already withdrawn.",
            409,
          );
        if (submitted?.vote && previous?.receipt_id !== target)
          throw new HiveError(
            "This receipt was replaced. Withdraw your current feedback instead.",
            409,
          );
        if ((!submitted && previous) || submitted?.vote) {
          affectsLifecycle = true;
          restoredVote = submitted?.before_state?.previousVote ?? null;
          const restoredReceipt =
            submitted?.before_state?.previousReceipt ?? null;
          if (restoredVote)
            await tx`UPDATE feedback SET vote = ${restoredVote}, note = NULL, receipt_id = ${restoredReceipt}, updated_at = ${submitted?.before_state?.previousUpdatedAt ?? new Date()} WHERE learning_id = ${id} AND team_id = ${ctx.teamId} AND member_id = ${ctx.memberId}`;
          else
            await tx`DELETE FROM feedback WHERE learning_id = ${id} AND team_id = ${ctx.teamId} AND member_id = ${ctx.memberId}`;
        }
      } else if (change.vote) {
        await tx`INSERT INTO feedback (learning_id, member_id, team_id, vote, note, receipt_id) VALUES (${id}, ${ctx.memberId}, ${ctx.teamId}, ${change.vote}, ${change.outcome ?? null}, ${receipt}) ON CONFLICT (learning_id, team_id, member_id) DO UPDATE SET vote = EXCLUDED.vote, note = EXCLUDED.note, receipt_id = EXCLUDED.receipt_id, updated_at = now() WHERE feedback.team_id = ${ctx.teamId}`;
      }
      const counts = (
        await tx`SELECT count(*) FILTER (WHERE vote = 'up')::int AS up, count(*) FILTER (WHERE vote = 'down')::int AS down, count(*) FILTER (WHERE vote = 'outdated')::int AS outdated FROM feedback WHERE learning_id = ${id} AND team_id = ${ctx.teamId}`
      )[0];
      const votes = {
        up: Number(counts.up),
        down: Number(counts.down),
        outdated: Number(counts.outdated),
      };
      if (affectsLifecycle) {
        await tx`UPDATE learnings SET up_votes = ${votes.up}, down_votes = ${votes.down}, outdated_votes = ${votes.outdated}, lifecycle = CASE WHEN lifecycle IN ('superseded','retracted') THEN lifecycle WHEN admin_outdated OR ${votes.outdated} > ${votes.up} THEN 'outdated' WHEN ${votes.up} > 0 OR push_count > 1 THEN 'confirmed' ELSE 'fresh' END, updated_at = now() WHERE id = ${id} AND team_id = ${ctx.teamId}`;
      }
      const updated = (
        await tx`SELECT lifecycle FROM ${audienceCellsSql(ctx)} l WHERE id = ${id}`
      )[0];
      await tx`INSERT INTO feedback_receipts (id, team_id, learning_id, member_id, action, outcome, evidence, classification, judgment, vote, target_receipt_id, before_state, after_state, capture_flagged) VALUES (${receipt}, ${ctx.teamId}, ${id}, ${ctx.memberId}, ${change.withdraw ? "withdraw" : "report"}, ${change.outcome ?? null}, ${change.evidence ? tx.json(change.evidence) : null}, ${change.classification ?? null}, ${change.judgment ? tx.json(change.judgment) : null}, ${change.withdraw ? restoredVote : (change.vote ?? null)}, ${target}, ${tx.json(before)}, ${tx.json({ lifecycle: updated.lifecycle, votes })}, ${change.flagged ?? false})`;
      if (cell.lifecycle !== updated.lifecycle)
        await recordMutation({
          name: "learning.lifecycle_changed",
          learningId: id,
          reasonCode: "feedback",
          properties: {
            previousState: cell.lifecycle,
            state: updated.lifecycle,
          },
        });
      return {
        id,
        votes,
        receipt,
        withdrawn: Boolean(change.withdraw),
        classification: change.classification,
        vote: change.vote ?? null,
      };
    }),
  );
  await recordEvent({
    name: "learning.feedback",
    learningId: id,
    properties: { vote: change.vote ?? null },
  });
  scheduleKnowledge(ctx);
  return result;
}

export async function feedbackHistory(
  ctx: HiveContext,
  id: string,
): Promise<FeedbackHistoryEntry[]> {
  const cell = await scopedCell(ctx, id);
  ctx = {...ctx, teamId: String(cell.team_id)};
  const rows =
    await getSql()`SELECT r.*, m.name AS actor, EXISTS (SELECT 1 FROM feedback f WHERE f.receipt_id = r.id AND f.team_id = r.team_id AND f.member_id = r.member_id AND f.learning_id = r.learning_id) AS current FROM feedback_receipts r JOIN ${audienceCellsSql(ctx)} l ON l.id = r.learning_id AND l.team_id = r.team_id JOIN members m ON m.id = r.member_id WHERE r.learning_id = ${id} AND r.team_id = ${ctx.teamId} AND ${learningVisibleSql(ctx)} AND (NOT r.capture_flagged OR r.member_id = ${ctx.memberId}) ORDER BY r.created_at DESC, r.id DESC LIMIT 100`;
  return rows.map((row) => ({
    receipt: row.id,
    actor: row.actor,
    action: row.action,
    outcome: row.outcome,
    classification: row.classification,
    vote: row.vote,
    evidence: row.evidence,
    createdAt: row.created_at.toISOString(),
    current: row.current,
  }));
}

export async function redactFeedback(
  tx: LearningTransaction,
  ctx: HiveContext,
  id: string,
) {
  await tx`UPDATE feedback SET note = NULL WHERE learning_id = ${id} AND team_id = ${ctx.teamId}`;
  await tx`UPDATE feedback_receipts SET outcome = CASE WHEN outcome IS NULL THEN NULL ELSE 'Hive removed excluded content from this result.' END, evidence = NULL, judgment = NULL WHERE learning_id = ${id} AND team_id = ${ctx.teamId}`;
}
