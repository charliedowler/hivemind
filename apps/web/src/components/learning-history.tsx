"use client";
import { useState } from "react";
import type { LearningVersion } from "@hivemind/core";
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
    error?: string;
    pending?: boolean;
  }>({});
  async function load() {
    setState({ pending: true });
    try {
      setState(
        await requestJson<{ versions: LearningVersion[] }>(
          `/api/app/learnings/${encodeURIComponent(id)}/versions`,
        ),
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
          Show version history
        </Button>
      </div>
      {state.error ? <ErrorPanel message={state.error} /> : null}
      {state.versions?.map((version) => (
        <details className="version-entry" key={version.revision}>
          <summary>
            Version {version.revision} · {version.author} ·{" "}
            {new Date(version.createdAt).toLocaleDateString("en-GB", {
              timeZone: "UTC",
            })}
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
