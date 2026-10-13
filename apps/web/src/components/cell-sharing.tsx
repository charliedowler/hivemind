"use client";
import { useEffect, useState } from "react";
import { Button } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
type State = {
  owner: boolean;
  organisations: { teamId: string; teamName: string; shared: boolean }[];
};
export function CellSharing({
  id,
  revision,
}: {
  id: string;
  revision: number;
}) {
  const [state, setState] = useState<State>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<State>(
      `/api/app/learnings/${encodeURIComponent(id)}/sharing`,
      undefined,
      controller.signal,
    )
      .then(setState)
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [id]);
  async function act(teamId: string, shared: boolean) {
    setPending(true);
    setError("");
    try {
      setState(
        await requestJson(
          `/api/app/learnings/${encodeURIComponent(id)}/sharing`,
          { teamId, action: shared ? "withdraw" : "share", revision },
        ),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {state?.owner && state.organisations.length ? (
        <section className="stack" aria-label="Cell sharing">
          <h3>Shared with your team</h3>
          <p className="small muted">
            Your original stays in your personal hive.
          </p>
          {state.organisations.map((org) => (
            <div className="row between wrap" key={org.teamId}>
              <span>
                {org.teamName} · {org.shared ? "Shared" : "Kept private"}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => void act(org.teamId, org.shared)}
              >
                {org.shared ? "Make personal" : `Share with ${org.teamName}`}
              </Button>
            </div>
          ))}
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
