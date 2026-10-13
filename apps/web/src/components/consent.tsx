"use client";

import { useActionState } from "react";
import { Button, Card, Sprite } from "@hivemind/design-system";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/client";
import { ErrorPanel } from "./primitives";

export function Consent({ clientName, teamName, email, scopes, claims, oauthQuery }: { clientName: string; teamName: string; email: string; scopes: string[]; claims: string[]; oauthQuery: string }) {
  const [error, submit, pending] = useActionState(async (_previous: string, form: FormData) => {
    try {
      const result = await authClient.oauth2.consent({ accept: form.get("decision") === "allow", oauth_query: oauthQuery });
      if (result.error) throw new Error(result.error.message);
      if (result.data?.url) window.location.assign(result.data.url);
      return "";
    } catch (error) { return errorMessage(error); }
  }, "");
  return <Card className="stack consent-panel">
    <Sprite name="bee-carry" scale={3} />
    <span className="eyebrow">Connect your agent</span>
    <h1>Connect {clientName} to your hive</h1>
    <p>You are signed in as {email}. This agent can act in <strong>{teamName}</strong>.</p>
    <ul className="consent-scopes">
      {scopes.map((scope) => <li key={scope}>{scope === "hive" ? "Read and search cells, ask the hive, save cells and give feedback in this team." : scope === "offline_access" ? "Keep the connection active between sessions until you revoke it." : scope === "openid" ? "Confirm your member identity." : scope === "profile" ? "Read your name." : scope === "email" ? "Read your email address." : scope}</li>)}
      {claims.map((claim) => <li key={claim}>Read the requested profile field: {claim}.</li>)}
    </ul>
    <p className="small muted">Access is limited to this hive. Cancel to leave the agent disconnected.</p>
    {error ? <ErrorPanel message="This connection request has expired or changed. Start the connection again from your agent." /> : null}
    <form className="stack" action={submit}>
      <Button type="submit" name="decision" value="allow" loading={pending}>Allow access</Button>
      <Button type="submit" name="decision" value="cancel" variant="secondary" disabled={pending}>Cancel</Button>
    </form>
  </Card>;
}
