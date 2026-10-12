"use client";
import { useEffect, useRef } from "react";

export function AnalyticsBeacon({
  page,
  learningId,
}: {
  page?: "landing" | "waitlist" | "install";
  learningId?: string;
}) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    const key = learningId ?? page;
    if (!key || sent.current === key) return;
    sent.current = key;
    navigator.sendBeacon(
      learningId ? "/api/app/analytics/view" : "/api/analytics/page",
      JSON.stringify(learningId ? { learningId } : { page }),
    );
  }, [page, learningId]);
  return null;
}
