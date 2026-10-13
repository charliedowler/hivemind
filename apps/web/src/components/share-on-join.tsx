"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
import styles from "./share-on-join.module.css";
import type { ShareDecision } from "@/server/share-on-join";
export type ShareOffer = { teamId: string; teamName: string; projects: { pattern: string; cells: number }[]; decision?: ShareDecision | null };
export function ShareOnJoin({ teamId, teamName, projects, decision }: ShareOffer) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [saved, setSaved] = useState<ShareDecision>();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const current = saved ?? decision;
  async function answer(mode: "all_selected" | "projects" | "not_now") {
    setPending(true);
    setError("");
    try {
      const chosen = mode === "projects" ? selected : [];
      const humanInstruction = mode === "all_selected" ? `Share my learnings from all selected projects with ${teamName}, now and in future.` : mode === "projects" ? `Share my learnings from ${chosen.join(", ")} with ${teamName}.` : `Not now. Keep my learnings personal when joining ${teamName}.`;
      await requestJson("/api/app/share-on-join", { teamId, mode, projects: chosen, humanInstruction });
      setSaved(mode === "all_selected" ? "yes" : mode === "projects" ? "chosen" : "not_now");
      setEditing(false);
      setChoosing(false);
      router.refresh();
    } catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  }
  if (current && !editing) return <SharingSummary teamName={teamName} decision={current} empty={!projects.length} onChange={() => { setEditing(true); setSelected([]); }} />;
  return <Card className="stack">
    <h2>Share your learnings with {teamName}?</h2>
    <p>Yes shares everything from your selected projects, now and in future. Anything you don't pick stays personal.</p>
    {!projects.length ? <p>Nothing selected yet; <Link href="/app/account#projects">pick projects on Account</Link> and they'll be shared.</p> : null}
    <ProjectChoices projects={projects} choosing={choosing} selected={selected} pending={pending} onSelect={(pattern, checked) => setSelected(previous => checked ? [...previous, pattern] : previous.filter(value => value !== pattern))} />
    <div className="row wrap"><Button disabled={pending || (choosing && !selected.length)} onClick={() => void answer(choosing ? "projects" : "all_selected")}>{choosing ? "Share selected projects" : "Yes"}</Button>{!choosing ? <Button variant="ghost" disabled={pending} onClick={() => setChoosing(true)}>Choose projects</Button> : null}<Button variant="ghost" disabled={pending} onClick={() => void answer("not_now")}>Not now</Button>{editing ? <Button variant="ghost" disabled={pending} onClick={() => { setEditing(false); setChoosing(false); }}>Cancel</Button> : null}</div>
    {error ? <p role="alert">{error}</p> : null}
  </Card>;
}

function SharingSummary({ teamName, decision, empty, onChange }: { teamName: string; decision: ShareDecision; empty: boolean; onChange: () => void }) {
  const summary = decision === "not_now" ? `Not sharing with ${teamName}` : `Sharing with ${teamName}: ${decision === "yes" ? "everything from your selected projects" : "chosen projects"}`;
  return <div className="stack" role="status">
    <p>{summary}. <button type="button" className={styles.change} onClick={onChange}>Change</button></p>
    {empty ? <p>Nothing selected yet; <Link href="/app/account#projects">pick projects on Account</Link>{decision === "yes" ? " and they'll be shared" : ""}.</p> : null}
  </div>;
}
function ProjectChoices({ projects, choosing, selected, pending, onSelect }: { projects: ShareOffer["projects"]; choosing: boolean; selected: string[]; pending: boolean; onSelect: (pattern: string, checked: boolean) => void }) {
  if (!choosing) return <p className="small muted">{projects.map(project => `${project.pattern} (${project.cells} ${project.cells === 1 ? "cell" : "cells"})`).join(", ")}</p>;
  const selectedSet = new Set(selected);
  return projects.map(project => <label className="row" key={project.pattern}><input type="checkbox" checked={selectedSet.has(project.pattern)} disabled={pending} onChange={event => onSelect(project.pattern, event.target.checked)} /><span>{project.pattern} · {project.cells} {project.cells === 1 ? "cell" : "cells"}</span></label>);
}
