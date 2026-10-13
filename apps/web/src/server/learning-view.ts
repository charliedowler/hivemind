import {
  excludedFromRetrieval,
  type LearningStanding,
  type HiveContext,
  type LearningView,
} from "@hivemind/core";

export function learningView(
  row: Record<string, unknown>,
  ctx?: HiveContext,
): LearningStanding {
  const date = (value: unknown) =>
    new Date(value as string | Date).toISOString();
  const learning: LearningStanding = {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    kind: row.kind as LearningView["kind"],
    tags: row.tags as string[],
    repo: row.repo as string | null,
    paths: row.paths as string[],
    confidence: Number(row.confidence),
    source: row.source as LearningView["source"],
    author: {
      id: String(row.member_id),
      name: String(row.author_name),
      actorType: row.author_actor_type as "human" | "agent" | undefined,
      ownerName: row.owner_name as string | null | undefined,
    },
    pushCount: Number(row.push_count),
    votes: {
      up: Number(row.up_votes),
      down: Number(row.down_votes),
      outdated: Number(row.outdated_votes),
    },
    feedbackStanding:
      row.weighted_net_votes === undefined
        ? undefined
        : {
            weightedNetVotes: Number(row.weighted_net_votes),
            usefulOutcomes: Number(row.useful_outcomes),
            contradictedOutcomes: Number(row.contradicted_outcomes),
            staleOutcomes: Number(row.stale_outcomes),
            lastOutcome: row.last_outcome as NonNullable<
              LearningStanding["feedbackStanding"]
            >["lastOutcome"],
            lastOutcomeAt: row.last_outcome_at
              ? date(row.last_outcome_at)
              : null,
            lastConfirmedAt: row.last_confirmed_at
              ? date(row.last_confirmed_at)
              : null,
            lastContradictedAt: row.last_contradicted_at
              ? date(row.last_contradicted_at)
              : null,
          },
    unhelpfulLabel:
      Number(row.down_votes) > 0
        ? `Marked unhelpful by ${Number(row.down_votes)}`
        : null,
    lifecycle: row.lifecycle as LearningView["lifecycle"],
    revision: Number(row.revision),
    verifyAfter: row.verify_after ? date(row.verify_after) : null,
    verifyBeforeUse:
      row.lifecycle === "outdated" ||
      Boolean(
        row.verify_after &&
        new Date(row.verify_after as string).getTime() <= Date.now(),
      ),
    supersededBy: row.superseded_by as string | null,
    sessionRef: row.session_ref as string | null,
    permalink:
      row.source === "slack" &&
      typeof row.session_ref === "string" &&
      /^https:\/\/[^/]+\.slack\.com\//.test(row.session_ref)
        ? row.session_ref
        : null,
    classification: row.classification as LearningView["classification"],
    adminOutdated: Boolean(row.admin_outdated),
    captureFlagged: Boolean(row.capture_flagged),
    canConfirmCapture: Boolean(
      row.capture_flagged &&
      ctx &&
      (row.member_id === ctx.memberId ||
        row.owner_member_id === ctx.memberId) &&
      ["fresh", "confirmed"].includes(String(row.lifecycle)),
    ),
    captureCategories:
      (row.capture_categories as Record<string, boolean> | undefined) ?? {},
    captureRedacted: Boolean(row.capture_redacted),
    captureRuleIds: (row.capture_rule_ids as string[] | undefined) ?? [],
    area: row.area as LearningView["area"],
    cost: row.cost == null ? null : Number(row.cost),
    blocked: row.blocked == null ? null : Boolean(row.blocked),
    workaround: row.workaround as string | null,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    lastPushedAt: date(row.last_pushed_at),
  };
  learning.retrievalExcluded = excludedFromRetrieval(learning);
  return learning;
}
