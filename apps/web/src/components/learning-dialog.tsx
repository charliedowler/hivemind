"use client";
import { useEffect, useRef, useState } from "react";
import type { LearningView } from "@hivemind/core";
import { errorMessage, requestJson } from "@/lib/client";
import { ErrorPanel } from "./primitives";
import { LearningCard } from "./learning-card";

export function LearningDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<{ learning?: LearningView; error?: string }>({});
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const controller = new AbortController();
    requestJson<LearningView>(`/api/app/learnings/${encodeURIComponent(id)}`, undefined, controller.signal).then(learning => setResult({ learning })).catch(error => { if (!controller.signal.aborted) setResult({ error: errorMessage(error) }); });
    return () => { controller.abort(); element?.close(); };
  }, [id]);
  return <dialog ref={dialog} className="learning-dialog" onCancel={onClose} aria-labelledby="learning-dialog-title"><div className="row between dialog-heading"><h2 id="learning-dialog-title">From the hive</h2><button className="secondary" onClick={onClose} autoFocus>Close</button></div>{result.error ? <ErrorPanel message={result.error} /> : result.learning ? <LearningCard learning={result.learning} expanded domId={`detail-${id}`} /> : <p role="status" className="panel muted">Loading learning…</p>}</dialog>;
}
