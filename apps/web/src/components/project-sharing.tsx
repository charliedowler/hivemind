"use client";
import { useState } from "react";
import { Button } from "@hivemind/design-system";
import type { OwnerCapturePolicy } from "@hivemind/core";
import type { projectShareState } from "@/server/web-sharing";
import { requestJson, errorMessage } from "@/lib/client";
export function ProjectSharing({
  policy,
  initial,
}: {
  policy: OwnerCapturePolicy;
  initial: Awaited<ReturnType<typeof projectShareState>>;
}) {
  const [organisations, setOrganisations] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function act(teamId: string, pattern: string, grantId?: string) {
    setPending(true);
    setError("");
    try {
      setOrganisations(
        await requestJson(
          "/api/app/project-sharing",
          grantId
            ? { action: "withdraw", teamId, grantId }
            : { action: "share", teamId, pattern },
        ),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="stack" aria-label="Project sharing">
      <h3>Shared projects</h3>
      <p>
        {policy.include.length
          ? `Your agents may learn from ${policy.include.join(", ")}.`
          : "No projects selected yet."}{" "}
        {policy.exclude.length
          ? `Your agents leave out ${policy.exclude.join(", ")}.`
          : "Other projects stay out of Hive."}
      </p>
      {organisations.map((org) => (
        <div className="stack" key={org.teamId}>
          <h3>{org.teamName}</h3>
          {org.grants.filter(grant => grant.kind === "all_selected").map(grant => <div className="row between wrap" key={grant.id}><span>All selected projects, now and in future · Shared</span><Button size="sm" variant="secondary" disabled={pending} onClick={() => void act(org.teamId, grant.pattern, grant.id)}>Make personal</Button></div>)}
          {[
            ...new Set([
              ...policy.include,
              ...org.grants.filter(grant => grant.kind !== "all_selected").map((grant) => grant.pattern),
            ]),
          ].map((pattern) => {
            const grant = org.grants.find((grant) => grant.pattern === pattern);
            return (
              <div className="row between wrap" key={pattern}>
                <span className="small breakable">
                  {pattern} · {grant ? "Shared" : "Kept private"}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void act(org.teamId, pattern, grant?.id)}
                >
                  {grant ? "Make personal" : `Share with ${org.teamName}`}
                </Button>
              </div>
            );
          })}
        </div>
      ))}
      {!organisations.length ? (
        <p className="small muted">
          Projects stay in your personal hive until you share with a team.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
