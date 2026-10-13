"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@hivemind/design-system";
import { errorMessage, relativeTime, requestJson } from "@/lib/client";
import type { JoinRequestView } from "@/server/identity/join-requests";
export function JoinRequests({ initial }: { initial: JoinRequestView[] }) {
  const router = useRouter();
  const [requests, setRequests] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function decide(id: string, decision: "approve" | "decline") {
    setPending(id);
    setError("");
    try {
      const result = await requestJson<{ requests: JoinRequestView[] }>(
        "/api/app/join-requests",
        { id, decision },
      );
      setRequests(result.requests);
      router.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="stack">
      {requests.length ? (
        requests.map((request) => (
          <Card key={request.id} className="row between wrap">
            <div>
              <p>{request.name}</p>
              <p className="small breakable">{request.email}</p>
              <p className="small muted">
                Asked {relativeTime(request.createdAt)}
              </p>
            </div>
            <div className="row wrap">
              <Button
                disabled={pending !== null}
                loading={pending === request.id}
                onClick={() => void decide(request.id, "approve")}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                disabled={pending !== null}
                onClick={() => void decide(request.id, "decline")}
              >
                Decline
              </Button>
            </div>
          </Card>
        ))
      ) : (
        <p className="muted">No pending requests.</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
