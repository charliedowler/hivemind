"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(text); setStatus("Copied"); }
    catch { setStatus("Could not copy. Select the text."); }
  }
  return <button className="copy-button" type="button" onClick={copy} aria-label={label}><span aria-live="polite">{status || label}</span></button>;
}

export function ErrorPanel({ message }: { message: string }) {
  return <div role="alert" className="error-panel"><strong>Could not complete this request.</strong><p>{message}</p></div>;
}
