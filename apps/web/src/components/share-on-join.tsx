"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card } from "@hivemind/design-system";
import type { CaptureMode } from "@hivemind/core";
import { requestJson, errorMessage } from "@/lib/client";
import { shareAllInstruction, shareCheckboxLabel, shareExplanation, shareQuestion, shareTickedExplanation } from "@/lib/share-copy";
import styles from "./share-on-join.module.css";
import type { ShareDecision } from "@/server/share-on-join";
export type ShareOffer = { teamId: string; teamName: string; projects: { pattern: string; cells: number }[]; mode?: CaptureMode; workAreas?: string; decision?: ShareDecision | null; preselect?: boolean };
export function ShareOnJoin({ teamId, teamName, projects, mode = "everything", workAreas, decision, preselect = false }: ShareOffer) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [saved, setSaved] = useState<ShareDecision>();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [share, setShare] = useState(true);
  const current = saved ?? decision;
  async function answer(choice: "all_selected" | "projects" | "not_now") {
    setPending(true);
    setError("");
    try {
      const chosen = choice === "projects" ? selected : [];
      const humanInstruction = choice === "all_selected" ? shareAllInstruction(teamName) : choice === "projects" ? `Share my learnings from ${chosen.join(", ")} with ${teamName}.` : `Not now. Keep my learnings personal when joining ${teamName}.`;
      await requestJson("/api/app/share-on-join", { teamId, mode: choice, projects: chosen, humanInstruction });
      setSaved(choice === "all_selected" ? "yes" : choice === "projects" ? "chosen" : "not_now");
      setEditing(false);
      setChoosing(false);
      router.refresh();
    } catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  }
  if (current && !editing) return <SharingSummary teamName={teamName} decision={current} emptySelection={mode === "selected" && !projects.length} onChange={() => { setEditing(true); setSelected([]); }} />;
  return <Card className="stack">
    <h2>{shareQuestion(teamName, workAreas)}</h2>
    <p>{preselect ? shareTickedExplanation(teamName) : shareExplanation(teamName)}</p>
    {mode === "selected" && !projects.length ? <EmptySelection suffix=" and they'll be shared" /> : null}
    {mode === "everything" && !projects.length ? <p className="small muted">Hive has not captured anything yet.</p> : null}
    <ProjectChoices projects={projects} choosing={choosing} selected={selected} pending={pending} onSelect={(pattern, checked) => setSelected(previous => checked ? [...previous, pattern] : previous.filter(value => value !== pattern))} />
    {preselect && !choosing ? <label className="row"><input type="checkbox" checked={share} disabled={pending} onChange={event => setShare(event.target.checked)} /><span>{shareCheckboxLabel(teamName)}</span></label> : null}
    <div className="row wrap">{preselect && !choosing ? <Button disabled={pending} onClick={() => void answer(share ? "all_selected" : "not_now")}>{share ? `Share with ${teamName}` : "Keep everything personal"}</Button> : <Button disabled={pending || (choosing && !selected.length)} onClick={() => void answer(choosing ? "projects" : "all_selected")}>{choosing ? "Share selected projects" : "Yes"}</Button>}{!choosing && projects.length ? <Button variant="ghost" disabled={pending} onClick={() => setChoosing(true)}>Choose projects</Button> : null}{preselect && !choosing ? null : <Button variant="ghost" disabled={pending} onClick={() => void answer("not_now")}>Not now</Button>}{editing ? <Button variant="ghost" disabled={pending} onClick={() => { setEditing(false); setChoosing(false); }}>Cancel</Button> : null}</div>
    {error ? <p role="alert">{error}</p> : null}
  </Card>;
}

function EmptySelection({ suffix }: { suffix: string }) {
  return <p>Hive is set to selected projects only and none are listed; <Link href="/app/account#projects">change that on Account</Link>{suffix}.</p>;
}
function SharingSummary({ teamName, decision, emptySelection, onChange }: { teamName: string; decision: ShareDecision; emptySelection: boolean; onChange: () => void }) {
  const summary = decision === "not_now" ? `Not sharing with ${teamName}` : `Sharing with ${teamName}: ${decision === "yes" ? "everything Hive captures for you" : "chosen projects"}`;
  return <div className="stack" role="status">
    <p>{summary}. <button type="button" className={styles.change} onClick={onChange}>Change</button></p>
    {emptySelection ? <EmptySelection suffix={decision === "yes" ? " and they'll be shared" : ""} /> : null}
  </div>;
}
function ProjectChoices({ projects, choosing, selected, pending, onSelect }: { projects: ShareOffer["projects"]; choosing: boolean; selected: string[]; pending: boolean; onSelect: (pattern: string, checked: boolean) => void }) {
  if (!choosing) return projects.length ? <p className="small muted">So far: {projects.map(project => `${project.pattern} (${project.cells} ${project.cells === 1 ? "cell" : "cells"})`).join(", ")}</p> : null;
  const selectedSet = new Set(selected);
  return projects.map(project => <label className="row" key={project.pattern}><input type="checkbox" checked={selectedSet.has(project.pattern)} disabled={pending} onChange={event => onSelect(project.pattern, event.target.checked)} /><span>{project.pattern} · {project.cells} {project.cells === 1 ? "cell" : "cells"}</span></label>);
}
