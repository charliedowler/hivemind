"use client";
import { useState } from "react";
import { Button, Card } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
export type ShareOffer = { teamId: string; teamName: string; projects: { pattern: string; cells: number }[] };
export function ShareOnJoin({ teamId, teamName, projects }: ShareOffer) {
  const [selected, setSelected] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function answer(mode: "all_selected" | "projects" | "not_now") {
    setPending(true);
    setError("");
    try {
      const chosen = mode === "projects" ? selected : [];
      const humanInstruction = mode === "all_selected" ? `Share my learnings from all selected projects with ${teamName}, now and in future.` : mode === "projects" ? `Share my learnings from ${chosen.join(", ")} with ${teamName}.` : `Not now. Keep my learnings personal when joining ${teamName}.`;
      await requestJson("/api/app/share-on-join", { teamId, mode, projects: chosen, humanInstruction });
      setDone(true);
    } catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  }
  const selectedSet = new Set(selected);
  if (done) return <p role="status">Your choice is saved. You can change sharing in Account or Team.</p>;
  return <Card className="stack">
    <h2>Share your learnings with {teamName}?</h2>
    <p>Yes shares everything from your selected projects, now and in future. Anything you don't pick stays personal.</p>
    {choosing ? projects.map(project => <label className="row" key={project.pattern}><input type="checkbox" checked={selectedSet.has(project.pattern)} disabled={pending} onChange={event => setSelected(previous => event.target.checked ? [...previous, project.pattern] : previous.filter(pattern => pattern !== project.pattern))} /><span>{project.pattern} · {project.cells} {project.cells === 1 ? "cell" : "cells"}</span></label>) : <p className="small muted">{projects.map(project => `${project.pattern} (${project.cells} ${project.cells === 1 ? "cell" : "cells"})`).join(", ")}</p>}
    <div className="row wrap"><Button disabled={pending || (choosing && !selected.length)} onClick={() => void answer(choosing ? "projects" : "all_selected")}>{choosing ? "Share selected projects" : "Yes"}</Button>{!choosing ? <Button variant="ghost" disabled={pending} onClick={() => setChoosing(true)}>Choose projects</Button> : null}<Button variant="ghost" disabled={pending} onClick={() => void answer("not_now")}>Not now</Button></div>
    {error ? <p role="alert">{error}</p> : null}
  </Card>;
}
