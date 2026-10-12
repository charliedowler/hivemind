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
          <h2>Ask the hive</h2>
          <p className="muted">
            Ask a question. The answer cites the cells it uses.
          </p>
        </div>
        <AskBox
          value={question}
          onChange={setQuestion}
          state={pending ? "flying" : current ? "returned" : "idle"}
          onAsk={ask}
          placeholder="What should I check when CI is green?"
          statusText={{
            idle: "Enter a question to ask the hive",
            flying: `Searching the hive for an answer`,
            returned: `${current?.result.citations.length ?? 0} cells cited.`,
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
      eyebrow={current.result.synthesized ? "Answer" : "Matching cells"}
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
            These cells have not been combined into an answer.
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
            "The answer reports no gaps. Check the cited cells for context."}
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
        {pending ? "Searching for an answer." : "Ask your first question"}
      </h3>
      <p className="muted">
        {pending
          ? "The hive is looking for cells relevant to your question."
          : "Describe what you need help with. The hive answers from saved learnings."}
      </p>
    </Card>
  );
}
