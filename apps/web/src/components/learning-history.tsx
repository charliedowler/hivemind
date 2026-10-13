"use client";
import { formatHumanDate } from "@hivemind/core";
import { useState } from "react";
import type { LearningVersion, FeedbackHistoryEntry } from "@hivemind/core";
import { Button } from "@hivemind/design-system";
import { errorMessage, requestJson } from "@/lib/client";
import { kindLabel } from "@/lib/learning-presentation";
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
                <strong>{historyFieldLabel(field)}</strong>
                <pre tabIndex={0}>
                  Before: {historyValue(field, change.before)}
                  {"\n"}After: {historyValue(field, change.after)}
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

function historyFieldLabel(field: string) {
  return (
    (
      {
        lifecycle: "Cell state",
        kind: "Cell type",
        superseded_by: "Replaced by",
        retracted_at: "Removed at",
        capture_rule_ids: "What Hive keeps",
      } as Record<string, string>
    )[field] ?? field.replaceAll("_", " ")
  );
}

function historyValue(field: string, value: unknown) {
  if (field === "lifecycle" && typeof value === "string") {
    return (
      (
        {
          fresh: "Saved",
          confirmed: "Seen again",
          superseded: "Replaced",
          retracted: "Removed",
          outdated: "Outdated",
        } as Record<string, string>
      )[value] ?? "Saved"
    );
  }
  if (field === "kind" && typeof value === "string")
    return kindLabel(value as Parameters<typeof kindLabel>[0]);
  return JSON.stringify(value, null, 2);
}
