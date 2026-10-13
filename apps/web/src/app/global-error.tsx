"use client";

import { ErrorBoundary, type ErrorBoundaryProps } from "@/components/error-boundary";
import "@hivemind/design-system/app.css";
import "./globals.css";
import { fontVariables } from "./fonts";

export default function GlobalError(props: ErrorBoundaryProps) {
  return <html lang="en"><head><title>Something went wrong · Hive</title></head><body className={fontVariables}><ErrorBoundary {...props} /></body></html>;
}
