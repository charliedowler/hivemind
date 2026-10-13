"use client";
import { formatHumanDateTime } from "@hivemind/core";
import { useState } from "react";
import { Button } from "@hivemind/design-system";
import { errorMessage, requestJson } from "@/lib/client";
import { ErrorPanel } from "./primitives";

export function ExportArchive() {
  const [snapshot, setSnapshot] = useState<{
    url?: string;
    pending?: boolean;
    error?: string;
    expiresAt?: string;
  }>({});
  async function download() {
    setSnapshot({ pending: true });
    try {
      const result = await requestJson<{ url: string; expiresAt: string }>(
        "/api/app/knowledge",
        {},
      );
      setSnapshot(result);
    } catch (error) {
      setSnapshot({ error: errorMessage(error) });
    }
  }
  return (
    <section className="stack" aria-label="Export archive">
      <div className="row wrap">
        <Button
          variant="secondary"
          disabled={snapshot.pending}
          onClick={() => void download()}
        >
          {snapshot.pending ? "Preparing archive" : "Export archive"}
        </Button>
        {snapshot.url ? (
          <a
            className="text-button"
            href={snapshot.url}
            download="hive.tar.gz"
            referrerPolicy="no-referrer"
          >
            Download archive
          </a>
        ) : null}
        {snapshot.expiresAt ? (
          <span className="small muted">
            Link expires at {formatHumanDateTime(snapshot.expiresAt)}
          </span>
        ) : null}
      </div>
      {snapshot.error ? <ErrorPanel message={snapshot.error} /> : null}
    </section>
  );
}