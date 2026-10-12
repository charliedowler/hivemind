"use client";

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
import { Markdown } from "./markdown";

export function LearningDetail({
  learning,
  onFeedback,
}: {
  learning: LearningView;
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
      <div className="row wrap">
        <Badge tone={learningStatus({ ...learning, votes })}>
          {learningStatus({ ...learning, votes })}
        </Badge>
        <Badge>{learning.kind}</Badge>
        <span className="small">
          Seen {learning.pushCount}{" "}
          {learning.pushCount === 1 ? "time" : "times"}
        </span>
      </div>
      <div className="row wrap">
        <MemberBee
          name={learnedBy(learning)}
          agent={agentKind(learning.source)}
          detail={relativeTime(learning.lastPushedAt)}
        />
        <code className="repo">{learning.repo ?? "Across the hive"}</code>
      </div>
      {votes.outdated > votes.up ? (
        <p className="cell-warning">
          This cell needs a fresh source. Check the learning before you cite it.
        </p>
      ) : null}
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
      <div className="detail-footer">
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
              variant={feedback?.vote === item.id ? "primary" : "secondary"}
              size="sm"
              disabled={pending}
              aria-pressed={feedback?.vote === item.id}
              onClick={() => void vote(item.id)}
              aria-label={`${item.label}, ${votes[item.id]} votes`}
            >
              {item.label} {votes[item.id]}
            </Button>
          ))}
        </div>
        <div className="row wrap">
          <code className="small breakable">{learning.id}</code>
          <CopyButton text={learning.id} label="Copy id" />
        </div>
      </div>
      {error ? <ErrorPanel message={error} /> : null}
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
    learning?: LearningView;
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
      title={result.learning?.title ?? "From the hive"}
      eyebrow="Inside the cell"
      width={760}
      onClose={onClose}
    >
      {result.error ? (
        <ErrorPanel message={result.error} />
      ) : result.learning ? (
        <LearningDetail learning={result.learning} onFeedback={onFeedback} />
      ) : (
        <LoadingPanel>A forager is finding this cell.</LoadingPanel>
      )}
    </Dialog>
  );
}
