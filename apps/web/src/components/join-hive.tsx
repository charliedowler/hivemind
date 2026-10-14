"use client";
import { useId, useState } from "react";
import { Button, Card, Input } from "@hivemind/design-system";
import { requestJson } from "@/lib/client";
import { joinFailure } from "@/lib/onboarding-copy";
import { shareCheckboxLabel } from "@/lib/share-copy";
import { captureCopy } from "./capture-rules";

export const joinShareCopy = {
  label: shareCheckboxLabel,
  explanation: (teamName: string) =>
    `Hive captures learnings from the Git repos your agents work in and keeps them in your personal hive. With this ticked, ${teamName} also sees the cells from those repos, now and in future. Your originals stay personal, and you can change this later on the Team page.`,
  declined: "Untick to keep everything personal for now.",
};

export function JoinHive({
  phrase,
  teamName,
  sharedProjects,
  workAreas: savedWorkAreas = "",
}: {
  phrase: string;
  teamName: string;
  sharedProjects: number;
  workAreas?: string;
}) {
  const shareId = useId();
  const [share, setShare] = useState(true);
  const [workAreas, setWorkAreas] = useState(savedWorkAreas);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function join() {
    setPending(true);
    try {
      const result = await requestJson<{ destination: string }>(
        "/api/app/join-phrase",
        { phrase, share, ...(workAreas.trim() ? { workAreas: workAreas.trim() } : {}) },
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
        projects will appear in {teamName}. Your agents join with you.
      </p>
      <label className="row" htmlFor={shareId}>
        <input
          id={shareId}
          type="checkbox"
          checked={share}
          disabled={pending}
          onChange={(event) => setShare(event.target.checked)}
        />
        <span>{joinShareCopy.label(teamName)}</span>
      </label>
      <p className="small">{joinShareCopy.explanation(teamName)}</p>
      <p className="small muted">{joinShareCopy.declined}</p>
      <Input
        label="What you work on (optional)"
        value={workAreas}
        onChange={(event) => setWorkAreas(event.target.value)}
        placeholder={captureCopy.workAreasPlaceholder}
        maxLength={300}
        disabled={pending}
      />
      <p className="small muted">{captureCopy.workAreas}</p>
      <Button loading={pending} onClick={() => void join()}>
        {share ? `Join and share with ${teamName}` : `Join ${teamName}`}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
    </Card>
  );
}
