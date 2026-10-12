"use client";
import { AnalyticsBeacon } from "./analytics-beacon";

import { useEffect, useState } from "react";
import type {
  FeedbackResult,
  FeedbackVote,
  LearningView,
} from "@hivemind/core";
import { Badge, Button, Dialog, MemberBee, Tag } from "@hivemind/design-system";
import { errorMessage, relativeTime, requestJson } from "@/lib/client";
import {
  agentKind,
  learnedBy,
  learningStatus,
} from "@/lib/learning-presentation";
import { CopyButton, ErrorPanel, LoadingPanel } from "./primitives";
import { CellCitation } from "./cell-citation";
import { LearningHistory } from "./learning-history";
import { Markdown } from "./markdown";

export function LearningDetail({
  learning,
  onFeedback,
  canModerate,
  onModerated,
}: {
  learning: LearningView;
  canModerate?: boolean;
  onModerated?: () => void;
  onFeedback?: (id: string, votes: LearningView["votes"]) => void;
}) {
  const [feedback, setFeedback] = useState<{
    votes: LearningView["votes"];
    vote: FeedbackVote;
  }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const votes = feedback?.votes ?? learning.votes;
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
      <AnalyticsBeacon learningId={learning.id} />
      <div className="row wrap">
        <Badge tone={learningStatus({ ...learning, votes })}>
          {learning.lifecycle ?? learningStatus({ ...learning, votes })}
        </Badge>
        <Badge>{learning.kind}</Badge>
        {learning.pushCount > 1 ? (
          <span className="small">Seen {learning.pushCount} times</span>
        ) : null}
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
      <LifecycleNotice learning={learning} />
      <FrictionDetails learning={learning} />
      <Markdown text={learning.body} />
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
          {confirm ? "Confirm retraction" : "Retract cell"}
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
        · {learning.blocked ? "Blocked progress" : "Progress continued"}
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
          <strong>Superseded by</strong>
          <CellCitation id={learning.supersededBy} />
          <p className="small">
            This cell is historical. Use its replacement for current guidance.
          </p>
        </div>
      ) : null}
      {learning.lifecycle === "retracted" ? (
        <p className="cell-warning">
          This cell is retracted. Hive keeps it in the history and excludes it
          from current guidance.
        </p>
      ) : null}
      {learning.verifyBeforeUse ? (
        <p className="cell-warning">
          Verify before use. This learning passed its verification date{" "}
          {learning.verifyAfter?.slice(0, 10)}.
        </p>
      ) : learning.verifyAfter ? (
        <p className="small muted">
          Verify by {learning.verifyAfter.slice(0, 10)} · As of{" "}
          {learning.updatedAt.slice(0, 10)}
        </p>
      ) : null}
    </>
  );
}
