"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { OwnerCapturePolicy, CaptureRule } from "@hivemind/core";
import { Button, Input, Switch } from "@hivemind/design-system";
import type { CaptureRuleInstructionResult } from "@/server/capture-rule-instructions";
import { captureDefaults, defaultCaptureRuleId } from "@/lib/capture-defaults";
import { errorMessage, requestJson } from "@/lib/client";
import { ErrorPanel } from "./primitives";
import "./capture-rules.css";

type Data = { rules: CaptureRule[]; isAdmin: boolean; policy?: OwnerCapturePolicy };
type Undo =
  | { kind: "instruction"; rule: CaptureRule; until: string }
  | { kind: "toggle" | "delete"; rule: CaptureRule };
const endpoint = "/api/app/capture-rules";
const actions = { drop: "Skip", redact: "Remove matching content from", flag: "Keep private" };

function description(rule: CaptureRule) {
  let target: string;
  switch (rule.kind) {
    case "repo_owner":
      target = `captures from repos ${rule.mode === "only_allow" ? "outside" : "owned by"} ${rule.owners.join(", ")}`;
      break;
    case "repo_match": target = `captures from repos matching ${rule.pattern}`; break;
    case "path_match": target = `captures from paths matching ${rule.pattern}`; break;
    case "content_category":
      target = `captures containing ${captureDefaults.find(item => item.category === rule.category)?.label.toLowerCase() ?? "content unrelated to work"}`;
      break;
    case "agent_or_client": target = `captures from ${rule.agent}${rule.sessionType ? ` in ${rule.sessionType} sessions` : ""}`; break;
    case "keyword": target = `captures containing ${rule.regex ? "text matching " : ""}${rule.pattern}`; break;
  }
  return `${actions[rule.action]} ${target}.`;
}

function useCaptureChoices(initial: Data, scope: "team" | "personal", onPolicySaved?: (policy: OwnerCapturePolicy) => void) {
  const [rules, setRules] = useState(initial.rules);
  const [projectPolicy, setProjectPolicy] = useState(initial.policy);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState("");
  const [undo, setUndo] = useState<Undo>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const question = useRef("");
  const editable = scope === "personal" || initial.isAdmin;
  const visible = rules.filter(rule => rule.scope === (scope === "team" ? "team" : "member"));
  const defaults = scope === "team" ? captureDefaults.map(item => ({ ...item, rule: visible.find(rule => rule.id === defaultCaptureRuleId(rule.teamId, item.category)) })) : [];
  const custom = visible.filter(rule => !defaults.some(item => item.rule?.id === rule.id));

  async function run(change: () => Promise<void>) {
    if (pending) return;
    setError("");
    setPending(true);
    try { await change(); } catch (caught) { setError(errorMessage(caught)); } finally { setPending(false); }
  }

  function replace(before: CaptureRule, after: CaptureRule) {
    setRules(current => current.map(rule => rule.id === before.id ? after : rule));
  }

  async function toggle(rule: CaptureRule) {
    await run(async () => {
      const updated = await requestJson<CaptureRule>(`${endpoint}/${encodeURIComponent(rule.id)}`, { ...rule, enabled: !rule.enabled }, undefined, "PATCH");
      replace(rule, updated);
      setUndo({ kind: "toggle", rule });
      setSummary(`${description(updated)} ${updated.enabled ? "On." : "Off."}`);
    });
  }

  async function remove(rule: CaptureRule) {
    await run(async () => {
      await requestJson(`${endpoint}/${encodeURIComponent(rule.id)}`, undefined, undefined, "DELETE");
      setRules(current => current.filter(item => item.id !== rule.id));
      setUndo({ kind: "delete", rule });
      setSummary(`Removed: ${description(rule)} Earlier changes to cells stay as they are.`);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!text.trim()) return;
    void run(async () => {
      const instruction = question.current && !/^undo[.!]?$/i.test(text.trim()) ? `${question.current}\nRequired detail: ${text.trim()}` : text.trim();
      const result = await requestJson<CaptureRuleInstructionResult>(`${endpoint}/propose`, { text: instruction, scope });
      question.current = result.status === "question" ? instruction : "";
      if (result.status === "question") {
        setSummary(result.question ?? "What should Hive leave out?");
      } else if (result.status === "saved" && result.policy) {
        setProjectPolicy(result.policy);
        onPolicySaved?.(result.policy);
        setSummary(result.restatement);
        setUndo(undefined);
      } else if (result.status === "saved" && result.rule) {
        setRules(current => [...current, result.rule!]);
        setSummary(`${description(result.rule)}${result.counts?.applied ? ` ${result.counts.applied} existing cell${result.counts.applied === 1 ? "" : "s"} changed.` : ""}${result.counts?.pending ? " Hive is checking older cells." : ""}${result.counts?.stopped ? " Hive stopped checking older cells because access or the saved choice changed." : ""}`);
        setUndo(result.undoUntil ? { kind: "instruction", rule: result.rule, until: result.undoUntil } : undefined);
      } else {
        setSummary("Hive removed your latest saved exclusion.");
        setRules((await requestJson<Data>(endpoint)).rules);
        setUndo(undefined);
      }
      setText("");
    });
  }

  async function restore() {
    if (!undo) return;
    await run(async () => {
      if (undo.kind === "instruction") {
        if (Date.parse(undo.until) <= Date.now()) throw new Error("The one-hour Undo period has ended.");
        const result = await requestJson<CaptureRuleInstructionResult>(`${endpoint}/undo`, { ruleId: undo.rule.id });
        setRules(current => current.filter(rule => rule.id !== undo.rule.id));
        setSummary(`Undone.${result.counts?.restored ? ` ${result.counts.restored} cell${result.counts.restored === 1 ? "" : "s"} restored.` : ""}${result.counts?.retained ? ` ${result.counts.retained} cell${result.counts.retained === 1 ? "" : "s"} kept as ${result.counts.retained === 1 ? "it is" : "they are"} to protect later changes or other exclusions.` : ""}${result.counts?.pending ? " Hive is restoring older cells." : ""}`);
      } else if (undo.kind === "toggle") {
        const restored = await requestJson<CaptureRule>(`${endpoint}/${encodeURIComponent(undo.rule.id)}`, undo.rule, undefined, "PATCH");
        replace(undo.rule, restored);
        setSummary("Undone. Hive restored your previous choice.");
      } else {
        const restored = await requestJson<CaptureRule>(endpoint, undo.rule);
        setRules(current => [...current, restored]);
        setSummary("Undone. Hive will use this exclusion again.");
      }
      setUndo(undefined);
    });
  }

  return { projectPolicy, defaults, custom, text, summary, undo, pending, error, editable, needsReply: Boolean(question.current), setText, submit, toggle, remove, restore };
}

type Choices = ReturnType<typeof useCaptureChoices>;

function DefaultContent({ defaults, pending, editable, toggle }: Pick<Choices, "defaults" | "pending" | "editable" | "toggle">) {
  if (!defaults.length) return null;
  return (
    <div className="stack capture-defaults">
      {defaults.map(item => (
        <div key={item.category}>
          <Switch label={`Exclude ${item.label.toLowerCase()}`} checked={item.rule?.enabled ?? false} disabled={pending || !editable || !item.rule} onChange={() => item.rule && void toggle(item.rule)} />
          <p className="small muted">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

function CaptureFeedback({ summary, error, undo, pending, restore }: Pick<Choices, "summary" | "error" | "undo" | "pending" | "restore">) {
  return (
    <>
      {summary ? <p role="status" className="capture-summary">{summary}{" "}{undo ? <button type="button" className="capture-undo" disabled={pending} onClick={() => void restore()}>Undo</button> : null}</p> : null}
      {error ? <ErrorPanel message={error} /> : null}
    </>
  );
}

function CaptureDescription({ editable, needsReply, text, pending, setText, submit }: Pick<Choices, "editable" | "needsReply" | "text" | "pending" | "setText" | "submit">) {
  const fieldId = useId();
  if (!editable) return null;
  return (
    <form className="stack" onSubmit={submit}>
      <Input id={fieldId} label={needsReply ? "Your reply" : "Describe something Hive should not keep"} value={text} onChange={event => setText(event.target.value)} placeholder="never keep anything from the wayfarer repo" maxLength={4000} required disabled={pending} />
      <Button type="submit" disabled={!text.trim()} loading={pending}>{needsReply ? "Reply" : "Save"}</Button>
    </form>
  );
}

function ExclusionList({ custom, pending, editable, toggle, remove, personal }: Pick<Choices, "custom" | "pending" | "editable" | "toggle" | "remove"> & { personal: boolean }) {
  return (
    <div className="stack">
      <h3>{personal ? "Things your agents leave out" : "Other things the team leaves out"}</h3>
      {custom.length ? (
        <ul className="capture-list">
          {custom.map(rule => (
            <li key={rule.id}>
              <div className="capture-item">
                <Switch label={description(rule)} checked={rule.enabled} disabled={pending || !editable} onChange={() => void toggle(rule)} />
                {editable ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => void remove(rule)}>Delete</Button> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="small muted">{personal ? "You have no personal exclusions yet." : "The team has no other exclusions."}</p>}
    </div>
  );
}

function ProjectSelection({ initial, onSaved }: {initial: OwnerCapturePolicy; onSaved?: (policy: OwnerCapturePolicy) => void}) {
  const policy = useRef(initial);
  const [include, setInclude] = useState(() => initial.include.join(", "));
  const [exclude, setExclude] = useState(() => initial.exclude.join(", "));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const patterns = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const saved = await requestJson<OwnerCapturePolicy>(`${endpoint}/projects`, {include: patterns(include), exclude: patterns(exclude), revision: policy.current.revision, humanInstruction: `Learn privately from ${include || "no projects"}; exclude ${exclude || "none"}.`});
      policy.current = saved;
      onSaved?.(saved);
      setInclude(saved.include.join(", "));
      setExclude(saved.exclude.join(", "));
      setMessage("Saved your projects for private capture.");
    } catch (caught) { setError(errorMessage(caught)); } finally { setPending(false); }
  }
  return <form className="stack" onSubmit={event => void save(event)}>
    <Input label="Projects Hive may learn from" value={include} onChange={event => setInclude(event.target.value)} placeholder="github.com/team/project" maxLength={25700} disabled={pending} />
    <Input label="Projects to exclude" value={exclude} onChange={event => setExclude(event.target.value)} placeholder="github.com/team/private-*" maxLength={25700} disabled={pending} />
    <p className="small muted">Use comma-separated projects. Captures stay in your personal hive. With no projects selected, Hive captures nothing.</p>
    <Button type="submit" loading={pending}>Save projects</Button>
    {message ? <p role="status">{message}</p> : null}
    {error ? <ErrorPanel message={error} /> : null}
  </form>;
}

export function CaptureRules({ initial, scope = "team", onPolicySaved }: { initial: Data; scope?: "team" | "personal"; onPolicySaved?: (policy: OwnerCapturePolicy) => void }) {
  const choices = useCaptureChoices(initial, scope, onPolicySaved);
  const personal = scope === "personal";
  const title = personal ? "What your agents keep" : "What Hive keeps";
  return (
    <section className="stack capture-page" aria-label={title}>
      <div>
        <h2>{title}</h2>
        <p className="muted">{personal ? "Choose the projects your agents may learn from privately. Organisation sharing is separate." : "Choose what every member's agents leave out."}</p>
      </div>
      {!choices.editable ? <p className="small">Only team admins can change these choices.</p> : null}
      {personal && choices.projectPolicy ? <ProjectSelection key={choices.projectPolicy.revision} initial={choices.projectPolicy} onSaved={onPolicySaved} /> : null}
      <DefaultContent {...choices} />
      <CaptureFeedback {...choices} />
      <CaptureDescription {...choices} />
      <ExclusionList {...choices} personal={personal} />
    </section>
  );
}
