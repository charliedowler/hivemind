import { canonicalProject, redactSecrets, evaluateProjectPolicy, projectPatternMatches, type HiveContext, type OwnerCapturePolicy, workAreasLimit } from "@hivemind/core";
import { z } from "zod";
import { getSql } from "./db/client";
import { HiveError } from "./errors";
import { captureOwner, ownerCapturePolicy, publishProject, publishSelectedProjects, lockCapturePolicy, publicationAuthority, shareProjects } from "./project-sharing";
import { memberContext } from "./identity/enrollment";
import { shareExplanation, shareQuestion } from "@/lib/share-copy";

export type ShareDecision = "yes" | "chosen" | "not_now";

export async function shareOnJoinSettings(ctx: HiveContext, teamId: string) {
  const actor = await captureOwner(ctx);
  const rows = await getSql()`SELECT t.name, o.email_verified, o.provisional, s.answered_at, s.decision, EXISTS (SELECT 1 FROM project_sharing_grants g WHERE g.owner_member_id = o.id AND g.team_id = h.team_id AND g.withdrawn_at IS NULL AND g.grant_kind = 'all_selected') AS shares_all, EXISTS (SELECT 1 FROM project_sharing_grants g WHERE g.owner_member_id = o.id AND g.team_id = h.team_id AND g.withdrawn_at IS NULL) AS shares_projects FROM hive_memberships h JOIN teams t ON t.id = h.team_id JOIN members o ON o.id = h.member_id LEFT JOIN join_share_offers s ON s.owner_member_id = o.id AND s.team_id = h.team_id WHERE h.member_id = ${actor.ownerId} AND h.team_id = ${teamId} AND h.removed_at IS NULL AND t.personal_owner_member_id IS NULL AND o.disabled_at IS NULL`;
  const row = rows[0];
  if (!row || !row.email_verified || row.provisional) return null;
  const [policy, cells] = await Promise.all([ownerCapturePolicy(ctx), getSql()`SELECT repo, count(*)::int AS cells FROM learnings WHERE owner_member_id = ${actor.ownerId} AND team_id = ${actor.personal.teamId} AND repo IS NOT NULL AND lifecycle IN ('fresh','confirmed','outdated') AND NOT capture_flagged GROUP BY repo ORDER BY repo`]);
  const decision: ShareDecision | null = row.decision ?? (row.answered_at ? row.shares_all ? "yes" : row.shares_projects ? "chosen" : "not_now" : null);
  return { teamId, teamName: String(row.name), mode: policy.mode, projects: shareableProjects(policy, cells.map(cell => ({ repo: String(cell.repo), cells: Number(cell.cells) }))), workAreas: policy.workAreas, decision };
}

function shareableProjects(policy: OwnerCapturePolicy, cells: { repo: string; cells: number }[]) {
  const allowed = cells.filter(row => evaluateProjectPolicy(policy, { repo: row.repo }).allowed);
  if (policy.mode === "selected") return policy.include.map(pattern => ({ pattern, cells: allowed.reduce((count, row) => count + (projectPatternMatches(pattern, row.repo) ? row.cells : 0), 0) }));
  const counts = new Map<string, number>();
  for (const row of allowed) {
    const project = canonicalProject(row.repo);
    if (project) counts.set(project, (counts.get(project) ?? 0) + row.cells);
  }
  return [...counts].map(([pattern, cells]) => ({ pattern, cells }));
}

export async function shareOnJoinOffer(ctx: HiveContext, teamId: string) {
  const settings = await shareOnJoinSettings(ctx, teamId);
  if (!settings || settings.decision) return null;
  const { teamName, projects, mode, workAreas } = settings;
  return { teamId, teamName, mode, projects, workAreas, question: shareQuestion(teamName, workAreas), explanation: shareExplanation(teamName) };
}

export const shareWithInput = z.strictObject({ teamId: z.string().min(1), mode: z.enum(["all_selected", "projects", "not_now"]).default("projects"), projects: z.array(z.string().min(1).max(256)).max(100).default([]), humanInstruction: z.string().trim().min(1).max(4000) });
export async function shareWith(ctx: HiveContext, input: unknown) {
  const data = shareWithInput.parse(input);
  data.humanInstruction = redactSecrets(data.humanInstruction).text;
  const [actor, offer] = await Promise.all([captureOwner(ctx), shareOnJoinSettings(ctx, data.teamId)]);
  if (!offer || !await memberContext(ctx.memberId, data.teamId)) throw new HiveError("Join this organisation before sharing.", 403);
  const projects = data.mode === "projects" ? [...new Set(data.projects.map(value => canonicalProject(value, true)))] : [];
  return getSql().begin(async tx => {
    await captureOwner(ctx, tx);
    await lockCapturePolicy(tx, actor.ownerId);
    await publicationAuthority(tx, ctx, data.teamId, actor.ownerId, false, data.humanInstruction);
    const available = new Set(offer.projects.map(project => project.pattern));
    if (projects.some(project => !project || !available.has(project))) throw new HiveError("Choose from the projects Hive offered.", 400);
    await tx`UPDATE project_sharing_grants SET withdrawn_at = now(), withdrawn_by = ${ctx.memberId}, revision = revision + 1 WHERE owner_member_id = ${actor.ownerId} AND team_id = ${data.teamId} AND withdrawn_at IS NULL`;
    await tx`UPDATE learning_shares SET withdrawn_at = now(), withdrawn_by = ${ctx.memberId} WHERE owner_member_id = ${actor.ownerId} AND team_id = ${data.teamId} AND project_grant_id IS NOT NULL AND withdrawn_at IS NULL`;
    let published = 0;
    if (data.mode === "all_selected") published = (await publishSelectedProjects(ctx, data.teamId, data.humanInstruction, tx)).published;
    for (const project of data.mode === "projects" ? projects : []) {
      const grant = await publishProject(ctx, data.teamId, project!, tx, data.humanInstruction);
      published += grant.published;
    }
    const decision = data.mode === "all_selected" ? "yes" : data.mode === "projects" ? "chosen" : "not_now";
    await tx`INSERT INTO join_share_offers (owner_member_id, team_id, answered_at, projects, human_instruction, decision) VALUES (${actor.ownerId}, ${data.teamId}, now(), ${data.mode === "projects" ? projects as string[] : []}, ${data.humanInstruction}, ${decision}) ON CONFLICT (owner_member_id, team_id) DO UPDATE SET answered_at = now(), projects = EXCLUDED.projects, human_instruction = EXCLUDED.human_instruction, decision = EXCLUDED.decision`;
    return { mode: data.mode, shared: data.mode === "all_selected" ? "all_selected" : projects, published };
  });
}

export const joinShareInput = z.strictObject({ share: z.boolean(), workAreas: z.string().trim().max(workAreasLimit).optional() });
export async function shareAfterJoin(ctx: HiveContext, teamId: string, teamName: string, input: z.infer<typeof joinShareInput>) {
  if (input.workAreas) {
    const policy = await ownerCapturePolicy(ctx);
    if (input.workAreas !== policy.workAreas) await shareProjects(ctx, { workAreas: input.workAreas, revision: policy.revision, humanInstruction: `I work on ${input.workAreas}.` });
  }
  try {
    const result = await shareWith(ctx, { teamId, mode: input.share ? "all_selected" : "not_now", humanInstruction: input.share ? `Joined ${teamName} with sharing ticked: share the cells Hive captures from my repos with ${teamName}, now and in future.` : `Joined ${teamName} with sharing unticked. Keep my learnings personal for now.` });
    return { decision: input.share ? "yes" as const : "not_now" as const, published: result.published };
  } catch (error) {
    if (error instanceof HiveError) return { decision: null, published: 0 };
    throw error;
  }
}
