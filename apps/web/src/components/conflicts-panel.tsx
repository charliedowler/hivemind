"use client";
import { useEffect, useState } from "react";
import type { LearningConflict } from "@hivemind/core";
import { Badge, Button, Card, Sprite } from "@hivemind/design-system";
import { errorMessage, requestJson } from "@/lib/client";
import { CellCitation } from "./cell-citation";
import { LearningDialog } from "./learning-dialog";
import { Markdown } from "./markdown";
import { ErrorPanel, LoadingPanel } from "./primitives";

export function ConflictsPanel() {
  const [history, setHistory] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string>();
  return (
    <section className="stack dashboard" aria-label="Conflicts">
      <div className="page-heading">
        <div>
          <h1>Conflicts</h1>
          <p className="muted">
            Compare both sources before replacing a learning.
          </p>
        </div>
        <Sprite name="cell-outdated" scale={3} />
      </div>
      <div className="row wrap">
        <Button
          variant={history ? "secondary" : "primary"}
          onClick={() => setHistory(false)}
        >
          Awaiting a decision
        </Button>
        <Button
          variant={history ? "primary" : "secondary"}
          onClick={() => setHistory(true)}
        >
          All decisions
        </Button>
        <Button
          variant="ghost"
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </Button>
      </div>
      <ConflictList
        key={`${history}:${refresh}`}
        history={history}
        onOpen={setSelected}
        onDecision={() => setRefresh((value) => value + 1)}
      />
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
function ConflictList({
  history,
  onOpen,
  onDecision,
}: {
  history: boolean;
  onOpen: (id: string) => void;
  onDecision: () => void;
}) {
  const [state, setState] = useState<{
    conflicts?: LearningConflict[];
    error?: string;
  }>({});
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<{ conflicts: LearningConflict[] }>(
      `/api/app/conflicts?history=${history}`,
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setState(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [history]);
  if (state.error) return <ErrorPanel message={state.error} />;
  if (!state.conflicts)
    return <LoadingPanel>Loading conflicts.</LoadingPanel>;
  return state.conflicts.length ? (
    <div className="stack">
      {state.conflicts.map((conflict) => (
        <ConflictCard
          key={conflict.id}
          conflict={conflict}
          onOpen={onOpen}
          onDecision={onDecision}
        />
      ))}
    </div>
  ) : (
    <Card className="stack">
      <Sprite name="cell-sealed" scale={3} />
      <h2>{history ? "No decisions yet." : "No conflicts waiting."}</h2>
      <p className="muted">
        When a new source changes an existing learning, both cells appear here
        for review.
      </p>
    </Card>
  );
}
export function ConflictCard({
  conflict,
  onOpen,
  onDecision,
}: {
  conflict: LearningConflict;
  onOpen: (id: string) => void;
  onDecision: () => void;
}) {
  return (
    <Card className="stack conflict-card">
      <div className="row wrap between">
        <div className="row wrap">
          <Badge
            tone={conflict.status === "accepted" ? "confirmed" : "outdated"}
          >
            {conflict.status === "candidate"
              ? "Needs a decision"
              : conflict.status}
          </Badge>
          <Badge>{conflict.relation}</Badge>
        </div>
        <span className="small muted">
          {new Date(conflict.createdAt).toLocaleDateString("en-GB", {
            timeZone: "UTC",
          })}
        </span>
      </div>
      <div className="conflict-pair">
        {[
          { label: "Earlier cell", cell: conflict.older },
          { label: "Proposed replacement", cell: conflict.newer },
        ].map(({ label, cell }) => (
          <div className="stack conflict-source" key={label}>
            <span className="eyebrow">{label}</span>
            <CellCitation id={cell.id} title={cell.title} onOpen={onOpen} />
            <span className="small muted">
              {cell.author} · version {cell.revision}
            </span>
            <div className="conflict-excerpt">
              <Markdown text={cell.body} />
            </div>
          </div>
        ))}
      </div>
      <p className="small muted">
        {conflict.reason}
        {conflict.status === "candidate"
          ? ` · ${Math.round(conflict.confidence * 100)}% comparison confidence`
          : ""}
      </p>
      {conflict.status === "candidate" ? (
        <ConflictDecision conflict={conflict} onDecision={onDecision} />
      ) : null}
    </Card>
  );
}

function decisionExplanation(conflict: LearningConflict) {
  if (conflict.stale)
    return "A source changed after this comparison. Review the current cells before making a new proposal.";
  if (conflict.canAdmin)
    return "As a team admin, your confirmation replaces the earlier cell.";
  return `${conflict.votes} of 2 member confirmations. A team admin can also decide.`;
}
function ConflictDecision({
  conflict,
  onDecision,
}: {
  conflict: LearningConflict;
  onDecision: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function decide(action: "confirm" | "reject") {
    setPending(true);
    setError("");
    try {
      await requestJson("/api/app/conflicts", { id: conflict.id, action });
      onDecision();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  const alreadyVoted = conflict.voted && !conflict.canAdmin;
  return (
    <>
      <p className="small">{decisionExplanation(conflict)}</p>
      <div className="row wrap">
        <Button
          disabled={pending || conflict.stale || alreadyVoted}
          onClick={() => void decide("confirm")}
        >
          {alreadyVoted
            ? "Your confirmation is recorded"
            : "Confirm replacement"}
        </Button>
        {conflict.canAdmin ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => void decide("reject")}
          >
            Keep both cells
          </Button>
        ) : null}
      </div>
      {error ? <ErrorPanel message={error} /> : null}
    </>
  );
}
