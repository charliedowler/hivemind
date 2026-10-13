"use client";
import { formatHumanDate } from "@hivemind/core";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  FeedbackResult,
  FeedbackVote,
  LearningStanding,
  LearningView,
} from "@hivemind/core";
import {
  Badge,
  Button,
  Dialog,
  Input,
  MemberBee,
  Tag,
} from "@hivemind/design-system";
import type { listDecisions } from "@/server/conflict-decisions";
import { errorMessage, relativeTime, requestJson } from "@/lib/client";
import {
  agentKind,
  learnedBy,
  learningStatus,
  kindLabel,
  cellStateLabel,
} from "@/lib/learning-presentation";
import { CopyButton, ErrorPanel, LoadingPanel } from "./primitives";
import { CellCitation } from "./cell-citation";
import { LearningHistory } from "./learning-history";
import { Markdown } from "./markdown";
import { CellSharing } from "./cell-sharing";
import { CaptureCellNote } from "./capture-cell-note";

export function LearningDetail({
  learning: initialLearning,
  onFeedback,
  canModerate,
  onModerated,
}: {
  learning: LearningStanding;
  canModerate?: boolean;
  onModerated?: () => void;
  onFeedback?: (id: string, votes: LearningView["votes"]) => void;
}) {
  const [refreshed, setRefreshed] = useState<LearningStanding>();
  const learning =
    refreshed?.id === initialLearning.id ? refreshed : initialLearning;
  const [feedback, setFeedback] = useState<{
    votes: LearningView["votes"];
    vote: FeedbackVote;
  }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const votes = feedback?.votes ?? learning.votes;
  async function refresh() {
    try {
      setRefreshed(
        await requestJson<LearningView>(
          `/api/app/learnings/${encodeURIComponent(learning.id)}`,
        ),
      );
    } catch {
      setError("Reversed. Reopen this cell to see its updated state.");
    }
  }
  async function vote(value: FeedbackVote) {
    setPending(true);
    setError("");
    try {
      const result = await requestJson<FeedbackResult>("/api/app/feedback", {
        id: learning.id,
        vote: value,
      });
      setFeedback({ votes: result.votes, vote: value });
      onFeedback?.(learning.id, result.votes);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack learning-detail">
      <div className="row wrap">
        {cellStateLabel({ ...learning, votes }) ? (
          <Badge tone={learningStatus({ ...learning, votes })}>
            {cellStateLabel({ ...learning, votes })}
          </Badge>
        ) : null}
        <Badge>{kindLabel(learning.kind)}</Badge>
      </div>
      <div className="row wrap">
        <MemberBee
          name={learnedBy(learning)}
          agent={agentKind(learning.source)}
          detail={relativeTime(learning.lastPushedAt)}
        />
        <code className="repo">{learning.repo ?? "Across the hive"}</code>
      </div>
      {learning.adminOutdated || votes.outdated > votes.up ? (
        <p className="cell-warning">
          This cell is marked outdated. Check the learning before you cite it.
        </p>
      ) : null}
      {learning.unhelpfulLabel ? <p className="cell-warning">{learning.unhelpfulLabel}</p> : null}
      <CaptureNotice learning={learning} />
      <LifecycleNotice learning={learning} />
      {!learning.id.startsWith("slk_") ? (
        <CellChanges key={learning.id} id={learning.id} onReversed={refresh} />
      ) : null}
      <FrictionDetails learning={learning} />
      <Markdown text={learning.body} />
      <CellMetadata learning={learning} />
      <CellSharing
        key={`sharing:${learning.id}`}
        id={learning.id}
        revision={learning.revision ?? 1}
      />
      <LearningFooter
        learning={learning}
        votes={votes}
        selectedVote={feedback?.vote}
        pending={pending}
        onVote={vote}
      />
      {learning.revision ? (
        <LearningHistory id={learning.id} revision={learning.revision} />
      ) : null}
      {canModerate &&
      !learning.id.startsWith("slk_") &&
      learning.lifecycle !== "superseded" ? (
        <Moderation id={learning.id} onDone={onModerated} />
      ) : null}
      {error ? <ErrorPanel message={error} /> : null}
    </div>
  );
}

function CellMetadata({ learning }: { learning: LearningView }) {
  return (
    <>
      {learning.tags.length ? (
        <div className="tags">
          {learning.tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      ) : null}
      {learning.paths.length ? (
        <div className="stack">
          <span className="eyebrow">Paths</span>
          {learning.paths.map((path) => (
            <code className="breakable small" key={path}>
              {path}
            </code>
          ))}
        </div>
      ) : null}
      {learning.permalink ? (
        <a href={learning.permalink} target="_blank" rel="noreferrer">
          Open the source message in Slack
        </a>
      ) : null}
    </>
  );
}

type CellDecision = Awaited<ReturnType<typeof listDecisions>>[number];

function CellChanges({
  id,
  onReversed,
}: {
  id: string;
  onReversed: () => Promise<void>;
}) {
  const [state, setState] = useState<{
    decisions?: CellDecision[];
    error?: string;
  }>({});
  const [history, setHistory] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<{ decisions: CellDecision[] }>(
      `/api/app/conflicts?cellId=${encodeURIComponent(id)}`,
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) setState(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [id]);
  if (state.error) return <ErrorPanel message={state.error} />;
  if (!state.decisions?.length) return null;
  const { latest, historical } = relatedChanges(id, state.decisions);
  function update(record: CellDecision) {
    setState((previous) => ({
      decisions: [
        record,
        ...(previous.decisions ?? []).filter((item) => item.id !== record.id),
      ],
    }));
  }
  return (
    <section className="stack" aria-label="Cell changes">
      {[...latest.values()]
        .filter(
          (record) =>
            record.decision !== "undecided" && record.decision !== "keep_both",
        )
        .map((record) => (
          <CellChange
            key={record.id}
            id={id}
            record={record}
            onChanged={update}
            onReversed={onReversed}
          />
        ))}
      {historical.length ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            aria-label={history ? "Hide cell history" : "Show cell history"}
            aria-expanded={history}
            onClick={() => setHistory((value) => !value)}
          >
            {history ? "Hide history" : "Show history"}
          </Button>
          {history ? (
            <div className="stack" aria-label="Historical cells">
              <p className="small muted">
                Includes replaced, outdated and removed cells.
              </p>
              {historical.map((cell) => (
                <p className="small" key={cell.id}>
                  <CellCitation id={cell.id} title={cell.title} /> ·{" "}
                  {cell.lifecycle === "superseded"
                    ? "Replaced"
                    : cell.lifecycle === "outdated"
                      ? "Outdated"
                      : "Removed"}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function relatedChanges(id: string, decisions: CellDecision[]) {
  const latest = new Map<string, CellDecision>();
  const related = new Map<string, CellDecision["older"]>();
  for (const record of decisions) {
    if (!latest.has(record.edgeId)) latest.set(record.edgeId, record);
    for (const cell of [record.older, record.newer]) {
      if (cell.id !== id && !related.has(cell.id)) related.set(cell.id, cell);
    }
  }
  const historical = [...related.values()].filter(
    (cell) =>
      cell.lifecycle &&
      ["superseded", "outdated", "retracted"].includes(cell.lifecycle),
  );
  return { latest, historical };
}

function ChangeText({
  id,
  record,
  citation,
}: {
  id: string;
  record: CellDecision;
  citation: ReactNode;
}) {
  const receiving =
    record.decision === "keep_old"
      ? record.older.id === id
      : record.newer.id === id;
  switch (record.decision) {
    case "supersede":
      return receiving ? (
        <>Hive replaced {citation} with this cell</>
      ) : (
        <>Hive replaced this cell with {citation}</>
      );
    case "keep_old":
      return receiving ? (
        <>Hive merged {citation} into this cell</>
      ) : (
        <>Hive merged this cell into {citation}</>
      );
    case "reversed":
      return (
        <>
          Reversed {relativeTime(record.createdAt)} · {citation}
        </>
      );
    case "mark_outdated":
      return <>Hive marked this cell and {citation} outdated</>;
    default:
      return receiving ? (
        <>Hive removed this cell after comparing it with {citation}</>
      ) : (
        <>Hive removed {citation} after comparing it with this cell</>
      );
  }
}

function ReversalNote({
  record,
  pending,
  onSave,
}: {
  record: CellDecision;
  pending: boolean;
  onSave: (note: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  if (record.decision !== "reversed" || !record.canEditReason) return null;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await onSave(note)) {
      setAdding(false);
      setSaved(true);
    }
  }
  if (saved)
    return (
      <p className="small muted" role="status">
        Note saved.
      </p>
    );
  if (!adding)
    return (
      <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
        Add a note
      </Button>
    );
  return (
    <form className="stack" onSubmit={(event) => void save(event)}>
      <Input
        id={`note-${record.id}`}
        label="Optional note"
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="row wrap">
        <Button type="submit" size="sm" disabled={pending || !note.trim()}>
          Save note
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => setAdding(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CellChange({
  id,
  record,
  onChanged,
  onReversed,
}: {
  id: string;
  record: CellDecision;
  onChanged: (record: CellDecision) => void;
  onReversed: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const other = record.older.id === id ? record.newer : record.older;
  const citation = <CellCitation id={other.id} title={other.title} />;
  async function act(action: "reverse" | "reason", note?: string) {
    setPending(true);
    setError("");
    try {
      const result = await requestJson<{ record: CellDecision }>(
        "/api/app/conflicts",
        {
          id: record.id,
          action,
          reason: action === "reverse" ? "Admin requested reversal" : note,
        },
      );
      onChanged(result.record);
      if (action === "reverse") await onReversed();
      return true;
    } catch (error) {
      setError(errorMessage(error));
      return false;
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack">
      <div className="row wrap">
        <p className="small breakable" role="status">
          <ChangeText id={id} record={record} citation={citation} />
          {record.decision !== "reversed" ? (
            <>
              {" "}
              ·{" "}
              <time dateTime={record.createdAt}>
                {relativeTime(record.createdAt)}
              </time>
            </>
          ) : null}
        </p>
        {record.canReverse && record.decision !== "reversed" ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => void act("reverse")}
          >
            Reverse
          </Button>
        ) : null}
      </div>
      <ReversalNote
        record={record}
        pending={pending}
        onSave={(note) => act("reason", note)}
      />
      {error ? <ErrorPanel message={error} /> : null}
    </div>
  );
}

function LearningFooter({
  learning,
  votes,
  selectedVote,
  pending,
  onVote,
}: {
  learning: LearningView;
  votes: LearningView["votes"];
  selectedVote?: FeedbackVote;
  pending: boolean;
  onVote: (vote: FeedbackVote) => Promise<void>;
}) {
  return (
    <div className="detail-footer">
      {learning.id.startsWith("slk_") ? (
        <p className="small">
          Indexed Slack evidence. Save the message as a learning to review it.
        </p>
      ) : (
        <div className="votes">
          {(
            [
              { id: "up", label: "Useful" },
              { id: "down", label: "Unhelpful" },
              { id: "outdated", label: "Outdated" },
            ] as const
          ).map((item) => (
            <Button
              key={item.id}
              variant={selectedVote === item.id ? "primary" : "secondary"}
              size="sm"
              disabled={pending}
              aria-pressed={selectedVote === item.id}
              onClick={() => void onVote(item.id)}
              aria-label={`${item.label}, ${votes[item.id]} votes`}
            >
              {item.label} {votes[item.id]}
            </Button>
          ))}
        </div>
      )}
      <div className="row wrap">
        <code className="small breakable">{learning.id}</code>
        <CopyButton text={learning.id} label="Copy id" />
      </div>
    </div>
  );
}

export function LearningDialog({
  id,
  onClose,
  onFeedback,
}: {
  id: string;
  onClose: () => void;
  onFeedback?: (id: string, votes: LearningView["votes"]) => void;
}) {
  const [result, setResult] = useState<{
    learning?: LearningView & { canModerate?: boolean };
    error?: string;
  }>({});
  useEffect(() => {
    const controller = new AbortController();
    requestJson<LearningView>(
      `/api/app/learnings/${encodeURIComponent(id)}`,
      undefined,
      controller.signal,
    )
      .then((learning) => setResult({ learning }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [id]);
  return (
    <Dialog
      title={result.learning?.title ?? "Loading cell"}
      width={760}
      onClose={onClose}
    >
      {result.error ? (
        <ErrorPanel message={result.error} />
      ) : result.learning ? (
        <LearningDetail
          learning={result.learning}
          onFeedback={onFeedback}
          canModerate={result.learning.canModerate}
          onModerated={onClose}
        />
      ) : (
        <LoadingPanel>Loading the learning.</LoadingPanel>
      )}
    </Dialog>
  );
}

function Moderation({ id, onDone }: { id: string; onDone?: () => void }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  async function act(action: "outdated" | "delete") {
    setPending(true);
    setError("");
    try {
      await requestJson("/api/app/admin", { action, id });
      onDone?.();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack">
      <span className="eyebrow">Team admin</span>
      <div className="row wrap">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => void act("outdated")}
        >
          Mark outdated
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => (confirm ? void act("delete") : setConfirm(true))}
        >
          {confirm ? "Confirm removal" : "Remove cell"}
        </Button>
        {confirm ? (
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
      {error ? <ErrorPanel message={error} /> : null}
    </div>
  );
}

function FrictionDetails({ learning }: { learning: LearningView }) {
  return learning.kind === "friction" ? (
    <div className="stack">
      <p>
        Area: {learning.area ?? "Unspecified"} ·{" "}
        {learning.cost == null
          ? "Minutes not measured"
          : `${learning.cost} minutes lost`}{" "}
        ·{" "}
        {learning.blocked == null
          ? "Blocking impact unknown"
          : learning.blocked
            ? "Blocked progress"
            : "Progress continued"}
      </p>
      {learning.workaround ? <p>Workaround: {learning.workaround}</p> : null}
    </div>
  ) : null;
}

function LifecycleNotice({ learning }: { learning: LearningView }) {
  return (
    <>
      {" "}
      {learning.supersededBy ? (
        <div className="cell-warning stack">
          <strong>Replaced by</strong>
          <CellCitation id={learning.supersededBy} />
          <p className="small">
            This cell is historical. Use its replacement for current guidance.
          </p>
        </div>
      ) : null}
      {learning.lifecycle === "retracted" ? (
        <p className="cell-warning">
          Hive removed this cell. It stays in the history and is excluded from
          current guidance.
        </p>
      ) : null}
      {learning.verifyBeforeUse ? (
        <p className="cell-warning">
          Check this is still true. This cell was due for a check{" "}
          {learning.verifyAfter ? formatHumanDate(learning.verifyAfter) : ""}.
        </p>
      ) : learning.verifyAfter ? (
        <p className="small muted">
          Check by {formatHumanDate(learning.verifyAfter)} · Updated{" "}
          {formatHumanDate(learning.updatedAt)}
        </p>
      ) : null}
    </>
  );
}

function CaptureNotice({ learning }: { learning: LearningView }) {
  const current =
    learning.lifecycle === undefined ||
    learning.lifecycle === "fresh" ||
    learning.lifecycle === "confirmed";
  const flagged = Boolean(learning.captureFlagged);
  const redacted = Boolean(learning.captureRedacted);
  const matched = Boolean(learning.captureRuleIds?.length);
  return (
    <CaptureCellNote
      key={learning.id}
      id={learning.id}
      flagged={flagged}
      redacted={redacted}
      canConfirm={learning.canConfirmCapture ?? (flagged && current)}
      keptAfterConfirmation={current && matched && !flagged && !redacted}
    />
  );
}
