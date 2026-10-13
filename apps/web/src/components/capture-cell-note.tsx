"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Switch } from "@hivemind/design-system";
import { errorMessage, requestJson } from "@/lib/client";
import { ErrorPanel } from "./primitives";

export function CaptureCellNote({
  id,
  flagged,
  redacted,
  canConfirm = false,
  keptAfterConfirmation = false,
}: {
  id: string;
  flagged: boolean;
  redacted: boolean;
  canConfirm?: boolean;
  keptAfterConfirmation?: boolean;
}) {
  const router = useRouter();
  const [shared, setShared] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function share() {
    if (!confirmed) return;
    setError("");
    setPending(true);
    try {
      await requestJson(
        `/api/app/capture-rules/flagged/${encodeURIComponent(id)}/confirm`,
        { confirmed: true },
      );
      setShared(true);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }
  if (!flagged && !redacted && !keptAfterConfirmation) return null;
  return (
    <section className="stack cell-warning" aria-label="What Hive keeps">
      {keptAfterConfirmation && !shared ? (
        <p>This cell is kept after owner confirmation.</p>
      ) : null}
      {redacted ? <p>Hive removed excluded content from this cell.</p> : null}
      {flagged && !shared ? (
        <>
          <p>Hive kept this cell private. Only you can read it.</p>
          {canConfirm ? (
            <>
              <Switch
                label="I confirm this cell is safe for the team to read"
                checked={confirmed}
                onChange={setConfirmed}
                disabled={pending}
              />
              <Button
                variant="secondary"
                onClick={() => void share()}
                disabled={!confirmed}
                loading={pending}
              >
                Confirm and share cell
              </Button>
            </>
          ) : null}
        </>
      ) : null}
      {shared ? <p role="status">Cell shared with the team.</p> : null}
      <Link href="/app/settings/capture">Review what Hive keeps</Link>
      {error ? <ErrorPanel message={error} /> : null}
    </section>
  );
}
