import { canonicalProject, redactSecrets, evaluateProjectPolicy, projectPatternMatches, type HiveContext } from "@hivemind/core";
import { z } from "zod";
import { getSql } from "./db/client";
import { HiveError } from "./errors";
import { captureOwner, ownerCapturePolicy, publishProject, publishSelectedProjects } from "./project-sharing";
import { memberContext } from "./identity/enrollment";

export async function shareOnJoinOffer(ctx: HiveContext, teamId: string, includeAnswered = false) {
  const actor = await captureOwner(ctx);
  const rows = await getSql()`SELECT t.name, o.email_verified, o.provisional, s.answered_at FROM hive_memberships h JOIN teams t ON t.id = h.team_id JOIN members o ON o.id = h.member_id LEFT JOIN join_share_offers s ON s.owner_member_id = o.id AND s.team_id = h.team_id WHERE h.member_id = ${actor.ownerId} AND h.team_id = ${teamId} AND h.removed_at IS NULL AND t.personal_owner_member_id IS NULL AND o.disabled_at IS NULL`;
  const row = rows[0];
  if (!row || !row.email_verified || row.provisional || (!includeAnswered && row.answered_at)) return null;
  const policy = await ownerCapturePolicy(ctx);
  const cells = await getSql()`SELECT repo, count(*)::int AS cells FROM learnings WHERE owner_member_id = ${actor.ownerId} AND team_id = ${actor.personal.teamId} AND repo IS NOT NULL AND lifecycle IN ('fresh','confirmed','outdated') AND NOT capture_flagged GROUP BY repo ORDER BY repo`;
  const projects = policy.include.map(pattern => ({ pattern, cells: cells.reduce((count, row) => count + (evaluateProjectPolicy(policy, { repo: row.repo }).allowed && projectPatternMatches(pattern, row.repo) ? row.cells : 0), 0) }));
  return { teamId, teamName: String(row.name), projects };
}

export const shareWithInput = z.strictObject({ teamId: z.string().min(1), mode: z.enum(["all_selected", "projects", "not_now"]).default("projects"), projects: z.array(z.string().min(1).max(256)).max(100).default([]), humanInstruction: z.string().trim().min(1).max(4000) });
export async function shareWith(ctx: HiveContext, input: unknown) {
  const data = shareWithInput.parse(input);
  data.humanInstruction = redactSecrets(data.humanInstruction).text;
  const actor = await captureOwner(ctx);
  const offer = await shareOnJoinOffer(ctx, data.teamId, true);
  if (!offer || !await memberContext(ctx.memberId, data.teamId)) throw new HiveError("Join this organisation before sharing.", 403);
  const available = new Set(offer.projects.map(project => project.pattern));
  const projects = [...new Set(data.projects.map(value => canonicalProject(value, true)))];
  if (projects.some(project => !project || !available.has(project))) throw new HiveError("Choose from your selected projects.", 400);
  return getSql().begin(async tx => {
    let published = 0;
    if (data.mode === "all_selected") published = (await publishSelectedProjects(ctx, data.teamId, data.humanInstruction, tx)).published;
    for (const project of data.mode === "projects" ? projects : []) {
      const grant = await publishProject(ctx, data.teamId, project!, tx, data.humanInstruction);
      published += grant.published;
    }
    await tx`INSERT INTO join_share_offers (owner_member_id, team_id, answered_at, projects, human_instruction) VALUES (${actor.ownerId}, ${data.teamId}, now(), ${projects as string[]}, ${data.humanInstruction}) ON CONFLICT (owner_member_id, team_id) DO UPDATE SET answered_at = now(), projects = EXCLUDED.projects, human_instruction = EXCLUDED.human_instruction`;
    return { mode: data.mode, shared: data.mode === "all_selected" ? "all_selected" : projects, published };
  });
}
