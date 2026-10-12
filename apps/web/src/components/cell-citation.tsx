"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client";

export function CellCitation({
  id,
  title,
  onOpen,
}: {
  id: string;
  title?: string;
  onOpen?: (id: string) => void;
}) {
  const [resolved, setResolved] = useState<{ id: string; title: string }>();
  useEffect(() => {
    if (title) return;
    const controller = new AbortController();
    void requestJson<{ title: string }>(
      `/api/app/learnings/${encodeURIComponent(id)}`,
      undefined,
      controller.signal,
    )
      .then((cell) => {
        if (!controller.signal.aborted) setResolved({ id, title: cell.title });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [id, title]);
  const label = title || (resolved?.id === id ? resolved.title : "Open cell");
  return (
    <a
      className="cell-citation"
      href={`/app/cells/${encodeURIComponent(id)}`}
      title={`${label} (${id})`}
      onClick={
        onOpen
          ? (event) => {
              if (
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                onOpen(id);
              }
            }
          : undefined
      }
    >
      {label}
    </a>
  );
}
