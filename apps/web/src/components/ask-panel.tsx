"use client";

import { useState } from "react";
import type { AskResult, LearningView } from "@hivemind/core";
import {
  AnswerCard,
  AskBox,
  Badge,
  Button,
  Card,
  Sprite,
} from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
import { learnedBy, learningStatus } from "@/lib/learning-presentation";
import { Markdown } from "./markdown";
import { ErrorPanel } from "./primitives";
import { LearningDialog } from "./learning-dialog";

type Question = {
  question: string;
  result: AskResult;
  citedLearnings: LearningView[];
};

export function AskPanel({
  repo,
  learnings = [],
}: {
  repo?: string;
  learnings?: LearningView[];
}) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<Question[]>([]);
  const [current, setCurrent] = useState<Question>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [citation, setCitation] = useState<string>();
  async function ask(asked: string) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await requestJson<AskResult>("/api/app/ask", {
        question: asked,
        repo,
      });
      const knownIds = new Set(learnings.map((learning) => learning.id));
      const citedLearnings = await Promise.all(
        result.citations
          .filter((source) => !knownIds.has(source.id))
          .map((source) =>
            requestJson<LearningView>(
              `/api/app/learnings/${encodeURIComponent(source.id)}`,
            ).catch(() => undefined),
          ),
      );
      const entry = {
        question: asked,
        result,
        citedLearnings: citedLearnings.filter(
          (learning): learning is LearningView => learning !== undefined,
        ),
      };
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
    <section className="ask-section" aria-label="Ask the hive">
      <div className="stack">
        <div>
          <span className="eyebrow">Start with what the hive knows</span>
          <h2>Ask once. Cite the cells.</h2>
          <p className="muted">
            Join your team's learnings into an answer with sources.
          </p>
        </div>
        <AskBox
          value={question}
          onChange={setQuestion}
          state={pending ? "flying" : current ? "returned" : "idle"}
          onAsk={ask}
          placeholder="What should I check when CI is green?"
          statusText={{
            flying: `Out looking through ${learnings.length} cells`,
            returned: `Back with a jar. ${current?.result.citations.length ?? 0} cells cited.`,
          }}
        />
        <span className="small muted">Ctrl or Cmd + Enter to ask</span>
        {error ? <ErrorPanel message={error} /> : null}
        {history.length ? (
          <div className="stack">
            <span className="eyebrow">Recent asks</span>
            <div className="history">
              {history.map((entry) => (
                <Button
                  key={entry.question}
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setCurrent(entry);
                    setQuestion(entry.question);
                  }}
                >
                  {entry.question}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <HiveAnswer
        current={current}
        pending={pending}
        learnings={learnings}
        onCitation={setCitation}
      />
      {citation ? (
        <LearningDialog
          key={citation}
          id={citation}
          onClose={() => setCitation(undefined)}
        />
      ) : null}
    </section>
  );
}

function HiveAnswer({
  current,
  pending,
  learnings,
  onCitation,
}: {
  current?: Question;
  pending: boolean;
  learnings: LearningView[];
  onCitation: (id: string) => void;
}) {
  if (!current || pending) return <WaitingAnswer pending={pending} />;
  const sources = new Map(
    [...learnings, ...current.citedLearnings].map((learning) => [
      learning.id,
      learning,
    ]),
  );
  return (
    <AnswerCard
      question={current.question}
      eyebrow={current.result.synthesized ? "The hive knows" : "From the cells"}
      citations={current.result.citations.map((source) => {
        const learning = sources.get(source.id);
        return {
          id: source.id,
          title: source.title,
          learnedBy: learning ? learnedBy(learning) : source.why,
          repo: learning?.repo ?? undefined,
          outdated: learning ? learningStatus(learning) === "outdated" : false,
          onClick: () => onCitation(source.id),
        };
      })}
    >
      <div className="row wrap answer-confidence">
        <Badge
          tone={current.result.confidence === "high" ? "confirmed" : "fresh"}
        >
          {current.result.confidence} confidence
        </Badge>
        {!current.result.synthesized ? (
          <span className="small muted">
            Collected cells. No synthesis yet.
          </span>
        ) : null}
      </div>
      <Markdown
        text={current.result.answer}
        onCitation={onCitation}
        citations={current.result.citations}
      />
      <div className="gaps">
        <h3>What the hive does not know yet</h3>
        <p>
          {current.result.gaps ??
            "No gaps were flagged in this answer. Check the cited cells for context."}
        </p>
      </div>
    </AnswerCard>
  );
}

function WaitingAnswer({ pending }: { pending: boolean }) {
  return (
    <Card className="answer-waiting" role={pending ? "status" : undefined}>
      <Sprite
        name={pending ? "bee-fly" : "jar"}
        scale={4}
        className={pending ? "hm-bob" : undefined}
      />
      <h3>
        {pending ? "A forager is out looking." : "An answer with a source."}
      </h3>
      <p className="muted">
        {pending
          ? "The hive is gathering the cells that answer your ask."
          : "Ask about a task, an error or a decision. Every answer cites the cells it came from."}
      </p>
    </Card>
  );
}
