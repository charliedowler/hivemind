import type postgres from "postgres";
import {
  canonicalProject,
  evaluateCaptureRules,
  evaluateProjectPolicy,
  hiveShareProjectsInput,
  projectPatternMatches,
  redactSecrets,
  type CaptureRule,
  type HiveContext,
  type HiveShareProjectsInput,
  type OwnerCapturePolicy,
} from "@hivemind/core";
import { getSql } from "./db/client";
import { newId } from "./db/ids";
import { HiveError, HiveNotFoundError } from "./errors";
import { currentOrigin } from "./analytics/events";

type Sql = postgres.Sql | postgres.TransactionSql;
export const noProjectSelection =
  "No projects selected yet; tell me which projects Hive may learn from";

export async function captureOwner(ctx: HiveContext, sql: Sql = getSql()) {
  const rows =
    await sql`SELECT m.id, m.actor_type, coalesce(b.owner_member_id, CASE WHEN m.actor_type = 'human' THEN m.id END) AS owner_id FROM members m JOIN hive_memberships h ON h.member_id = m.id AND h.team_id = ${ctx.teamId} AND h.removed_at IS NULL LEFT JOIN hive_agent_owners b ON b.agent_member_id = m.id WHERE m.id = ${ctx.memberId} AND m.disabled_at IS NULL AND NOT m.provisional FOR SHARE OF m, h`;
  const actor = rows[0];
  if (!actor?.owner_id) throw new HiveError(noProjectSelection, 403);
  let people =
    await sql`SELECT t.id, t.name FROM teams t JOIN members m ON m.id = t.personal_owner_member_id JOIN hive_memberships h ON h.team_id = t.id AND h.member_id = ${ctx.memberId} AND h.removed_at IS NULL WHERE t.personal_owner_member_id = ${actor.owner_id} AND m.actor_type = 'human' AND m.disabled_at IS NULL`;
  if (!people[0] && actor.actor_type === "human") {
    const personal = (
      await sql`SELECT hive_ensure_personal_hive(${actor.owner_id}) AS id`
    )[0];
    people = await sql`SELECT id, name FROM teams WHERE id = ${personal.id}`;
  }
  if (!people[0]) throw new HiveError(noProjectSelection, 403);
  return {
    ownerId: String(actor.owner_id),
    actorType: String(actor.actor_type),
    personal: {
      ...ctx,
      teamId: String(people[0].id),
      teamName: String(people[0].name),
    },
  };
}

function policyView(row?: postgres.Row): OwnerCapturePolicy {
  return {
    include: row?.include_patterns ?? [],
    exclude: row?.exclude_patterns ?? [],
    revision: Number(row?.revision ?? 0),
  };
}
export async function ownerCapturePolicy(
  ctx: HiveContext,
  sql: Sql = getSql(),
): Promise<OwnerCapturePolicy> {
  const { ownerId } = await captureOwner(ctx, sql);
  return policyView(
    (
      await sql`SELECT * FROM owner_capture_policies WHERE owner_member_id = ${ownerId}`
    )[0],
  );
}
export async function lockCapturePolicy(
  tx: postgres.TransactionSql,
  ownerId: string,
) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`capture-owner:${ownerId}`}, 0))`;
}

function narrowsPolicy(before: OwnerCapturePolicy, after: OwnerCapturePolicy) {
  const included = new Set(before.include);
  const excluded = new Set(after.exclude);
  return (
    after.include.every(
      (pattern) =>
        included.has(pattern) ||
        (!/[?*]/.test(pattern) &&
          before.include.some((prior) =>
            projectPatternMatches(prior, pattern),
          )),
    ) && before.exclude.every((pattern) => excluded.has(pattern))
  );
}
function humanAuthority(actorType: string) {
  return actorType === "human" && currentOrigin()?.sessionKind !== "api_key";
}
export async function shareProjects(
  ctx: HiveContext,
  input: HiveShareProjectsInput,
): Promise<OwnerCapturePolicy> {
  const data = hiveShareProjectsInput.parse(input);
  if (data.include === undefined && data.exclude === undefined)
    return ownerCapturePolicy(ctx);
  return getSql().begin(async (tx) => {
    const actor = await captureOwner(ctx, tx);
    await lockCapturePolicy(tx, actor.ownerId);
    const row = (
      await tx`SELECT * FROM owner_capture_policies WHERE owner_member_id = ${actor.ownerId} FOR UPDATE`
    )[0];
    const before = policyView(row);
    if (before.revision !== data.revision)
      throw new HiveError(
        "The project selection changed. Read it again before saving.",
        409,
      );
    const after = {
      include: data.include ?? before.include,
      exclude: data.exclude ?? before.exclude,
      revision: before.revision + 1,
    };
    let authority = humanAuthority(actor.actorType) ? "human" : "restriction";
    if (authority !== "human" && before.revision === 0) {
      if (!data.humanInstruction)
        throw new HiveError(
          "Supply the human's project selection before capture.",
          403,
        );
      authority = "initial_instruction";
    } else if (authority !== "human" && !narrowsPolicy(before, after)) {
      const delegations =
        await tx`SELECT id FROM capture_policy_delegations WHERE owner_member_id = ${actor.ownerId} AND agent_member_id = ${ctx.memberId} AND policy_revision = ${before.revision} AND include_patterns = ${after.include}::text[] AND exclude_patterns = ${after.exclude}::text[] AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`;
      if (!delegations[0])
        throw new HiveError(
          "A human sign-in or explicit delegation is required to add projects.",
          403,
        );
      await tx`UPDATE capture_policy_delegations SET consumed_at = now() WHERE id = ${delegations[0].id}`;
      authority = "delegation";
    }
    const instruction = redactSecrets(
      (
        data.humanInstruction ?? "Project selection updated by its owner."
      ).replace(
        /(?:https?|ssh|git):\/\/[^\s<>]+/gi,
        (value) =>
          canonicalProject(value, true) ?? "[removed repository credentials]",
      ),
    ).text;
    await tx`INSERT INTO owner_capture_policies (owner_member_id, include_patterns, exclude_patterns, revision, human_instruction, updated_by) VALUES (${actor.ownerId}, ${after.include}, ${after.exclude}, ${after.revision}, ${instruction}, ${ctx.memberId}) ON CONFLICT (owner_member_id) DO UPDATE SET include_patterns = EXCLUDED.include_patterns, exclude_patterns = EXCLUDED.exclude_patterns, revision = EXCLUDED.revision, human_instruction = EXCLUDED.human_instruction, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await tx`INSERT INTO owner_capture_policy_history (owner_member_id, revision, include_patterns, exclude_patterns, human_instruction, actor_member_id, authority) VALUES (${actor.ownerId}, ${after.revision}, ${after.include}, ${after.exclude}, ${instruction}, ${ctx.memberId}, ${authority})`;
    const activeShares =
      await tx`SELECT learning_id, team_id, public_content FROM learning_shares WHERE owner_member_id = ${actor.ownerId} AND withdrawn_at IS NULL ORDER BY team_id, learning_id FOR UPDATE`;
    for (const share of activeShares)
      if (
        !evaluateProjectPolicy(after, { repo: share.public_content.repo })
          .allowed
      )
        await tx`UPDATE learning_shares SET withdrawn_at = now(), withdrawn_by = ${ctx.memberId} WHERE learning_id = ${share.learning_id} AND team_id = ${share.team_id}`;
    const selectionGrants = await tx`SELECT id, team_id FROM project_sharing_grants WHERE owner_member_id = ${actor.ownerId} AND grant_kind = 'all_selected' AND withdrawn_at IS NULL ORDER BY team_id`;
    const personalCells = selectionGrants.length ? await tx`SELECT id FROM learnings WHERE team_id = ${actor.personal.teamId} AND owner_member_id = ${actor.ownerId} ORDER BY id` : [];
    for (const grant of selectionGrants) for (const cell of personalCells) await publishRevision(tx, ctx, cell.id, grant.team_id, grant.id, false);
    return after;
  });
}

export async function delegateProjectSelection(
  ctx: HiveContext,
  agentId: string,
  input: HiveShareProjectsInput,
) {
  const data = hiveShareProjectsInput.parse(input);
  const actor = await captureOwner(ctx);
  if (!humanAuthority(actor.actorType) || !data.include || !data.exclude)
    throw new HiveError(
      "A human must grant this exact project selection.",
      403,
    );
  return getSql().begin(async (tx) => {
    await lockCapturePolicy(tx, actor.ownerId);
    const agents =
      await tx`SELECT b.agent_member_id AS user_id FROM hive_agent_owners b JOIN members m ON m.id = b.agent_member_id WHERE b.agent_member_id = ${agentId} AND b.owner_member_id = ${actor.ownerId} AND m.actor_type = 'agent' AND m.disabled_at IS NULL`;
    if (!agents.length)
      throw new HiveNotFoundError("Agent not found under your account.");
    const policy = await ownerCapturePolicy(ctx, tx);
    if (policy.revision !== data.revision)
      throw new HiveError("The project selection changed. Read it again.", 409);
    const id = newId("pdel");
    await tx`INSERT INTO capture_policy_delegations (id, owner_member_id, agent_member_id, policy_revision, include_patterns, exclude_patterns, expires_at) VALUES (${id}, ${actor.ownerId}, ${agentId}, ${data.revision}, ${data.include!}, ${data.exclude!}, now() + interval '15 minutes')`;
    return { id };
  });
}

export async function requireSelectedProject(
  ctx: HiveContext,
  input: { repo?: string | null; remote?: string | null },
  sql: Sql = getSql(),
) {
  const actor = await captureOwner(ctx, sql);
  const policy = await ownerCapturePolicy(ctx, sql);
  const decision = evaluateProjectPolicy(policy, input);
  if (!decision.allowed)
    throw new HiveError(
      decision.reason === "no_selection"
        ? noProjectSelection
        : "Hive has no permission to capture from this project. Supply one selected, consistent repository.",
      403,
    );
  if (
    ["api_key", "oauth"].includes(currentOrigin()?.sessionKind ?? "") &&
    ctx.teamId !== actor.personal.teamId
  )
    throw new HiveError(
      "Connect to your personal hive before capturing selected projects.",
      403,
    );
  return { ...actor, policy, project: decision.project! };
}

export async function publicationAuthority(
  tx: postgres.TransactionSql,
  ctx: HiveContext,
  teamId: string,
  ownerId: string,
  withdraw = false,
  humanInstruction?: string,
) {
  const actors =
    await tx`SELECT m.actor_type, h.role FROM hive_memberships h JOIN members m ON m.id = h.member_id JOIN teams t ON t.id = h.team_id WHERE h.member_id = ${ctx.memberId} AND h.team_id = ${teamId} AND h.removed_at IS NULL AND m.disabled_at IS NULL AND NOT m.provisional AND t.personal_owner_member_id IS NULL FOR SHARE OF h, m, t`;
  const delegated = humanInstruction && actors[0]?.actor_type === "agent" && (await tx`SELECT c.id FROM agent_credentials c JOIN members o ON o.id = c.owner_member_id JOIN hive_memberships h ON h.member_id = o.id AND h.team_id = ${teamId} WHERE c.agent_member_id = ${ctx.memberId} AND c.owner_member_id = ${ownerId} AND c.revoked_at IS NULL AND o.email_verified AND NOT o.provisional AND o.disabled_at IS NULL AND h.removed_at IS NULL`).length > 0;
  if (
    !actors[0] ||
    (!delegated && !humanAuthority(String(actors[0].actor_type))) ||
    (!delegated && ctx.memberId !== ownerId && !(withdraw && actors[0].role === "admin"))
  )
    throw new HiveError(
      "The owner must publish; an organisation admin may withdraw publication.",
      403,
    );
}
const publicFields = [
  "id",
  "member_id",
  "owner_member_id",
  "title",
  "body",
  "kind",
  "tags",
  "repo",
  "paths",
  "confidence",
  "source",
  "push_count",
  "lifecycle",
  "revision",
  "verify_after",
  "area",
  "cost",
  "blocked",
  "workaround",
  "created_at",
  "updated_at",
  "last_pushed_at",
  "embedding",
];

export async function publishRevision(
  tx: postgres.TransactionSql,
  ctx: HiveContext,
  id: string,
  teamId: string,
  projectGrantId: string | null = null,
  explicit = true,
) {
  if (
    !explicit &&
    (
      await tx`SELECT learning_id FROM learning_shares WHERE learning_id = ${id} AND team_id = ${teamId} AND withdrawn_at IS NOT NULL`
    ).length
  )
    return false;
  const rows =
    await tx`SELECT l.* FROM learnings l JOIN teams t ON t.id = l.team_id WHERE l.id = ${id} AND t.personal_owner_member_id = l.owner_member_id FOR UPDATE OF l`;
  const cell = rows[0];
  if (!cell) throw new HiveNotFoundError("Personal cell not found.");
  const policy = policyView(
    (
      await tx`SELECT * FROM owner_capture_policies WHERE owner_member_id = ${cell.owner_member_id}`
    )[0],
  );
  if (
    !evaluateProjectPolicy(policy, { repo: cell.repo }).allowed ||
    cell.capture_flagged ||
    !["fresh", "confirmed", "outdated"].includes(cell.lifecycle)
  )
    return false;
  const memberships =
    await tx`SELECT h.member_id FROM hive_memberships h JOIN members m ON m.id = h.member_id WHERE h.member_id = ${cell.owner_member_id} AND h.team_id = ${teamId} AND h.removed_at IS NULL AND m.disabled_at IS NULL FOR SHARE OF h`;
  if (!memberships.length) return false;
  await tx`SELECT id FROM teams WHERE id = ${teamId} AND personal_owner_member_id IS NULL FOR SHARE`;
  await tx`SELECT pg_advisory_xact_lock(hashtext(${teamId}), 7291)`;
  const rowsRules =
    await tx`SELECT * FROM capture_rules WHERE team_id = ${teamId} AND scope = 'team' AND enabled FOR SHARE`;
  const rules = rowsRules.map((row) => ({
    ...row.config,
    id: row.id,
    kind: row.kind,
    action: row.action,
    enabled: row.enabled,
  })) as CaptureRule[];
  const context = {
    title: cell.title,
    body: cell.body,
    repo: cell.repo,
    paths: cell.paths,
    agent: cell.source,
    categories: cell.capture_categories,
  };
  const sidecars = [
    ...cell.tags,
    ...cell.paths,
    cell.workaround,
    cell.repo,
  ].filter(Boolean) as string[];
  const checks = [
    context,
    ...sidecars.map((body) => ({ ...context, title: "", body })),
  ].map((input) => evaluateCaptureRules(rules, input));
  if (
    checks.some(
      (result) => result.action !== "allow" || result.neededCategories.length,
    )
  ) {
    await tx`UPDATE learning_shares SET withdrawn_at = now(), withdrawn_by = ${ctx.memberId} WHERE learning_id = ${id} AND team_id = ${teamId} AND withdrawn_at IS NULL`;
    return false;
  }
  const content = Object.fromEntries(
    publicFields
      .filter((key) => cell[key] !== undefined)
      .map((key) => [key, cell[key]]),
  );
  content.repo = canonicalProject(String(cell.repo));
  content.superseded_by = null;
  content.paths = (cell.paths as string[]).filter(
    (path) =>
      !/^(?:[\\/~]|[a-z]:)/i.test(path) && !path.split("/").includes(".."),
  );
  await tx`INSERT INTO learning_shares (learning_id, team_id, owner_member_id, revision, public_content, project_grant_id, granted_by) VALUES (${id}, ${teamId}, ${cell.owner_member_id}, ${cell.revision}, ${tx.json(content)}, ${projectGrantId}, ${ctx.memberId}) ON CONFLICT (learning_id, team_id) DO UPDATE SET revision = EXCLUDED.revision, public_content = EXCLUDED.public_content, project_grant_id = EXCLUDED.project_grant_id, granted_by = EXCLUDED.granted_by, withdrawn_at = NULL, withdrawn_by = NULL, updated_at = now()`;
  return true;
}

export async function publishCell(
  ctx: HiveContext,
  id: string,
  teamId: string,
  revision: number,
) {
  return getSql().begin(async (tx) => {
    const actor = await captureOwner(ctx, tx);
    await lockCapturePolicy(tx, actor.ownerId);
    await publicationAuthority(tx, ctx, teamId, actor.ownerId);
    const rows =
      await tx`SELECT owner_member_id, revision FROM learnings WHERE id = ${id} FOR UPDATE`;
    if (rows[0]?.owner_member_id !== actor.ownerId)
      throw new HiveNotFoundError();
    if (rows[0].revision !== revision)
      throw new HiveError("This cell changed. Read its current revision.", 409);
    return { published: await publishRevision(tx, ctx, id, teamId) };
  });
}
export async function publishProject(
  ctx: HiveContext,
  teamId: string,
  pattern: string,
  transaction?: postgres.TransactionSql,
  humanInstruction?: string,
) {
  const repoPattern = canonicalProject(pattern, true);
  if (!repoPattern)
    throw new HiveError("Use host/namespace/repo for the project.", 400);
  const publish = async (tx: postgres.TransactionSql) => {
    const actor = await captureOwner(ctx, tx);
    await lockCapturePolicy(tx, actor.ownerId);
    await publicationAuthority(tx, ctx, teamId, actor.ownerId, false, humanInstruction);
    const grants =
      await tx`INSERT INTO project_sharing_grants (id, owner_member_id, team_id, repo_pattern, granted_by) VALUES (${newId("pgrant")}, ${actor.ownerId}, ${teamId}, ${repoPattern}, ${ctx.memberId}) ON CONFLICT (owner_member_id, team_id, repo_pattern) DO UPDATE SET withdrawn_at = NULL, withdrawn_by = NULL, granted_by = EXCLUDED.granted_by, revision = project_sharing_grants.revision + 1 RETURNING id`;
    if (humanInstruction) await tx`UPDATE project_sharing_grants SET human_instruction = ${redactSecrets(humanInstruction).text}, instructed_by = ${ctx.memberId} WHERE id = ${grants[0].id}`;
    const cells =
      await tx`SELECT id, repo FROM learnings WHERE team_id = ${actor.personal.teamId} AND owner_member_id = ${actor.ownerId} ORDER BY id`;
    let published = 0;
    for (const cell of cells)
      if (
        projectPatternMatches(repoPattern, cell.repo) &&
        (await publishRevision(tx, ctx, cell.id, teamId, grants[0].id))
      )
        published++;
    return { id: String(grants[0].id), published };
  };
  return transaction ? publish(transaction) : getSql().begin(publish);
}

export async function publishSelectedProjects(ctx: HiveContext, teamId: string, instruction: string, tx: postgres.TransactionSql) {
  const actor = await captureOwner(ctx, tx);
  await lockCapturePolicy(tx, actor.ownerId);
  await publicationAuthority(tx, ctx, teamId, actor.ownerId, false, instruction);
  const grants = await tx`INSERT INTO project_sharing_grants (id, owner_member_id, team_id, repo_pattern, grant_kind, granted_by, human_instruction, instructed_by) VALUES (${newId("pgrant")}, ${actor.ownerId}, ${teamId}, '*', 'all_selected', ${ctx.memberId}, ${redactSecrets(instruction).text}, ${ctx.memberId}) ON CONFLICT (owner_member_id, team_id, repo_pattern) DO UPDATE SET withdrawn_at = NULL, withdrawn_by = NULL, granted_by = EXCLUDED.granted_by, human_instruction = EXCLUDED.human_instruction, instructed_by = EXCLUDED.instructed_by, revision = project_sharing_grants.revision + 1 RETURNING id`;
  const cells = await tx`SELECT id FROM learnings WHERE owner_member_id = ${actor.ownerId} AND team_id = ${actor.personal.teamId} ORDER BY id`;
  let published = 0;
  for (const cell of cells) if (await publishRevision(tx, ctx, cell.id, teamId, grants[0].id)) published++;
  return { id: String(grants[0].id), published };
}

export async function refreshProjectPublications(
  tx: postgres.TransactionSql,
  ctx: HiveContext,
  id: string,
) {
  const rows =
    await tx`SELECT owner_member_id, repo FROM learnings WHERE id = ${id} AND team_id = ${ctx.teamId}`;
  if (!rows[0]) return;
  const grants =
    await tx`SELECT * FROM project_sharing_grants WHERE owner_member_id = ${rows[0].owner_member_id} AND withdrawn_at IS NULL ORDER BY team_id, id`;
  for (const grant of grants)
    if (grant.grant_kind === "all_selected" || projectPatternMatches(grant.repo_pattern, rows[0].repo))
      await publishRevision(tx, ctx, id, grant.team_id, grant.id, false);
}
export async function withdrawPublication(
  ctx: HiveContext,
  id: string,
  teamId: string,
) {
  return getSql().begin(async (tx) => {
    const shares =
      await tx`SELECT owner_member_id FROM learning_shares WHERE learning_id = ${id} AND team_id = ${teamId} FOR UPDATE`;
    if (!shares[0]) throw new HiveNotFoundError();
    await publicationAuthority(
      tx,
      ctx,
      teamId,
      shares[0].owner_member_id,
      true,
    );
    await tx`UPDATE learning_shares SET withdrawn_at = now(), withdrawn_by = ${ctx.memberId} WHERE learning_id = ${id} AND team_id = ${teamId}`;
    return { withdrawn: true };
  });
}
export async function withdrawProject(
  ctx: HiveContext,
  grantId: string,
  teamId: string,
) {
  return getSql().begin(async (tx) => {
    const grants =
      await tx`SELECT owner_member_id FROM project_sharing_grants WHERE id = ${grantId} AND team_id = ${teamId} FOR UPDATE`;
    if (!grants[0]) throw new HiveNotFoundError();
    await publicationAuthority(
      tx,
      ctx,
      teamId,
      grants[0].owner_member_id,
      true,
    );
    await tx`UPDATE project_sharing_grants SET withdrawn_at = now(), withdrawn_by = ${ctx.memberId} WHERE id = ${grantId} AND team_id = ${teamId}`;
    await tx`UPDATE learning_shares SET withdrawn_at = now(), withdrawn_by = ${ctx.memberId} WHERE project_grant_id = ${grantId} AND team_id = ${teamId}`;
    return { withdrawn: true };
  });
}

export async function recheckOrganisationPublications(
  tx: postgres.TransactionSql,
  ctx: HiveContext,
) {
  const shares =
    await tx`SELECT s.learning_id, s.public_content, l.capture_categories FROM learning_shares s LEFT JOIN learnings l ON l.id = s.learning_id AND l.revision = s.revision WHERE s.team_id = ${ctx.teamId} AND s.withdrawn_at IS NULL FOR UPDATE OF s`;
  const rows =
    await tx`SELECT * FROM capture_rules WHERE team_id = ${ctx.teamId} AND scope = 'team' AND enabled`;
  const rules = rows.map((row) => ({
    ...row.config,
    id: row.id,
    kind: row.kind,
    action: row.action,
    enabled: row.enabled,
  })) as CaptureRule[];
  for (const share of shares) {
    const cell = share.public_content;
    const input = {
      title: cell.title,
      body: cell.body,
      repo: cell.repo,
      paths: cell.paths,
      agent: cell.source,
      categories: share.capture_categories,
    };
    const extras = [
      ...(cell.tags ?? []),
      ...(cell.paths ?? []),
      cell.workaround,
      cell.repo,
    ].filter(Boolean);
    const results = [
      input,
      ...extras.map((body) => ({ ...input, title: "", body })),
    ].map((value) => evaluateCaptureRules(rules, value));
    if (
      results.some(
        (result) => result.action !== "allow" || result.neededCategories.length,
      )
    )
      await tx`UPDATE learning_shares SET withdrawn_at = now(), withdrawn_by = ${ctx.memberId} WHERE learning_id = ${share.learning_id} AND team_id = ${ctx.teamId}`;
  }
}
