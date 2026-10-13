"use client";

import { useState } from "react";
import { Button, Card } from "@hivemind/design-system";
import { authClient } from "@/lib/auth-client";
import { requestJson, errorMessage } from "@/lib/client";
import { ErrorPanel } from "./primitives";

export function AgentTeams({ teams, oauthQuery }: { teams: { id: string; name: string }[]; oauthQuery: string }) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  async function join(teamId: string) {
    setPending(teamId);
    setError("");
    try {
      await requestJson("/api/app/agent-team", { teamId });
      if (oauthQuery) {
        const result = await authClient.oauth2.continue({ postLogin: true, oauth_query: oauthQuery });
        if (result.error) throw new Error(result.error.message);
        if (result.data?.url) window.location.assign(result.data.url);
      } else window.location.assign("/app?agent_joined=1");
    } catch (error) { setError(errorMessage(error)); setPending(""); }
  }
  return <Card className="stack">
    <h1>Which team should you join?</h1>
    <p>Your verified owner belongs to these teams.</p>
    {teams.map(team => <Button key={team.id} variant="secondary" disabled={Boolean(pending)} loading={pending === team.id} onClick={() => void join(team.id)}>{team.name}</Button>)}
    {error ? <ErrorPanel message={error} /> : null}
  </Card>;
}
