"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTeamInput, joinTeamInput, signInInput } from "@hivemind/core";
import { requestJson, errorMessage } from "@/lib/client";
import { CopyButton, ErrorPanel } from "./primitives";
import { InstallSnippets, KeyBox } from "./install";

type Mode = "teams" | "join" | "session";
type Created = { apiKey: string; inviteCode?: string };

export function Login({
  baseUrl,
  invite,
}: {
  baseUrl: string;
  invite: string;
}) {
  const [mode, setMode] = useState<Mode>(invite ? "join" : "teams");
  const [created, setCreated] = useState<Created>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const schema =
      mode === "teams"
        ? createTeamInput
        : mode === "join"
          ? joinTeamInput
          : signInInput;
    const parsed = schema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setPending(true);
    try {
      const result = await requestJson<Created>(
        `/api/app/${mode}`,
        parsed.data,
      );
      if (mode === "session") {
        router.push("/app");
        router.refresh();
      } else setCreated(result);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  if (created)
    return (
      <div className="narrow stack">
        <h1>You’re in.</h1>
        <KeyBox apiKey={created.apiKey} />
        {created.inviteCode && (
          <div className="panel">
            <h2>Invite your team</h2>
            <div className="row">
              <code>{created.inviteCode}</code>
              <CopyButton text={created.inviteCode} />
            </div>
          </div>
        )}
        <Link className="primary self-start" href="/app">
          Go to the dashboard
        </Link>
        <InstallSnippets baseUrl={baseUrl} apiKey={created.apiKey} />
      </div>
    );
  return (
    <div className="login-panel panel">
      <h1>A place for what you learn.</h1>
      <p className="muted">Bring your agents. Build your team’s memory.</p>
      <div className="tabs" aria-label="Account options">
        {(
          [
            { id: "teams", name: "Create a team" },
            { id: "join", name: "Join a team" },
            { id: "session", name: "Sign in" },
          ] as const
        ).map((tab) => (
          <button
            type="button"
            key={tab.id}
            aria-pressed={mode === tab.id}
            onClick={() => {
              setMode(tab.id);
              setError("");
            }}
            disabled={pending}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <form key={mode} className="stack" onSubmit={submit}>
        {mode === "teams" && (
          <label>
            Team name
            <input
              name="teamName"
              maxLength={80}
              required
              autoComplete="organization"
            />
          </label>
        )}
        {mode === "join" && (
          <label>
            Invite code
            <input
              name="inviteCode"
              defaultValue={invite}
              required
              maxLength={64}
              placeholder="hive-…"
            />
          </label>
        )}
        {mode !== "session" && (
          <label>
            Your name
            <input
              name="memberName"
              autoComplete="name"
              maxLength={80}
              required
            />
          </label>
        )}
        {mode === "session" && (
          <label>
            API key
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              required
              placeholder="hm_…"
            />
            <span className="muted">
              Use the key you saved when you joined.
            </span>
          </label>
        )}
        {error && <ErrorPanel message={error} />}
        <button className="primary" disabled={pending}>
          {pending
            ? "Connecting…"
            : mode === "teams"
              ? "Create a team"
              : mode === "join"
                ? "Join the team"
                : "Sign in"}
        </button>
      </form>
    </div>
  );
}
