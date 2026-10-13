"use client";
import { useState, type FormEvent } from "react";
import type { HiveJoinPhrase } from "@hivemind/core";
import { Button, Card, Input } from "@hivemind/design-system";
import { teamInvitePrompt } from "@/lib/agent-onboarding";
import { requestJson, errorMessage } from "@/lib/client";
import { useRouter } from "next/navigation";
import { PromptBlock } from "./prompt-block";
export function InviteTeam({
  teamName,
  baseUrl,
  phrase,
}: {
  teamName: string;
  baseUrl: string;
  phrase: HiveJoinPhrase | null;
}) {
  if (!phrase || phrase.paused)
    return (
      <p className="muted">
        Joining is paused. Add an allowed work domain and resume joining on the
        Team page.
      </p>
    );
  const link = `${baseUrl}/j/${phrase.phrase}`;
  return (
    <section className="stack" aria-label="Invite your team">
      <h2>Invite your team</h2>
      <PromptBlock
        key={phrase.phrase}
        text={teamInvitePrompt(teamName, link)}
      />
      <p className="small breakable">
        Or send them this link: <a href={link}>{link}</a>
      </p>
    </section>
  );
}
export function HiveInvite({
  teamId,
  teamName,
  baseUrl,
  initial,
  initialDomains,
}: {
  teamId: string;
  teamName: string;
  baseUrl: string;
  initial: HiveJoinPhrase | null;
  initialDomains: string[];
}) {
  const [state, setState] = useState({
    phrase: initial,
    domains: initialDomains,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function act(action: string) {
    setPending(true);
    setError("");
    try {
      setState(
        await requestJson("/api/app/join-phrase/admin", { action, teamId }),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <Card className="stack">
      <RenameHive key={teamName} teamId={teamId} teamName={teamName} />
      {state.phrase ? (
        <>
          <h2 className="breakable">{state.phrase.phrase}</h2>
          <p className="small breakable">
            {baseUrl}/j/{state.phrase.phrase}
          </p>
          <div className="row wrap">
            <Button
              variant="secondary"
              loading={pending}
              onClick={() => void act("rotate")}
            >
              Rotate
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                void act(state.phrase?.paused ? "resume" : "pause")
              }
            >
              {state.phrase.paused ? "Resume" : "Pause"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2>Invite your team</h2>
          <Button loading={pending} onClick={() => void act("generate")}>
            Create join phrase
          </Button>
        </>
      )}
      <h3>Work domains</h3>
      <p className="small muted">
        Only people with a verified email on an allowed work domain can join.
      </p>
      <p>
        {state.domains.length
          ? state.domains.join(", ")
          : "No domains allowed yet."}
      </p>
      <Button
        variant="secondary"
        loading={pending}
        onClick={() => void act("domain")}
      >
        Allow my verified domain
      </Button>
      {state.phrase ? (
        <InviteTeam
          teamName={teamName}
          baseUrl={baseUrl}
          phrase={state.phrase}
        />
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </Card>
  );
}

function RenameHive({
  teamId,
  teamName,
}: {
  teamId: string;
  teamName: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name"));
    setPending(true);
    setError("");
    try {
      await requestJson("/api/app/organisation", { teamId, name });
      router.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <details>
      <summary>Hive name</summary>
      <form className="stack" onSubmit={(event) => void save(event)}>
        <Input
          label="Hive name"
          name="name"
          defaultValue={teamName}
          maxLength={80}
          required
        />
        <Button type="submit" loading={pending}>
          Save name
        </Button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </details>
  );
}
