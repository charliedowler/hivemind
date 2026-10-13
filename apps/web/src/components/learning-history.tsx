"use client";
import { formatHumanDate } from "@hivemind/core";
import { useState } from "react";
import type { LearningVersion, FeedbackHistoryEntry } from "@hivemind/core";
import { Button } from "@hivemind/design-system";
import { errorMessage, requestJson } from "@/lib/client";
import { ErrorPanel } from "./primitives";
export function LearningHistory({
  id,
  revision,
}: {
  id: string;
  revision: number;
}) {
  const [state, setState] = useState<{
    versions?: LearningVersion[];
    feedback?: FeedbackHistoryEntry[];
    error?: string;
    pending?: boolean;
  }>({});
  async function load() {
    setState({ pending: true });
    try {
      setState(
        await requestJson<{
          versions: LearningVersion[];
          feedback: FeedbackHistoryEntry[];
        }>(`/api/app/learnings/${encodeURIComponent(id)}/versions`),
      );
    } catch (error) {
      setState({ error: errorMessage(error) });
    }
  }
  return (
    <section className="stack" aria-label="Version history">
      <div className="row wrap between">
        <span className="eyebrow">Version {revision}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={state.pending}
          onClick={() => void load()}
        >
          Show history
        </Button>
      </div>
      {state.error ? <ErrorPanel message={state.error} /> : null}
      {state.feedback?.length ? (
        <section className="stack" aria-label="Outcome history">
          <span className="eyebrow">Results from using this cell</span>
          {state.feedback.map((entry) => (
            <details className="version-entry" key={entry.receipt}>
              <summary>
                {entry.actor} ·{" "}
                {entry.action === "withdraw"
                  ? "Withdrew feedback"
                  : (entry.classification ??
                    (entry.vote
                      ? (
                          {
                            up: "Useful",
                            down: "Unhelpful",
                            outdated: "Outdated",
                          } as const
                        )[entry.vote]
                      : "Inconclusive"))}{" "}
                · {formatHumanDate(entry.createdAt)}
                {entry.current ? " · Current" : ""}
              </summary>
              {entry.outcome ? (
                <p className="small breakable">{entry.outcome}</p>
              ) : null}
              {entry.evidence ? (
                <pre tabIndex={0}>
                  {typeof entry.evidence === "string"
                    ? entry.evidence
                    : Object.values(entry.evidence)
                        .filter(Boolean)
                        .join("\n\n")}
                </pre>
              ) : null}
            </details>
          ))}
        </section>
      ) : null}
      {state.versions?.map((version) => (
        <details className="version-entry" key={version.revision}>
          <summary>
            Version {version.revision} · {version.author} ·{" "}
            {formatHumanDate(version.createdAt)}
          </summary>
          {Object.keys(version.diff).length ? (
            Object.entries(version.diff).map(([field, change]) => (
              <div className="stack version-change" key={field}>
                <strong>{field.replaceAll("_", " ")}</strong>
                <pre tabIndex={0}>
                  Before: {JSON.stringify(change.before, null, 2)}
                  {"\n"}After: {JSON.stringify(change.after, null, 2)}
                </pre>
              </div>
            ))
          ) : (
            <p className="small muted">First recorded version.</p>
          )}
        </details>
      ))}
    </section>
  );
}
