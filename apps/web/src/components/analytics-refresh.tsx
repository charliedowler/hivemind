"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@hivemind/design-system";

export function AnalyticsRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Refreshing tables" : "Refresh tables"}
    </Button>
  );
}
