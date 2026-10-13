"use client";

import { useActionState, useState } from "react";
import { Button, Card, Sprite } from "@hivemind/design-system";
import { authClient } from "@/lib/auth-client";
import { errorMessage, requestJson } from "@/lib/client";
import { ErrorPanel } from "./primitives";

export function Consent({
  clientName,
  teamName,
  email,
  scopes,
  claims,
  oauthQuery,
  teamId,
  hives = [],
}: {
  clientName: string;
  teamName: string;
  email: string;
  scopes: string[];
  claims: string[];
  oauthQuery: string;
  teamId?: string;
  hives?: { teamId: string; teamName: string; personal: boolean }[];
}) {
  const [choice, setChoice] = useState<string>();
  const requestedPersonWide = scopes.includes("hive:person");
  const canChooseHive = scopes.includes("hive") && hives.length > 0;
  const selectedChoice =
    choice ??
    (canChooseHive ? teamId : requestedPersonWide ? "person" : teamId);
  const personWide = selectedChoice === "person";
  const selectedTeamId = personWide ? teamId : selectedChoice;
  const grantedScopes = personWide
    ? scopes
    : scopes.filter((scope) => scope !== "hive:person");
  const selectedTeamName =
    hives.find((hive) => hive.teamId === selectedTeamId)?.teamName ?? teamName;
  const [error, submit, pending] = useActionState(
    async (_previous: string, form: FormData) => {
      try {
        if (
          form.get("decision") === "allow" &&
          selectedTeamId &&
          selectedTeamId !== teamId
        ) {
          await requestJson("/api/app/switch-hive", { teamId: selectedTeamId });
        }
        const result = await authClient.oauth2.consent({
          accept: form.get("decision") === "allow",
          oauth_query: oauthQuery,
          ...(requestedPersonWide ? { scope: grantedScopes.join(" ") } : {}),
        });
        if (result.error) throw new Error(result.error.message);
        if (result.data?.url) window.location.assign(result.data.url);
        return "";
      } catch (error) {
        return errorMessage(error);
      }
    },
    "",
  );
  return (
    <Card className="stack consent-panel">
      <Sprite name="bee-carry" scale={3} />
      <span className="eyebrow">Connect your agent</span>
      <h1>Connect {clientName} to your hive</h1>
      <p>
        You are signed in as {email}.{" "}
        {personWide ? (
          <>
            This agent can access your personal hive and organisations you join
            now or in future.
          </>
        ) : (
          <>
            This agent can act in <strong>{selectedTeamName}</strong>.
          </>
        )}
      </p>
      <ConsentScopes
        scopes={grantedScopes}
        personWide={personWide}
        claims={claims}
      />
      <p className="small muted">
        {personWide
          ? "This connection follows your future hive memberships until you revoke it. Cancel to leave the agent disconnected."
          : "Access is limited to this hive. Cancel to leave the agent disconnected."}
      </p>
      {error ? (
        <ErrorPanel message="This connection request has expired or changed. Start the connection again from your agent." />
      ) : null}
      <form className="stack" action={submit}>
        {hives.length ? (
          <label className="stack">
            <span>Default hive</span>
            <select
              aria-label="Default hive"
              value={selectedChoice}
              disabled={pending}
              onChange={(event) => setChoice(event.target.value)}
            >
              {canChooseHive
                ? hives.map((hive) => (
                    <option key={hive.teamId} value={hive.teamId}>
                      {hive.personal
                        ? `Personal · ${hive.teamName}`
                        : hive.teamName}
                    </option>
                  ))
                : null}
              {requestedPersonWide ? (
                <option value="person">
                  Personal hive and organisations you join now or in future
                </option>
              ) : null}
            </select>
          </label>
        ) : null}
        <Button type="submit" name="decision" value="allow" loading={pending}>
          Allow access
        </Button>
        <Button
          type="submit"
          name="decision"
          value="cancel"
          variant="secondary"
          disabled={pending}
        >
          Cancel
        </Button>
      </form>
    </Card>
  );
}

const scopeDescriptions: Record<string, string> = {
  "hive:person":
    "Read and search cells, ask Hive, save personal cells and give feedback in your personal hive and organisations you join now or in future. Sharing with an organisation still needs your permission.",
  hive: "Read and search cells, ask the hive, save cells and give feedback in this hive.",
  offline_access:
    "Keep the connection active between sessions until you revoke it.",
  openid: "Confirm your member identity.",
  profile: "Read your name.",
  email: "Read your email address.",
};
function ConsentScopes({
  scopes,
  personWide,
  claims,
}: {
  scopes: string[];
  personWide: boolean;
  claims: string[];
}) {
  return (
    <ul className="consent-scopes">
      {scopes
        .filter((scope) => !personWide || scope !== "hive")
        .map((scope) => (
          <li key={scope}>{scopeDescriptions[scope] ?? scope}</li>
        ))}
      {claims.map((claim) => (
        <li key={claim}>Read the requested profile field: {claim}.</li>
      ))}
    </ul>
  );
}
