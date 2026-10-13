"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Card } from "@hivemind/design-system";
import { errorMessage, requestJson } from "@/lib/client";
import { formatHumanDate } from "@hivemind/core";
export function RequestToJoin({
  phrase,
  teamName,
  domains,
  status,
  retryAt,
}: {
  phrase: string;
  teamName: string;
  domains: string[];
  status: string | null;
  retryAt: string | null;
}) {
  const [asked, setAsked] = useState(status === "pending");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const coolingDown =
    status === "declined" &&
    retryAt &&
    new Date(retryAt).getTime() > Date.now();
  async function ask() {
    setPending(true);
    setError("");
    try {
      const result = await requestJson<{
        status?: string;
        destination?: string;
      }>("/api/app/join-phrase", { phrase });
      if (result.destination) window.location.assign(result.destination);
      else setAsked(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <Card className="stack">
      <h1>Join {teamName}</h1>
      {asked ? (
        <p role="status">Asked. An admin will let you in.</p>
      ) : (
        <>
          <p>
            {domains.length
              ? `${teamName} only lets ${domains.join(" or ")} addresses in automatically. Request to join?`
              : `${teamName} needs an admin to approve new members. Request to join?`}
          </p>
          {coolingDown ? (
            <p role="status">
              Your request was declined. You can ask again{" "}
              {formatHumanDate(retryAt!)}.
            </p>
          ) : (
            <>
              {status === "expired" ? <p>Your last request expired.</p> : null}
              <Button loading={pending} onClick={() => void ask()}>
                Request to join
              </Button>
            </>
          )}
        </>
      )}
      <p className="small muted">
        Your personal hive stays yours. Your agents join after approval.
      </p>
      <Link href="/app">Back to your hive</Link>
      {error ? <p role="alert">{error}</p> : null}
    </Card>
  );
}

export function ApprovedJoin({phrase,teamName}:{phrase:string;teamName:string}) {
  const [pending,setPending]=useState(false);
  const [error,setError]=useState('');
  async function open() {
    setPending(true);setError('');
    try {
      const result=await requestJson<{destination:string}>('/api/app/join-phrase',{phrase});
      window.location.assign(result.destination);
    } catch (error) {setError(errorMessage(error));} finally {setPending(false);}
  }
  return <Card className="stack"><h1>You're in {teamName}.</h1><Button loading={pending} onClick={()=>void open()}>Open {teamName}</Button>{error?<p role="alert">{error}</p>:null}</Card>;
}
