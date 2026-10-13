"use client";
import { useState } from "react";
import { Button, Card } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
export type ShareOffer = { teamId: string; teamName: string; projects: { pattern: string; cells: number }[] };
export function ShareOnJoin({ teamId, teamName, projects }: ShareOffer) {
  const [selected, setSelected] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function answer(share: boolean) {
    setPending(true);
    setError("");
    try {
      const chosen = share ? selected : [];
      await requestJson("/api/app/share-on-join", { teamId, projects: chosen, humanInstruction: share ? `Share my learnings from ${chosen.join(", ")} with ${teamName}.` : `Keep my learnings personal when joining ${teamName}.` });
      setDone(true);
    } catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  }
  const selectedSet = new Set(selected);
  if (done) return <p role="status">Your choice is saved. You can change sharing in Account.</p>;
  return <Card className="stack">
    <h2>Share your learnings with {teamName}?</h2>
    <p>Anything you don't pick stays personal.</p>
    {projects.map(project => <label className="row" key={project.pattern}>
      <input type="checkbox" checked={selectedSet.has(project.pattern)} disabled={pending} onChange={event => setSelected(previous => event.target.checked ? [...previous, project.pattern] : previous.filter(pattern => pattern !== project.pattern))} />
      <span>{project.pattern} · {project.cells} {project.cells === 1 ? "cell" : "cells"}</span>
    </label>)}
    <div className="row wrap"><Button disabled={!selected.length || pending} onClick={() => void answer(true)}>Share</Button><Button variant="ghost" disabled={pending} onClick={() => void answer(false)}>Keep personal</Button></div>
    {error ? <p role="alert">{error}</p> : null}
  </Card>;
}
