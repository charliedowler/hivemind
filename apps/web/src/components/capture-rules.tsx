"use client";
import { formatHumanDateTime } from "@hivemind/core";

import { useState, type FormEvent } from "react";
import type { CaptureRule, CaptureRuleInput } from "@hivemind/core";
import { parseCaptureRuleForm } from "@/lib/capture-rule-form";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Input,
  Select,
  Switch,
} from "@hivemind/design-system";
import { errorMessage, requestJson, relativeTime } from "@/lib/client";
import { ErrorPanel } from "./primitives";
import "./capture-rules.css";

type Application = {
  id: string;
  ruleId: string;
  learningId: string;
  title?: string;
  ruleName?: string | null;
  action?: string;
  createdAt: string;
  reversedAt?: string | null;
  reversalReason?: string | null;
};
type Data = {
  rules: CaptureRule[];
  applications: Application[];
  isAdmin: boolean;
};
type Proposal = {
  rule: CaptureRuleInput | null;
  restatement: string;
  question: string | null;
};
type Preview = {
  token: string;
  ruleId: string;
  count: number;
  scanned: number;
  truncated: boolean;
  expiresAt: string;
  nextCursor: string | null;
};
const endpoint = "/api/app/capture-rules";
const outcomes = {
  drop: {
    past: "retracted",
    confirm: "retraction",
    description:
      "Matching cells will be retracted from current guidance. Your earlier content stays private; an admin can reverse this action.",
  },
  redact: {
    past: "redacted",
    confirm: "redaction",
    description:
      "Matching content will be removed from existing cells and their shared history.",
  },
  flag: {
    past: "made private",
    confirm: "privacy change",
    description:
      "Matching cells will be private to the member who saved them until that member confirms they are safe to share.",
  },
};
const kinds = [
  { value: "repo_owner", label: "Repository owner" },
  { value: "repo_match", label: "Repository pattern" },
  { value: "path_match", label: "File path" },
  { value: "content_category", label: "Content category" },
  { value: "agent_or_client", label: "Agent or client" },
  { value: "keyword", label: "Keyword or regular expression" },
];
const actions = [
  { value: "drop", label: "Exclude the capture" },
  { value: "redact", label: "Remove matching content" },
  { value: "flag", label: "Keep private until I confirm" },
];

export function CaptureRules({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  const [editor, setEditor] = useState<{
    scope: "member" | "team";
    rule?: CaptureRule;
  }>();
  const [describe, setDescribe] = useState(false);
  const [apply, setApply] = useState<CaptureRule>();
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState(false);
  async function refresh() {
    const [rules, history] = await Promise.all([
      requestJson<{ rules: CaptureRule[]; isAdmin: boolean }>(endpoint),
      requestJson<{ applications: Application[] }>(`${endpoint}/history`),
    ]);
    setData({ ...rules, ...history });
  }
  async function mutate(rule: CaptureRule, remove: boolean) {
    setPending(true);
    setError("");
    try {
      await requestJson(
        `${endpoint}/${encodeURIComponent(rule.id)}`,
        remove ? undefined : { ...rule, enabled: !rule.enabled },
        undefined,
        remove ? "DELETE" : "PATCH",
      );
      setSummary(
        remove
          ? "Rule deleted."
          : `Rule ${rule.enabled ? "disabled" : "enabled"}.`,
      );
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  async function saved() {
    setEditor(undefined);
    setDescribe(false);
    setSummary("Rule saved. It applies to future captures.");
    await refresh().catch((caught) => setError(errorMessage(caught)));
  }
  async function applied(result: { applied: number }, preview: Preview) {
    if (!preview.nextCursor) setApply(undefined);
    const action = apply?.action ?? "drop";
    setSummary(
      `${result.applied} cells ${outcomes[action].past} from the ${preview.scanned} cells checked.${preview.nextCursor ? " More cells remain outside this batch." : ""}`,
    );
    await refresh().catch((caught) => setError(errorMessage(caught)));
  }
  return (
    <div className="stack capture-page">
      <div className="page-heading">
        <div>
          <h1>What Hive keeps</h1>
          <p className="muted">Choose what your agents save to the hive.</p>
        </div>
      </div>
      <p>
        Rules apply to future captures. Preview a saved rule to check existing
        cells before changing them.
      </p>
      {error ? <ErrorPanel message={error} /> : null}
      {summary ? (
        <p role="status" className="capture-summary">
          {summary}
        </p>
      ) : null}
      <RuleSection
        title="Your rules"
        rules={data.rules.filter((rule) => rule.scope === "member")}
        editable
        pending={pending}
        onAdd={() => setEditor({ scope: "member" })}
        onDescribe={() => setDescribe(true)}
        onEdit={(rule) => setEditor({ scope: "member", rule })}
        onToggle={(rule) => void mutate(rule, false)}
        onDelete={(rule) => void mutate(rule, true)}
        onApply={setApply}
      />
      <RuleSection
        title="Team rules"
        rules={data.rules.filter((rule) => rule.scope === "team")}
        editable={data.isAdmin}
        pending={pending}
        onAdd={() => setEditor({ scope: "team" })}
        onEdit={(rule) => setEditor({ scope: "team", rule })}
        onToggle={(rule) => void mutate(rule, false)}
        onDelete={(rule) => void mutate(rule, true)}
        onApply={setApply}
      />
      <ApplicationHistory
        applications={data.applications}
        rules={data.rules}
        isAdmin={data.isAdmin}
        onReversed={async () => {
          setSummary("Rule application reversed.");
          await refresh().catch((caught) => setError(errorMessage(caught)));
        }}
      />
      {editor ? (
        <Dialog
          title={editor.rule ? "Edit rule" : "Add rule"}
          onClose={() => setEditor(undefined)}
        >
          <RuleForm
            initial={
              editor.rule ?? {
                name: "",
                kind: "repo_owner",
                owners: [],
                mode: "deny",
                action: "drop",
                scope: editor.scope,
                source: "web",
                enabled: true,
              }
            }
            ruleId={editor.rule?.id}
            onSaved={saved}
            onCancel={() => setEditor(undefined)}
          />
        </Dialog>
      ) : null}
      {describe ? (
        <Dialog title="Describe a rule" onClose={() => setDescribe(false)}>
          <DescribeRule
            isAdmin={data.isAdmin}
            onSaved={saved}
            onCancel={() => setDescribe(false)}
          />
        </Dialog>
      ) : null}
      {apply ? (
        <Dialog
          title="Apply to existing cells"
          onClose={() => setApply(undefined)}
        >
          <ApplyRule
            rule={apply}
            onApplied={applied}
            onCancel={() => setApply(undefined)}
          />
        </Dialog>
      ) : null}
    </div>
  );
}

function RuleSection({
  title,
  rules,
  editable,
  pending,
  onAdd,
  onDescribe,
  onEdit,
  onToggle,
  onDelete,
  onApply,
}: {
  title: string;
  rules: CaptureRule[];
  editable: boolean;
  pending: boolean;
  onAdd: () => void;
  onDescribe?: () => void;
  onEdit: (rule: CaptureRule) => void;
  onToggle: (rule: CaptureRule) => void;
  onDelete: (rule: CaptureRule) => void;
  onApply: (rule: CaptureRule) => void;
}) {
  return (
    <section className="stack" aria-label={title}>
      <div className="capture-section-heading">
        <h2>{title}</h2>
        {editable ? (
          <div className="row wrap">
            {onDescribe ? (
              <Button variant="accent" onClick={onDescribe} disabled={pending}>
                Describe a rule
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onAdd} disabled={pending}>
              Add rule
            </Button>
          </div>
        ) : null}
      </div>
      <p className="muted">
        {title === "Your rules"
          ? "These rules apply to captures from your agents."
          : editable
            ? "These rules apply to every member's captures. Only team admins can change them."
            : "These rules apply to every member's captures. Ask a team admin to change them."}
      </p>
      {rules.length ? (
        rules.map((rule) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            editable={editable}
            pending={pending}
            onEdit={onEdit}
            onToggle={onToggle}
            onDelete={onDelete}
            onApply={onApply}
          />
        ))
      ) : (
        <Card>
          <p>
            {title === "Your rules"
              ? "You have no capture rules yet."
              : "Your team has no capture rules yet."}
          </p>
        </Card>
      )}
    </section>
  );
}

function RuleCard({
  rule,
  editable,
  pending,
  onEdit,
  onToggle,
  onDelete,
  onApply,
}: {
  rule: CaptureRule;
  editable: boolean;
  pending: boolean;
  onEdit: (rule: CaptureRule) => void;
  onToggle: (rule: CaptureRule) => void;
  onDelete: (rule: CaptureRule) => void;
  onApply: (rule: CaptureRule) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <Card className="stack capture-rule">
      <div className="capture-section-heading">
        <h3>{rule.name}</h3>
        {editable ? (
          <Switch
            label={`Enabled: ${rule.name}`}
            checked={rule.enabled}
            disabled={pending}
            onChange={() => onToggle(rule)}
          />
        ) : (
          <Badge>{rule.enabled ? "Enabled" : "Disabled"}</Badge>
        )}
      </div>
      <p className="breakable">{ruleDescription(rule)}</p>
      <p>{actions.find((action) => action.value === rule.action)?.label}</p>
      {editable ? (
        <div className="row wrap">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => onEdit(rule)}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !rule.enabled}
            onClick={() => onApply(rule)}
          >
            Apply to existing cells
          </Button>
          <Button
            size="sm"
            variant={confirmDelete ? "danger" : "ghost"}
            disabled={pending}
            onClick={() =>
              confirmDelete ? onDelete(rule) : setConfirmDelete(true)
            }
          >
            {confirmDelete ? "Confirm deletion" : "Delete"}
          </Button>
          {confirmDelete ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel deletion
            </Button>
          ) : null}
        </div>
      ) : null}
      {confirmDelete ? (
        <p className="small">
          Deleting this rule stops it from affecting future captures. Earlier
          changes stay in the history.
        </p>
      ) : null}
    </Card>
  );
}

function ruleDescription(rule: CaptureRuleInput): string {
  switch (rule.kind) {
    case "repo_owner":
      return rule.mode === "only_allow"
        ? `Repos outside ${rule.owners.join(", ")}`
        : `Repos owned by ${rule.owners.join(", ")}`;
    case "repo_match":
      return `Repo pattern: ${rule.pattern}`;
    case "path_match":
      return `Path pattern: ${rule.pattern}`;
    case "content_category":
      return `Content category: ${rule.category.replaceAll("_", " ")}`;
    case "agent_or_client":
      return `Agent or client: ${rule.agent}${rule.sessionType ? `, session type: ${rule.sessionType}` : ""}`;
    case "keyword":
      return `${rule.regex ? "Regular expression" : "Keyword"}: ${rule.pattern}${rule.caseSensitive ? " (case sensitive)" : " (ignores case)"}`;
  }
}

export function RuleForm({
  initial,
  ruleId,
  onSaved,
  onCancel,
  confirm = false,
  naturalText,
}: {
  initial: CaptureRuleInput;
  ruleId?: string;
  onSaved: () => Promise<void>;
  onCancel: () => void;
  confirm?: boolean;
  naturalText?: string;
}) {
  const [kind, setKind] = useState(initial.kind);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = parseCaptureRuleForm(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the rule fields.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await requestJson(
        ruleId ? `${endpoint}/${encodeURIComponent(ruleId)}` : endpoint,
        {
          ...parsed.data,
          source: "web",
          naturalText: naturalText ?? initial.naturalText,
        },
        undefined,
        ruleId ? "PATCH" : "POST",
      );
      await onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <input type="hidden" name="scope" value={initial.scope} />
      <p className="small">
        {initial.scope === "team"
          ? "This rule affects every member's future captures."
          : "This rule affects your future captures."}
      </p>
      <Input
        label="Rule name"
        name="name"
        defaultValue={initial.name}
        required
        maxLength={120}
      />
      <Select
        label="Match by"
        name="kind"
        value={kind}
        onChange={(event) =>
          setKind(event.target.value as CaptureRuleInput["kind"])
        }
        options={kinds}
      />
      <RuleFields key={kind} kind={kind} initial={initial} />
      <Select
        label="When content matches"
        name="action"
        defaultValue={initial.action}
        options={actions}
      />
      <Switch
        label="Enable this rule"
        name="enabled"
        defaultChecked={initial.enabled}
      />
      {error ? <ErrorPanel message={error} /> : null}
      <div className="row wrap">
        <Button type="submit" loading={pending}>
          {confirm ? "Confirm and save rule" : "Save rule"}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RuleFields({
  kind,
  initial,
}: {
  kind: CaptureRuleInput["kind"];
  initial: CaptureRuleInput;
}) {
  const pattern = "pattern" in initial ? initial.pattern : "";
  switch (kind) {
    case "repo_owner":
      return <OwnerFields initial={initial} />;
    case "repo_match":
      return (
        <Input
          label="Repository pattern"
          name="pattern"
          defaultValue={pattern}
          maxLength={256}
          placeholder="team/private-*"
          hint="Use * for a wildcard."
          required
        />
      );
    case "path_match":
      return (
        <Input
          label="File path pattern"
          name="pattern"
          defaultValue={pattern}
          maxLength={256}
          placeholder="**/private/**"
          hint="Use ** to match across folders."
          required
        />
      );
    case "content_category":
      return (
        <Select
          label="Content category"
          name="category"
          defaultValue={
            initial.kind === kind ? initial.category : "personal_info"
          }
          options={[
            { value: "personal_info", label: "Personal information" },
            { value: "credentials", label: "Credentials" },
            { value: "customer_data", label: "Customer data" },
            { value: "non_work", label: "Content unrelated to work" },
          ]}
        />
      );
    case "agent_or_client":
      return <AgentFields initial={initial} />;
    case "keyword":
      return <KeywordFields initial={initial} pattern={pattern} />;
  }
}

function OwnerFields({ initial }: { initial: CaptureRuleInput }) {
  const selected = initial.kind === "repo_owner" ? initial : undefined;
  return (
    <>
      <Input
        label="Repository owners"
        name="owners"
        defaultValue={selected?.owners.join(", ") ?? ""}
        hint="Separate owners with commas."
        placeholder="team, another-team"
        required
      />
      <Select
        label="Match repositories"
        name="mode"
        defaultValue={selected?.mode ?? "deny"}
        options={[
          { value: "deny", label: "Owned by any listed owner" },
          { value: "only_allow", label: "Outside all listed owners" },
        ]}
      />
    </>
  );
}

function AgentFields({ initial }: { initial: CaptureRuleInput }) {
  const selected = initial.kind === "agent_or_client" ? initial : undefined;
  return (
    <>
      <Input
        label="Agent or client identifier"
        name="agent"
        defaultValue={selected?.agent ?? ""}
        maxLength={120}
        required
      />
      <Input
        label="Session type (optional)"
        name="sessionType"
        defaultValue={selected?.sessionType ?? ""}
        maxLength={120}
        hint="Leave empty to match all session types for this agent."
      />
    </>
  );
}

function KeywordFields({
  initial,
  pattern,
}: {
  initial: CaptureRuleInput;
  pattern: string;
}) {
  const selected = initial.kind === "keyword" ? initial : undefined;
  return (
    <>
      <Input
        label="Keyword or regular expression"
        name="pattern"
        defaultValue={pattern}
        maxLength={256}
        required
      />
      <Switch
        label="Use a regular expression"
        name="regex"
        defaultChecked={selected?.regex ?? false}
      />
      <Switch
        label="Match case"
        name="caseSensitive"
        defaultChecked={selected?.caseSensitive ?? false}
      />
    </>
  );
}

export function DescribeRule({
  isAdmin,
  onSaved,
  onCancel,
}: {
  isAdmin: boolean;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [proposal, setProposal] = useState<Proposal>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await requestJson<Proposal>(`${endpoint}/propose`, {
        text: answer.trim() ? `${text}\nClarification: ${answer.trim()}` : text,
      });
      if (answer.trim()) setText(`${text}\nClarification: ${answer.trim()}`);
      setProposal(result);
      setAnswer("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  const allowed =
    proposal?.rule && (proposal.rule.scope === "member" || isAdmin);
  return (
    <div className="stack">
      <form className="stack" onSubmit={propose}>
        <label className="hm-field-label" htmlFor="capture-description">
          What should your agents avoid saving?
        </label>
        <textarea
          id="capture-description"
          className="capture-textarea"
          value={text}
          required
          maxLength={4000}
          onChange={(event) => {
            setText(event.target.value);
            setProposal(undefined);
          }}
        />
        <p className="small">
          For example: exclude captures from repos outside my work organisation.
        </p>
        {proposal?.question ? (
          <Input
            label="Your answer (optional)"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            maxLength={1000}
          />
        ) : null}
        <Button type="submit" loading={pending} disabled={!text.trim()}>
          {proposal ? "Update proposal" : "Propose rule"}
        </Button>
      </form>
      {error ? <ErrorPanel message={error} /> : null}
      {proposal ? (
        <section className="stack capture-proposal" aria-label="Rule proposal">
          <h3>Review the proposal</h3>
          <p>{proposal.restatement}</p>
          <p>
            {proposal.question ??
              "Does this match what you want to exclude or keep private?"}
          </p>
          <p className="small">
            Check the fields below. The rule is saved only when you confirm.
          </p>
          {allowed && proposal.rule ? (
            <RuleForm
              key={JSON.stringify(proposal.rule)}
              initial={proposal.rule}
              naturalText={text}
              onSaved={onSaved}
              onCancel={onCancel}
              confirm
            />
          ) : (
            <p>
              {proposal.rule
                ? "Only a team admin can save a team rule. Ask for a rule for your own captures."
                : "Answer the question and update the proposal before saving."}
            </p>
          )}
        </section>
      ) : (
        <Button variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

export function ApplyRule({
  rule,
  onApplied,
  onCancel,
}: {
  rule: CaptureRule;
  onApplied: (result: { applied: number }, preview: Preview) => Promise<void>;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<Preview>();
  const [cursor, setCursor] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  async function loadPreview(nextCursor?: string) {
    const result = await requestJson<Preview>(
      `${endpoint}/${encodeURIComponent(rule.id)}/preview`,
      { cursor: nextCursor },
    );
    setCursor(nextCursor);
    setPreview(result);
    setConfirmed(false);
  }
  async function act() {
    setPending(true);
    setError("");
    try {
      if (!preview) await loadPreview(cursor);
      else if (preview.count === 0 && preview.nextCursor)
        await loadPreview(preview.nextCursor);
      else if (confirmed) {
        const result = await requestJson<{
          applied: number;
          nextCursor: string | null;
        }>(`${endpoint}/${encodeURIComponent(rule.id)}/apply`, {
          token: preview.token,
          confirmed: true,
        });
        setSummary(
          `${result.applied} cells ${outcomes[rule.action].past} from the ${preview.scanned} cells checked.`,
        );
        setCursor(result.nextCursor ?? undefined);
        setPreview(undefined);
        setConfirmed(false);
        await onApplied(result, preview);
      }
    } catch (caught) {
      setError(errorMessage(caught));
      setPreview(undefined);
      setConfirmed(false);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack">
      <h3>{rule.name}</h3>
      <p>{outcomes[rule.action].description}</p>
      {summary ? <p role="status">{summary}</p> : null}
      {preview ? (
        <PreviewConfirmation
          preview={preview}
          action={rule.action}
          confirmed={confirmed}
          pending={pending}
          onConfirm={setConfirmed}
        />
      ) : (
        <p>
          Preview checks up to 500 current cells{" "}
          {rule.scope === "member" ? "that you saved" : "in the team"}.
        </p>
      )}
      {error ? <ErrorPanel message={error} /> : null}
      <ApplyControls
        preview={preview}
        cursor={cursor}
        pending={pending}
        confirmed={confirmed}
        onApply={() => void act()}
        onClose={onCancel}
      />
    </div>
  );
}

function PreviewConfirmation({
  preview,
  action,
  confirmed,
  pending,
  onConfirm,
}: {
  preview: Preview;
  action: CaptureRuleInput["action"];
  confirmed: boolean;
  pending: boolean;
  onConfirm: (value: boolean) => void;
}) {
  return (
    <>
      <p>
        <strong>{preview.count} matching cells</strong> in {preview.scanned}{" "}
        cells checked.
      </p>
      {preview.truncated ? (
        <p className="cell-warning">
          This preview checks at most 500 cells. More cells remain outside this
          batch.
        </p>
      ) : null}
      <p className="small">
        Preview expires at {formatHumanDateTime(preview.expiresAt)}.
      </p>
      {preview.count > 0 ? (
        <Switch
          label={`I confirm the ${outcomes[action].confirm} of ${preview.count} matching cells`}
          checked={confirmed}
          disabled={pending}
          onChange={onConfirm}
        />
      ) : (
        <p>No cells match in this batch.</p>
      )}
    </>
  );
}

function ApplyControls({
  preview,
  cursor,
  pending,
  confirmed,
  onApply,
  onClose,
}: {
  preview?: Preview;
  cursor?: string;
  pending: boolean;
  confirmed: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const nextEmptyBatch = Boolean(
    preview && preview.count === 0 && preview.nextCursor,
  );
  const nextBatch = nextEmptyBatch || (!preview && Boolean(cursor));
  const label = nextBatch
    ? "Preview next batch"
    : preview
      ? "Confirm and apply"
      : "Preview matching cells";
  return (
    <div className="row wrap">
      <Button
        variant={preview && !nextEmptyBatch ? "danger" : "secondary"}
        onClick={onApply}
        loading={pending}
        disabled={Boolean(
          preview && !nextEmptyBatch && (!confirmed || preview.count === 0),
        )}
      >
        {label}
      </Button>
      <Button variant="ghost" disabled={pending} onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

export function ApplicationHistory({
  applications,
  rules,
  isAdmin = false,
  onReversed,
}: {
  applications: Application[];
  rules: CaptureRule[];
  isAdmin?: boolean;
  onReversed?: () => Promise<void>;
}) {
  const [reversing, setReversing] = useState<Application>();
  return (
    <section className="stack" aria-label="Applied history">
      <h2>Applied history</h2>
      {applications.length ? (
        <ul className="capture-history">
          {applications.map((entry) => (
            <li key={entry.id}>
              <strong>
                {entry.ruleName ??
                  rules.find((rule) => rule.id === entry.ruleId)?.name ??
                  "Deleted rule"}
              </strong>
              <p>
                <a href={`/app/cells/${encodeURIComponent(entry.learningId)}`}>
                  {entry.title ?? "Open cell"}
                </a>{" "}
                · {relativeTime(entry.createdAt)} ·{" "}
                {entry.reversedAt ? "Reversed" : "Applied"}
              </p>
              {entry.reversalReason ? (
                <p className="small">Reason: {entry.reversalReason}</p>
              ) : null}
              {isAdmin && !entry.reversedAt ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setReversing(entry)}
                >
                  Reverse application
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <p>You have not applied any rules to existing cells yet.</p>
        </Card>
      )}
      {reversing ? (
        <Dialog
          title="Reverse rule application"
          onClose={() => setReversing(undefined)}
        >
          <ReverseApplication
            application={reversing}
            onCancel={() => setReversing(undefined)}
            onReversed={async () => {
              setReversing(undefined);
              await onReversed?.();
            }}
          />
        </Dialog>
      ) : null}
    </section>
  );
}

export function ReverseApplication({
  application,
  onReversed,
  onCancel,
}: {
  application: Application;
  onReversed: () => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) return;
    setError("");
    setPending(true);
    try {
      await requestJson(
        `${endpoint}/history/${encodeURIComponent(application.id)}/reverse`,
        { reason: reason.trim(), confirmed: true },
      );
      await onReversed();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <p>
        Restore this cell to its state before the rule was applied. Hive keeps
        the reversal and your reason in the history.
      </p>
      <p className="breakable">{application.title ?? "Selected cell"}</p>
      <Input
        label="Reason for reversing"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        required
        maxLength={1000}
      />
      {error ? <ErrorPanel message={error} /> : null}
      <div className="row wrap">
        <Button type="submit" loading={pending} disabled={!reason.trim()}>
          Confirm reversal
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
