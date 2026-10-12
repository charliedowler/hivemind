"use client";
import { useEffect, useState } from "react";
import type { KnowledgeFile, KnowledgeListing } from "@hivemind/core";
import { Button, Card, Sprite } from "@hivemind/design-system";
import { errorMessage, requestJson } from "@/lib/client";
import { ErrorPanel, LoadingPanel } from "./primitives";

export function KnowledgeBrowser() {
  const [location, setLocation] = useState({ path: "", read: false });
  const [snapshot, setSnapshot] = useState<{
    url?: string;
    pending?: boolean;
    error?: string;
    expiresAt?: string;
  }>({});
  const segments = location.path.split("/").filter(Boolean);
  const parent = segments.slice(0, -1).join("/");
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
    <section className="stack dashboard" aria-label="Knowledge tree">
      <div className="page-heading">
        <div>
          <h1>Knowledge tree</h1>
          <p className="muted">
            Browse cells by repo, topic, person or friction. Ask your agent to
            save corrections.
          </p>
        </div>
        <Sprite name="cell-full" scale={3} />
      </div>
      <div className="row wrap">
        <Button
          variant="secondary"
          disabled={snapshot.pending}
          onClick={() => void download()}
        >
          {snapshot.pending ? "Preparing a snapshot" : "Prepare a snapshot"}
        </Button>
        {snapshot.url ? (
          <a
            className="text-button"
            href={snapshot.url}
            download="hive.tar.gz"
            referrerPolicy="no-referrer"
          >
            Download read-only archive
          </a>
        ) : null}
        {snapshot.expiresAt ? (
          <span className="small muted">
            Link expires at{" "}
            {new Date(snapshot.expiresAt).toLocaleTimeString("en-GB", {
              timeZone: "UTC",
            })}{" "}
            UTC
          </span>
        ) : null}
      </div>
      {snapshot.error ? <ErrorPanel message={snapshot.error} /> : null}
      <Card className="stack tree-card">
        <nav className="row wrap tree-breadcrumbs" aria-label="Knowledge path">
          <button
            type="button"
            className="text-button"
            onClick={() => setLocation({ path: "", read: false })}
          >
            The hive
          </button>
          {segments.map((part, index) => (
            <span
              className="breakable"
              key={segments.slice(0, index + 1).join("/")}
            >
              /{" "}
              {index === segments.length - 1 ? (
                part
              ) : (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setLocation({
                      path: segments.slice(0, index + 1).join("/"),
                      read: false,
                    })
                  }
                >
                  {part}
                </button>
              )}
            </span>
          ))}
        </nav>
        {location.path ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setLocation({ path: parent, read: false })}
          >
            Up one level
          </Button>
        ) : null}
        <TreeContent
          key={`${location.path}:${location.read}`}
          {...location}
          onNavigate={(path, read) => setLocation({ path, read })}
        />
      </Card>
    </section>
  );
}
function TreeContent({
  path,
  read,
  onNavigate,
}: {
  path: string;
  read: boolean;
  onNavigate: (path: string, read: boolean) => void;
}) {
  const [state, setState] = useState<{
    listing?: KnowledgeListing;
    file?: KnowledgeFile;
    error?: string;
  }>({});
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<KnowledgeListing | KnowledgeFile>(
      `/api/app/knowledge?path=${encodeURIComponent(path)}&read=${read}`,
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted)
          setState(
            "entries" in result ? { listing: result } : { file: result },
          );
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ error: errorMessage(error) });
      });
    return () => controller.abort();
  }, [path, read]);
  if (state.error) return <ErrorPanel message={state.error} />;
  if (state.file)
    return (
      <>
        <p className="small muted">
          Read-only · revision {state.file.revision}
        </p>
        <pre className="tree-file" tabIndex={0}>
          {state.file.content}
        </pre>
      </>
    );
  if (!state.listing)
    return (
      <LoadingPanel>Loading this folder.</LoadingPanel>
    );
  return (
    <>
      <p className="small muted">
        {state.listing.entries.length} entries · revision{" "}
        {state.listing.revision}
      </p>
      <ul className="tree-entries">
        {state.listing.entries.map((entry) => (
          <li key={entry.path}>
            <button
              type="button"
              onClick={() => onNavigate(entry.path, entry.type === "file")}
            >
              <Sprite
                name={entry.type === "directory" ? "cell-sealed" : "cell-full"}
                scale={1}
              />
              <span className="breakable">{entry.name}</span>
              <span className="small muted">
                {entry.type === "directory" ? "Folder" : "Markdown"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
