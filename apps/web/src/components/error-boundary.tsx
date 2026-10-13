"use client";

import { useMeasurementConsent } from "@/lib/measurement-consent";
import { useEffect, useRef } from "react";
import { Button } from "@hivemind/design-system";
import { ErrorLink, ErrorShell } from "./error-shell";

export type ErrorBoundaryProps = { error: Error & { digest?: string }; reset: () => void };

export function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  const allowed = useMeasurementConsent();
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!allowed) return;
    const route = window.location.pathname;
    const digest = error.digest ?? null;
    const payload = JSON.stringify({ route, digest });
    if (sent.current === payload) return;
    sent.current = payload;
    try { navigator.sendBeacon("/api/analytics/error", payload); } catch {}
  }, [allowed, error.digest]);
  return <ErrorShell code="500" title="Something went wrong on our side." actions={<><Button onClick={reset}>Try again</Button><ErrorLink href="/">Home</ErrorLink></>}>
    {error.digest ? <small className="error-reference">Reference: {error.digest}</small> : null}
  </ErrorShell>;
}
