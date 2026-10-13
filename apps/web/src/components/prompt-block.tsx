"use client";

import { useState } from "react";
import { Button } from "@hivemind/design-system";
import styles from "./prompt-block.module.css";

export function PromptBlock({ text, recordCopy = false }: { text: string; recordCopy?: boolean }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
      if (recordCopy) void fetch("/api/analytics/prompt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: crypto.randomUUID() }), keepalive: true,
      }).catch(() => undefined);
    } catch { setStatus("Select the text to copy"); }
  }
  return <div className={styles.block}>
    <code className={styles.text}>{text}</code>
    <Button iconLeft={status === "Copied" ? "icon-check" : "icon-copy"} onClick={() => void copy()}>
      <span aria-live="polite">{status || "Copy"}</span>
    </Button>
  </div>;
}
