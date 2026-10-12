"use client";
import { useState, type FormEvent } from "react";
import type { AskResult } from "@hivemind/core";
import { requestJson, errorMessage } from "@/lib/client";
import { Markdown } from "./markdown";
import { ErrorPanel } from "./primitives";
import { LearningDialog } from "./learning-dialog";

type Question = { question: string; result: AskResult };
export function AskPanel({ repo }: { repo?: string }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Question[]>([]);
  const [current, setCurrent] = useState<Question>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [citation, setCitation] = useState<string>();
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || pending) return;
    const asked = question.trim();
    setPending(true);
    setError("");
    try {
      const result = await requestJson<AskResult>("/api/app/ask", {
        question: asked,
        repo,
      });
      const entry = { question: asked, result };
      setCurrent(entry);
      setHistory((items) =>
        [entry, ...items.filter((item) => item.question !== asked)].slice(0, 5),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <aside className="ask-panel panel">
      <div className="row">
        <span className="hive-mark" aria-hidden="true" />
        <h2>Ask the hive</h2>
      </div>
      <p className="muted">Answers grounded in what your team has learned.</p>
      <form onSubmit={ask} className="stack">
        <label className="sr-only" htmlFor="ask-question">
          Your question
        </label>
        <textarea
          id="ask-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What should I check before trusting a green CI run?"
          rows={4}
          maxLength={2000}
          required
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="row between">
          <span className="small muted">⌘ / Ctrl + Enter</span>
          <button className="primary" disabled={pending || !question.trim()}>
            {pending ? "Thinking…" : "Ask"}
          </button>
        </div>
      </form>
      {pending && (
        <p role="status" className="thinking">
          The hive is thinking…
        </p>
      )}
      {error && <ErrorPanel message={error} />}
      {current && !pending && (
        <section className="answer">
          <h3>{current.question}</h3>
          <div className="row wrap small">
            <span
              className={`confidence confidence-${current.result.confidence}`}
            >
              {current.result.confidence} confidence
            </span>
            {!current.result.synthesized && (
              <span className="muted">Unsynthesized list</span>
            )}
          </div>
          <Markdown text={current.result.answer} onCitation={setCitation} />
          {current.result.gaps !== null && (
            <div className="gaps">
              <strong>What’s missing</strong>
              <p>{current.result.gaps}</p>
            </div>
          )}
          {current.result.citations.length > 0 && (
            <div className="sources">
              <h3>Sources</h3>
              {current.result.citations.map((source) => (
                <button key={source.id} onClick={() => setCitation(source.id)}>
                  <strong>{source.title}</strong>
                  <span>{source.why}</span>
                  <code>{source.id}</code>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {history.length > 0 && (
        <div className="question-history">
          <h3>Recent questions</h3>
          {history.map((entry) => (
            <button
              key={entry.question}
              onClick={() => {
                setCurrent(entry);
                setQuestion(entry.question);
              }}
              disabled={pending}
            >
              {entry.question}
            </button>
          ))}
        </div>
      )}
      {citation && (
        <LearningDialog
          key={citation}
          id={citation}
          onClose={() => setCitation(undefined)}
        />
      )}
    </aside>
  );
}
