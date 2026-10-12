import type { HiveContext } from "@hivemind/core";
import {
  recordEvent,
  currentOrigin,
  originFor,
  analyticsTransaction,
  recordMutation,
  reportedModel,
} from "./analytics/events";
import { getSql } from "./db/client";
import { readPrivateObject } from "./blob-store";
import { createHash } from "node:crypto";
import { newId } from "./db/ids";
import { HiveError, HiveNotFoundError } from "./errors";
import {
  acceptSupersession,
  lockLearningWrites,
  type LearningTransaction,
} from "./lifecycle";
import { scheduleKnowledge } from "./knowledge-tree";
import {
  judgeConflict,
  type ConflictCell,
  type ConflictJudgment,
} from "./conflict-judgments";

export async function conflictCell(
  ctx: HiveContext,
  id: string,
): Promise<ConflictCell | null> {
  const rows =
    await getSql()`SELECT l.*, m.name AS author FROM learnings l JOIN members m ON m.id = l.member_id AND m.team_id = l.team_id WHERE l.id = ${id} AND l.team_id = ${ctx.teamId}`;
  if (!rows.length) return null;
  const row = rows[0];
  const evidence =
    await getSql()`SELECT e.payload, e.object_key, e.digest, e.created_at, v.content FROM learning_evidence e JOIN learning_pushes p ON p.id = e.push_id AND p.team_id = e.team_id LEFT JOIN learning_versions v ON v.learning_id = e.learning_id AND v.team_id = e.team_id AND v.revision = 1 WHERE e.learning_id = ${id} AND e.team_id = ${ctx.teamId} ORDER BY e.created_at DESC LIMIT 3`;
  const supplied = await Promise.all(
    evidence.map(async (e) => {
      let payload = e.payload;
      if (!payload && process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          const content = await readPrivateObject(e.object_key);
          if (createHash("sha256").update(content).digest("hex") === e.digest)
            payload = JSON.parse(content.toString("utf8"));
        } catch {}
      }
      return {
        payload: payload ?? {
          availability: "Evidence excerpt is unavailable.",
          digest: e.digest,
        },
        digest: e.digest,
        createdAt: e.created_at.toISOString(),
      };
    }),
  );
  return {
    id: row.id,
    revision: row.revision,
    title: row.title,
    body: row.body,
    author: row.author,
    createdAt: row.created_at.toISOString(),
    lastPushedAt: row.last_pushed_at.toISOString(),
    votes: {
      up: row.up_votes,
      down: row.down_votes,
      outdated: row.outdated_votes,
    },
    evidence: supplied,
  };
}
export async function prepareConflicts(
  ctx: HiveContext,
  candidates: { id: string; revision: number }[],
  newer: ConflictCell,
) {
  return Promise.all(
    candidates.map(async (candidate) => {
      const older = await conflictCell(ctx, candidate.id);
      return {
        ...candidate,
        judgment: older ? await judgeConflict(older, newer) : null,
      };
    }),
  );
}
function snapshot(row: Record<string, unknown>) {
  return {
    id: row.id,
    revision: row.revision,
    lifecycle: row.lifecycle,
    supersededBy: row.superseded_by,
    verifyAfter:
      row.verify_after instanceof Date
        ? row.verify_after.toISOString()
        : row.verify_after,
    pushCount: row.push_count,
    lastPushedAt:
      row.last_pushed_at instanceof Date
        ? row.last_pushed_at.toISOString()
        : row.last_pushed_at,
    up: row.up_votes,
    down: row.down_votes,
    outdated: row.outdated_votes,
  };
}
export async function applyConflictDecision(
  tx: LearningTransaction,
  ctx: HiveContext,
  edgeId: string,
  judgment: ConflictJudgment,
) {
  const edges =
    await tx`SELECT * FROM learning_supersessions WHERE id = ${edgeId} AND team_id = ${ctx.teamId} FOR UPDATE`;
  const edge = edges[0];
  if (!edge) throw new HiveNotFoundError();
  if (edge.status !== "candidate") return null;
  const rows =
    await tx`SELECT * FROM learnings WHERE team_id = ${ctx.teamId} AND id = ANY(${[edge.older_id, edge.newer_id]}::text[]) ORDER BY id FOR UPDATE`;
  const older = rows.find((row) => row.id === edge.older_id),
    newer = rows.find((row) => row.id === edge.newer_id);
  if (!older || !newer) throw new HiveNotFoundError();
  if (
    older.revision !== edge.older_revision ||
    newer.revision !== edge.newer_revision ||
    !["fresh", "confirmed", "outdated"].includes(older.lifecycle) ||
    !["fresh", "confirmed"].includes(newer.lifecycle)
  ) {
    judgment = {
      ...judgment,
      decision: "undecided",
      reason:
        "A cell changes before Hive applies the decision. Hive retries with current evidence on a related push.",
    };
  }
  const before = rows.map(snapshot);
  const movedPushes =
    judgment.decision === "keep_old"
      ? await tx`SELECT id FROM learning_pushes WHERE learning_id = ${newer.id} AND team_id = ${ctx.teamId}`
      : [];
  if (judgment.decision === "supersede")
    await acceptSupersession(tx, ctx, edgeId, judgment.reason);
  else if (judgment.decision !== "undecided") {
    if (judgment.decision === "keep_old") {
      await tx`UPDATE learnings SET push_count = push_count + ${newer.push_count}, last_pushed_at = greatest(last_pushed_at, ${newer.last_pushed_at}), lifecycle = CASE WHEN lifecycle = 'fresh' THEN 'confirmed' ELSE lifecycle END WHERE id = ${older.id} AND team_id = ${ctx.teamId}`;
      await tx`UPDATE learning_pushes SET learning_id = ${older.id}, merged = true WHERE learning_id = ${newer.id} AND team_id = ${ctx.teamId}`;
      await tx`UPDATE learning_evidence SET learning_id = ${older.id} WHERE learning_id = ${newer.id} AND team_id = ${ctx.teamId}`;
      await tx`UPDATE learnings SET lifecycle = 'retracted' WHERE id = ${newer.id} AND team_id = ${ctx.teamId}`;
    } else if (judgment.decision === "mark_outdated") {
      await tx`UPDATE learnings SET lifecycle = 'outdated', verify_after = now() WHERE id = ANY(${[older.id, newer.id]}::text[]) AND team_id = ${ctx.teamId}`;
    } else if (judgment.decision === "retract_new") {
      await tx`UPDATE learnings SET lifecycle = 'retracted' WHERE id = ${newer.id} AND team_id = ${ctx.teamId}`;
    }
    await tx`UPDATE learning_supersessions SET status = 'rejected', reason = ${judgment.reason}, confidence = ${judgment.confidence}, decided_by = ${ctx.memberId}, decided_at = now() WHERE id = ${edgeId} AND team_id = ${ctx.teamId}`;
  }
  const after =
    await tx`SELECT * FROM learnings WHERE team_id = ${ctx.teamId} AND id = ANY(${[older.id, newer.id]}::text[]) ORDER BY id`;
  const previousById = new Map(rows.map((row) => [row.id, row.lifecycle]));
  await Promise.all(
    after
      .filter(
        (row) =>
          judgment.decision !== "supersede" &&
          row.lifecycle !== previousById.get(row.id),
      )
      .map((row) =>
        recordMutation({
          name: "learning.lifecycle_changed",
          learningId: row.id,
          reasonCode: "replacement",
          properties: {
            previousState: previousById.get(row.id),
            state: row.lifecycle,
          },
        }),
      ),
  );
  const id = newId("dec");
  await tx`INSERT INTO conflict_decisions (id, team_id, edge_id, decision, reason, confidence, model, jev, latency_ms, pushed_by, before_state, after_state, moved_push_ids) VALUES (${id}, ${ctx.teamId}, ${edgeId}, ${judgment.decision}, ${judgment.reason}, ${judgment.confidence}, ${judgment.model}, ${judgment.jev ? tx.json(judgment.jev as never) : null}, ${judgment.latencyMs}, ${newer.member_id}, ${tx.json(before as never)}, ${tx.json(after.map(snapshot) as never)}, ${movedPushes.map((row) => String(row.id))})`;
  return {
    id,
    ...judgment,
    edgeId,
    mergedInto: judgment.decision === "keep_old" ? String(older.id) : null,
  };
}
export async function recordConflictEvent(
  ctx: HiveContext,
  result: NonNullable<Awaited<ReturnType<typeof applyConflictDecision>>>,
) {
  await recordEvent({
    name: "conflict.decided",
    key: result.id,
    origin: currentOrigin() ?? originFor(ctx, "unknown"),
    outcome: result.decision === "undecided" ? "fallback" : "completed",
    latencyMs: result.latencyMs,
    properties: {
      decision: result.decision,
      decisionConfidence: result.confidence,
      model: reportedModel(result.model),
      jevProbabilities: result.jev
        ? (Object.fromEntries(
            Object.entries(result.jev).map(([key, answer]) => [
              key,
              answer.probabilities,
            ]),
          ) as never)
        : null,
    },
  });
}
export async function retryRelatedConflicts(
  ctx: HiveContext,
  cellId: string,
  skipEdges: string[] = [],
) {
  const edges =
    await getSql()`SELECT s.* FROM learning_supersessions s JOIN learnings incoming ON incoming.id = ${cellId} AND incoming.team_id = s.team_id JOIN learnings older ON older.id = s.older_id AND older.team_id = s.team_id JOIN learnings newer ON newer.id = s.newer_id AND newer.team_id = s.team_id WHERE s.team_id = ${ctx.teamId} AND s.status = 'candidate' AND older.lifecycle IN ('fresh','confirmed','outdated') AND newer.lifecycle IN ('fresh','confirmed') AND (s.older_id = ${cellId} OR s.newer_id = ${cellId} OR (older.repo IS NOT DISTINCT FROM incoming.repo AND lower(older.title) = lower(incoming.title))) AND NOT (s.id = ANY(${skipEdges}::text[])) ORDER BY s.created_at LIMIT 3`;
  const results = await Promise.all(
    edges.map(async (edge) => {
      const [older, newer] = await Promise.all([
        conflictCell(ctx, edge.older_id),
        conflictCell(ctx, edge.newer_id),
      ]);
      if (!older || !newer) return null;
      const judgment = await judgeConflict(older, newer);
      const result = await analyticsTransaction(() =>
        getSql().begin(async (tx) => {
          await lockLearningWrites(tx, ctx);
          const current =
            await tx`SELECT id, revision FROM learnings WHERE team_id = ${ctx.teamId} AND id = ANY(${[edge.older_id, edge.newer_id]}::text[])`;
          if (
            current.some(
              (row) =>
                row.revision !==
                (row.id === edge.older_id ? older.revision : newer.revision),
            )
          )
            return null;
          await tx`UPDATE learning_supersessions SET older_revision = ${older.revision}, newer_revision = ${newer.revision} WHERE id = ${edge.id} AND team_id = ${ctx.teamId} AND status = 'candidate'`;
          return applyConflictDecision(tx, ctx, edge.id, judgment);
        }),
      );
      if (result) await recordConflictEvent(ctx, result);
      return result;
    }),
  );
  return results.filter((result) => result !== null);
}
export async function listDecisions(
  ctx: HiveContext,
  filters: { decision?: string; repo?: string; search?: string } = {},
) {
  const rows =
    await getSql()`SELECT d.*, a.title AS older_title, b.title AS newer_title, a.repo, m.name AS author, EXISTS (SELECT 1 FROM members admin WHERE admin.id = ${ctx.memberId} AND admin.team_id = d.team_id AND admin.role = 'admin' AND admin.removed_at IS NULL) AND d.model <> 'legacy' AND d.decision NOT IN ('undecided','reversed') AND NOT EXISTS (SELECT 1 FROM conflict_decisions undo WHERE undo.reverses_id = d.id AND undo.team_id = d.team_id) AS can_reverse, s.older_id, s.newer_id FROM conflict_decisions d JOIN learning_supersessions s ON s.id = d.edge_id AND s.team_id = d.team_id JOIN learnings a ON a.id = s.older_id AND a.team_id = d.team_id JOIN learnings b ON b.id = s.newer_id AND b.team_id = d.team_id JOIN members m ON m.id = d.pushed_by AND m.team_id = d.team_id WHERE d.team_id = ${ctx.teamId} AND (${filters.decision ?? null}::text IS NULL OR d.decision = ${filters.decision ?? null}) AND (${filters.repo ?? null}::text IS NULL OR a.repo = ${filters.repo ?? null}) AND (${filters.search ?? ""} = '' OR concat_ws(' ', a.title, b.title, d.reason, m.name) ILIKE ${"%" + (filters.search ?? "").replace(/[\\%_]/g, "\\$&") + "%"}) ORDER BY d.created_at DESC, d.id DESC LIMIT 100`;
  return rows.map((row) => ({
    id: String(row.id),
    older: { id: String(row.older_id), title: String(row.older_title) },
    newer: { id: String(row.newer_id), title: String(row.newer_title) },
    decision: row.decision as ConflictJudgment["decision"] | "reversed",
    reason: String(row.reason),
    confidence: Number(row.confidence),
    model: String(row.model),
    jev: row.jev as ConflictJudgment["jev"],
    latencyMs: Number(row.latency_ms),
    author: String(row.author),
    repo: row.repo as string | null,
    canReverse: Boolean(row.can_reverse),
    createdAt: row.created_at.toISOString(),
  }));
}
export async function reverseDecision(
  ctx: HiveContext,
  id: string,
  reason: string,
) {
  const result = await analyticsTransaction(() =>
    getSql().begin(async (tx) => {
      await lockLearningWrites(tx, ctx);
      const admin =
        await tx`SELECT id FROM members WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} AND role = 'admin' AND removed_at IS NULL`;
      if (!admin.length)
        throw new HiveError(
          "A team admin is needed to reverse a decision.",
          403,
        );
      const decisions =
        await tx`SELECT d.* FROM conflict_decisions d WHERE d.id = ${id} AND d.team_id = ${ctx.teamId} AND d.model <> 'legacy' AND d.decision NOT IN ('undecided','reversed') AND NOT EXISTS (SELECT 1 FROM conflict_decisions r WHERE r.reverses_id = d.id AND r.team_id = d.team_id) FOR UPDATE`;
      const decision = decisions[0];
      if (!decision)
        throw new HiveNotFoundError("Decision not found or already reversed.");
      const before = decision.before_state as ReturnType<typeof snapshot>[],
        after = decision.after_state as ReturnType<typeof snapshot>[];
      const rows =
        await tx`SELECT * FROM learnings WHERE team_id = ${ctx.teamId} AND id = ANY(${after.map((cell) => String(cell.id))}::text[]) ORDER BY id FOR UPDATE`;
      if (
        rows.length !== after.length ||
        rows
          .map(snapshot)
          .some((cell, i) =>
            Object.entries(cell).some(
              ([key, value]) => value !== after[i]?.[key as keyof typeof cell],
            ),
          )
      )
        throw new HiveError(
          "A cell changes after this decision. Hive cannot safely reverse it.",
          409,
        );
      await tx`UPDATE learning_supersessions SET status = 'rejected', reason = ${reason}, decided_by = ${ctx.memberId}, decided_at = now() WHERE id = ${decision.edge_id} AND team_id = ${ctx.teamId}`;
      await Promise.all(
        before.map(
          (cell) =>
            tx`UPDATE learnings SET lifecycle = ${String(cell.lifecycle)}, superseded_by = ${cell.supersededBy as string | null}, verify_after = ${cell.verifyAfter as string | null}, push_count = ${Number(cell.pushCount)}, last_pushed_at = ${String(cell.lastPushedAt)} WHERE id = ${String(cell.id)} AND team_id = ${ctx.teamId}`,
        ),
      );
      if (decision.decision === "keep_old") {
        const edge = (
          await tx`SELECT newer_id FROM learning_supersessions WHERE id = ${decision.edge_id} AND team_id = ${ctx.teamId}`
        )[0];
        await tx`UPDATE learning_pushes SET learning_id = ${edge.newer_id}, merged = false WHERE id = ANY(${decision.moved_push_ids}::text[]) AND team_id = ${ctx.teamId}`;
        await tx`UPDATE learning_evidence SET learning_id = ${edge.newer_id} WHERE push_id = ANY(${decision.moved_push_ids}::text[]) AND team_id = ${ctx.teamId}`;
      }
      const updated =
        await tx`SELECT * FROM learnings WHERE team_id = ${ctx.teamId} AND id = ANY(${after.map((cell) => String(cell.id))}::text[]) ORDER BY id`;
      const reversedId = newId("dec");
      await tx`INSERT INTO conflict_decisions (id, team_id, edge_id, decision, reason, confidence, model, latency_ms, pushed_by, before_state, after_state, reverses_id) VALUES (${reversedId}, ${ctx.teamId}, ${decision.edge_id}, 'reversed', ${reason}, 1, 'admin', 0, ${ctx.memberId}, ${tx.json(after as never)}, ${tx.json(updated.map(snapshot) as never)}, ${id})`;
      return { id: reversedId, decision: "reversed" as const };
    }),
  );
  await recordEvent({
    name: "conflict.decided",
    key: result.id,
    origin: currentOrigin() ?? originFor(ctx, "web"),
    outcome: "completed",
    latencyMs: 0,
    properties: { decision: "reversed", decisionConfidence: 1 },
  });
  scheduleKnowledge(ctx);
  return result;
}

export async function decisionRepos(ctx: HiveContext): Promise<string[]> {
  const rows =
    await getSql()`SELECT DISTINCT l.repo FROM conflict_decisions d JOIN learning_supersessions s ON s.id = d.edge_id AND s.team_id = d.team_id JOIN learnings l ON l.id = s.older_id AND l.team_id = s.team_id WHERE d.team_id = ${ctx.teamId} AND l.repo IS NOT NULL ORDER BY l.repo`;
  return rows.map((row) => String(row.repo));
}
