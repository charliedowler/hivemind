"use client";
import { useState } from "react";
import { Button, Card } from "@hivemind/design-system";
import { requestJson } from "@/lib/client";
import { joinFailure } from "@/lib/onboarding-copy";
export function JoinHive({
  phrase,
  teamName,
  sharedProjects,
}: {
  phrase: string;
  teamName: string;
  sharedProjects: number;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function join() {
    setPending(true);
    try {
      const result = await requestJson<{ destination: string }>(
        "/api/app/join-phrase",
        { phrase },
      );
      window.location.assign(result.destination);
    } catch {
      setError(joinFailure);
    } finally {
      setPending(false);
    }
  }
  return (
    <Card className="stack">
      <h1>Join {teamName}</h1>
      <p>
        Your personal hive stays yours. Learnings from {sharedProjects} shared
        projects will appear in {teamName}.
      </p>
      <p className="small muted">
        Your agents join with you. Joining does not share any new projects.
      </p>
      <p className="small">Join {teamName} is selected. Click below to join.</p>
      <Button loading={pending} onClick={() => void join()}>
        Join {teamName}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </Card>
  );
}
