"use client";

import { useState } from "react";
import { Button, Card, Sprite, Toast } from "@hivemind/design-system";

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
    } catch {
      setStatus("Select the text to copy");
    }
  }
  return (
    <Button
      variant="secondary"
      size="sm"
      iconLeft={status === "Copied" ? "icon-check" : "icon-copy"}
      onClick={copy}
      aria-label={label}
    >
      <span aria-live="polite">{status || label}</span>
    </Button>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <Toast
      tone="error"
      title="The hive could not finish that."
      description={`${message} Try again.`}
      className="error-panel"
    />
  );
}

export function LoadingPanel({
  children = "A forager is out looking.",
}: {
  children?: string;
}) {
  return (
    <Card className="loading-panel" role="status">
      <Sprite name="bee-fly" scale={3} className="hm-bob" />
      <span>{children}</span>
    </Card>
  );
}
