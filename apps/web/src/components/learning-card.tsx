"use client";
import { useState } from "react";
import type { FeedbackResult, FeedbackVote, LearningView, SearchHit } from "@hivemind/core";
import { errorMessage, relativeTime, requestJson } from "@/lib/client";
import { Markdown } from "./markdown";
import { CopyButton } from "./primitives";

const sourceNames = { "claude-code": "Claude Code", codex: "Codex", manual: "Manual" };

export function LearningCard({ learning, highlighted = false, expanded = false, domId }: { learning: LearningView | SearchHit; highlighted?: boolean; expanded?: boolean; domId?: string }) {
  const [open, setOpen] = useState(expanded);
  const [feedback, setFeedback] = useState<{ votes: LearningView["votes"]; vote: FeedbackVote }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const votes = feedback?.votes ?? learning.votes;
  async function vote(value: FeedbackVote) {
    const previous = feedback;
    const next = { ...votes };
    if (feedback) next[feedback.vote] = Math.max(0, next[feedback.vote] - 1);
    next[value] += 1;
    setFeedback({ votes: next, vote: value }); setPending(true); setError("");
    try { const result = await requestJson<FeedbackResult>("/api/app/feedback", { id: learning.id, vote: value }); setFeedback({ votes: result.votes, vote: value }); }
    catch (error) { setFeedback(previous); setError(errorMessage(error)); }
    finally { setPending(false); }
  }
  return <article id={domId ?? learning.id} className={`learning-card ${highlighted ? "new-learning" : ""}`}><div className="row between wrap"><span className={`kind kind-${learning.kind}`}>{learning.kind}</span><span className="small muted">{sourceNames[learning.source]}{learning.pushCount > 1 && ` · seen ${learning.pushCount} times`}</span></div><h2>{learning.title}</h2><div className="learning-meta"><span>{learning.author.name}</span><time dateTime={learning.lastPushedAt}>{relativeTime(learning.lastPushedAt)}</time>{learning.repo && <span className="repo">{learning.repo}</span>}</div><div className={open ? "" : "collapsed-body"}><Markdown text={learning.body} /></div><button className="text-button small" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Show less" : "Show more"}</button>{learning.tags.length > 0 && <div className="tags">{learning.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>}{"signals" in learning && <div className="signals"><strong>Score {learning.score.toFixed(2)}</strong><span>Vector {learning.signals.vector?.toFixed(2) ?? "n/a"}</span><span>Text {learning.signals.fts.toFixed(2)}</span><span>Recency {learning.signals.recency.toFixed(2)}</span><span>Votes {learning.signals.votes.toFixed(2)}</span><span>Repo {learning.signals.repoMatch ? "match" : "no match"}</span></div>}<footer className="card-footer"><div className="votes">{([{ id: "up", label: "↑ Useful" }, { id: "down", label: "↓ Unhelpful" }, { id: "outdated", label: "◷ Outdated" }] as const).map(item => <button key={item.id} disabled={pending} aria-pressed={feedback?.vote === item.id} onClick={() => vote(item.id)} aria-label={`${item.label}, ${votes[item.id]} votes`}>{item.label} <span>{votes[item.id]}</span></button>)}</div><div className="row small"><code title={learning.id}>{learning.id.slice(0, 10)}</code><CopyButton text={learning.id} label="Copy ID" /></div></footer>{error && <p role="alert" className="field-error">{error}</p>}</article>;
}
