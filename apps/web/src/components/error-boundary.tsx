"use client";

import { Button } from "@hivemind/design-system";
import { ErrorLink, ErrorShell } from "./error-shell";

export type ErrorBoundaryProps = { error: Error & { digest?: string }; reset: () => void };

export function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  return <ErrorShell code="500" title="Something went wrong on our side." actions={<><Button onClick={reset}>Try again</Button><ErrorLink href="/">Home</ErrorLink></>}>
    {error.digest ? <small className="error-reference">Reference: {error.digest}</small> : null}
  </ErrorShell>;
}
