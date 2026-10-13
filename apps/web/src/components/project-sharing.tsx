"use client";
import type { OwnerCapturePolicy } from "@hivemind/core";
import type { projectShareState } from "@/server/web-sharing";
import { ShareOnJoin } from "./share-on-join";
export function ProjectSharing({ policy, initial }: {
  policy: OwnerCapturePolicy;
  initial: Awaited<ReturnType<typeof projectShareState>>;
}) {
  return <section className="stack" aria-label="Project sharing">
    <h3>Shared projects</h3>
    {initial.map(org => org.sharing ? <ShareOnJoin key={`${org.teamId}:${policy.revision}:${org.sharing.decision}`} {...org.sharing} projects={policy.include.map(pattern => ({ pattern, cells: org.sharing!.projects.find(project => project.pattern === pattern)?.cells ?? 0 }))} /> : null)}
    {!initial.length ? <p className="small muted">Projects stay in your personal hive until you share with a team.</p> : null}
  </section>;
}
