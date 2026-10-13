"use client";
import { formatHumanDateTime } from "@hivemind/core";
import { useEffect, useState } from "react";
import type { ConflictDecisionRecord } from "@hivemind/core";
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  Sprite,
} from "@hivemind/design-system";
import { errorMessage, requestJson } from "@/lib/client";
import { CellCitation } from "./cell-citation";
import { LearningDialog } from "./learning-dialog";
import { ErrorPanel, LoadingPanel } from "./primitives";

const decisionLabels = {
  supersede: "Newer replaces older",
  keep_both: "Keep both cells",
  keep_old: "Merge into older",
  mark_outdated: "Verify both cells",
  retract_new: "Retract newer",
  undecided: "Retry automatically",
  reversed: "Decision reversed",
};
export function ConflictsPanel() {
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [state, setState] = useState<{
    decisions?: ConflictDecisionRecord[];
    repos?: string[];
    error?: string;
  }>({});
  const [decision, setDecision] = useState("");
  const [repo, setRepo] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (decision) query.set("decision", decision);
    if (repo) query.set("repo", repo);
    if (search) query.set("search", search);
    const timer = setTimeout(() => {
      void requestJson<{
        decisions: ConflictDecisionRecord[];
        repos: string[];
      }>(`/api/app/conflicts?${query}`, undefined, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setState(data);
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({ error: errorMessage(error) });
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [refresh, decision, repo, search]);
  const decisions = state.decisions;
  const repos = state.repos ?? [];
  return (
    <section className="stack dashboard" aria-label="Decisions">
      <div className="page-heading">
        <div>
          <h1>Decisions</h1>
          <p className="muted">
            Hive compares the evidence and decides how each learning fits.
          </p>
        </div>
        <Sprite name="cell-sealed" scale={3} />
      </div>
      <div className="decision-filters">
        <Select
          label="Decision"
          value={decision}
          onChange={(event) => setDecision(event.target.value)}
          options={[
            { value: "", label: "All decisions" },
            ...Object.entries(decisionLabels).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <Select
          label="Repo"
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
          options={[
            { value: "", label: "All repos" },
            ...repos.map((value) => ({ value, label: value })),
          ]}
        />
        <Input
          label="Search"
          type="search"
          value={search}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a cell or reason"
        />
        <Button
          variant="ghost"
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </Button>
      </div>
      {state.error ? (
        <ErrorPanel message={state.error} />
      ) : !decisions ? (
        <LoadingPanel>Loading decisions.</LoadingPanel>
      ) : decisions.length ? (
        <div className="stack">
          {decisions.map((record) => (
            <DecisionCard
              key={record.id}
              record={record}
              onOpen={setSelected}
              onDecision={(updated) =>
                setState((current) => ({
                  ...current,
                  decisions: current.decisions?.map((row) =>
                    row.id === record.id ? updated : row,
                  ),
                }))
              }
            />
          ))}
        </div>
      ) : (
        <Card>
          <p>
            {state.decisions?.length
              ? "No decisions match these filters."
              : "Hive makes decisions automatically and records them here."}
          </p>
        </Card>
      )}
      {selected ? (
        <LearningDialog
          key={selected}
          id={selected}
          onClose={() => setSelected(undefined)}
        />
      ) : null}
    </section>
  );
}
export function DecisionCard({
  record,
  onOpen,
  onDecision,
}: {
  record: ConflictDecisionRecord;
  onOpen: (id: string) => void;
  onDecision: (record: ConflictDecisionRecord) => void;
}) {
  return (
    <Card id={record.id} className="stack conflict-card">
      <div className="row wrap between">
        <Badge
          tone={record.decision === "undecided" ? "outdated" : "confirmed"}
        >
          {decisionLabels[record.decision]}
        </Badge>
        <time className="small muted" dateTime={record.createdAt}>
          {formatHumanDateTime(record.createdAt)}
        </time>
      </div>
      <div className="conflict-pair">
        {[
          { label: "Earlier cell", cell: record.older },
          { label: "Newer cell", cell: record.newer },
        ].map(({ label, cell }) => (
          <div className="stack conflict-source" key={cell.id}>
            <span className="eyebrow">{label}</span>
            <CellCitation id={cell.id} title={cell.title} onOpen={onOpen} />
          </div>
        ))}
      </div>
      <p>{record.reason}</p>
      <p className="small muted">
        {Math.round(record.confidence * 100)}% confidence · {record.model} ·{" "}
        {record.latencyMs} ms
      </p>
      <p className="small muted">
        {record.model === "admin" ? "Decision by" : "Newer cell pushed by"}{" "}
        {record.author}
        {record.repo ? ` · ${record.repo}` : ""}
      </p>
      {record.jev ? (
        <details>
          <summary>Jev probabilities</summary>
          <div className="stack small">
            {Object.entries(record.jev).map(([question, answer]) => (
              <div key={question}>
                <strong>
                  {question.replace(/([A-Z])/g, " $1").toLowerCase()}
                </strong>
                {answer.type !== "noul" ? (
                  <p>
                    {Object.entries(answer.probabilities)
                      .map(
                        ([option, probability]) =>
                          `${answer.type === "score" ? (answer.legend[option] ?? option) : option.replaceAll("_", " ")}: ${Math.round(probability * 100)}%`,
                      )
                      .join(" · ")}
                  </p>
                ) : (
                  <p>{Math.round(answer.noul * 100)}%</p>
                )}
              </div>
            ))}
          </div>
        </details>
      ) : (
        <p className="small muted">
          Jev probabilities are unavailable for this attempt.
        </p>
      )}
      {record.canReverse || record.canEditReason ? (
        <ReverseDecision record={record} onDecision={onDecision} />
      ) : record.model === "legacy" ? (
        <p className="small muted">
          This decision has no reversible cell snapshots.
        </p>
      ) : null}
    </Card>
  );
}
function ReverseDecision({
  record,
  onDecision,
}: {
  record: ConflictDecisionRecord;
  onDecision: (record: ConflictDecisionRecord) => void;
}) {
  const [reason, setReason] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function act(action: "reverse" | "reason") {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await requestJson<{ record: ConflictDecisionRecord }>(
        "/api/app/conflicts",
        {
          id: record.id,
          action,
          ...(action === "reason" ? { reason: reason ?? record.reason } : {}),
        },
      );
      onDecision(result.record);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack decision-reversal" aria-live="polite">
      {record.canReverse ? (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => void act("reverse")}
        >
          {record.decision === "reversed" ? "Undo" : "Reverse this decision"}
        </Button>
      ) : null}
      {record.canEditReason ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void act("reason");
          }}
        >
          <Input
            label="Reason for reversal (optional)"
            value={reason ?? record.reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            type="submit"
            variant="ghost"
            disabled={
              pending || reason === undefined || reason === record.reason
            }
          >
            Save reason
          </Button>
        </form>
      ) : null}
      {error ? <ErrorPanel message={error} /> : null}
    </div>
  );
}
