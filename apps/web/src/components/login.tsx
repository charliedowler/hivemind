"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTeamInput, joinTeamInput, signInInput } from "@hivemind/core";
import { Button, Card, Input, Sprite, Tabs } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
import { CopyButton, ErrorPanel } from "./primitives";
import { EmailCode } from "./email-code";
import { InstallSnippets, KeyBox } from "./install";

type Mode = "teams" | "join" | "domain" | "session";
type Created = { apiKey: string; inviteCode?: string };

const modes = {
  teams: {
    title: "Start your hive",
    description: "A home for what your team's agents learn.",
    label: "Create a team",
    action: "Create a team",
    schema: createTeamInput,
  },
  join: {
    title: "Join your hive",
    description: "Your invite brings you into the shared comb.",
    label: "Join a team",
    action: "Join the team",
    schema: joinTeamInput,
  },
  domain: {
    title: "Join with your work email",
    description: "A verified work domain can bring you into its hive.",
    label: "Join by domain",
    action: "Send a code",
    schema: joinTeamInput.omit({ inviteCode: true }),
  },
  session: {
    title: "Welcome back",
    description: "Use the key you saved when you joined.",
    label: "Sign in",
    action: "Sign in",
    schema: signInInput,
  },
};

export function Login({
  baseUrl,
  invite,
}: {
  baseUrl: string;
  invite: string;
}) {
  const [mode, setMode] = useState<Mode>(invite ? "join" : "teams");
  const [token, setToken] = useState("");
  const [created, setCreated] = useState<Created>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const schema = modes[mode].schema;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = schema.safeParse(fields);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form.");
      return;
    }
    setPending(true);
    try {
      const result = await requestJson<Created & { verificationToken: string }>(
        mode === "domain" ? "/api/app/email" : `/api/app/${mode}`,
        {
          ...parsed.data,
          ...(mode !== "session" ? { email: fields.email, intent: mode } : {}),
        },
      );
      if (mode === "session") {
        router.push("/app");
        router.refresh();
      } else setToken(result.verificationToken);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  if (created) return <CreatedLogin created={created} baseUrl={baseUrl} />;
  return (
    <div className="login-layout">
      <div className="login-intro">
        <span className="eyebrow">One team. One shared comb.</span>
        <h1>What you learn belongs in the hive.</h1>
        <p className="lead">
          Give your agents a shared memory. The next forager starts with what
          your team already knows.
        </p>
        <div className="login-scene" aria-hidden="true">
          <Sprite name="comb-cluster" scale={5} />
          <Sprite name="bee-carry" scale={3} className="hm-bob" />
        </div>
        <p className="small muted">
          Claude is clay. Codex is teal. Every learning has a source.
        </p>
      </div>
      <Card className="login-panel">
        <h2>{modes[mode].title}</h2>
        <p className="muted">{modes[mode].description}</p>
        <Tabs
          label="Account options"
          tabs={[
            { id: "teams", label: "Create a team" },
            { id: "join", label: "Join a team" },
            { id: "domain", label: "Work domain" },
            { id: "session", label: "Sign in" },
          ]}
          value={mode}
          onChange={(value) => {
            if (!pending) {
              setMode(value as Mode);
              setToken("");
              setError("");
            }
          }}
        />
        {token ? (
          <EmailCode
            token={token}
            onVerified={setCreated}
            onBack={() => setToken("")}
          />
        ) : (
          <form
            key={mode}
            className="stack"
            onSubmit={submit}
            aria-label={modes[mode].label}
          >
            <LoginFields mode={mode} invite={invite} />
            {error ? <ErrorPanel message={error} /> : null}
            <Button type="submit" fullWidth loading={pending}>
              {pending ? "Joining the hive" : modes[mode].action}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

function CreatedLogin({
  created,
  baseUrl,
}: {
  created: Created;
  baseUrl: string;
}) {
  return (
    <div className="install-page stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">A place in the comb</span>
          <h1>You're in the hive.</h1>
          <p className="muted">Save your key. Then bring your first forager.</p>
        </div>
        <Sprite name="bee-carry" scale={4} />
      </div>
      <KeyBox apiKey={created.apiKey} />
      {created.inviteCode ? (
        <Card>
          <h2>Invite your team</h2>
          <p className="muted">
            Share this code so their learnings join the same comb.
          </p>
          <div className="row wrap">
            <code>{created.inviteCode}</code>
            <CopyButton text={created.inviteCode} label="Copy invite code" />
          </div>
        </Card>
      ) : null}
      <Link className="hm-btn hm-btn-primary hm-btn-md self-start" href="/app">
        Open the hive
      </Link>
      <InstallSnippets baseUrl={baseUrl} apiKey={created.apiKey} />
    </div>
  );
}

function LoginFields({ mode, invite }: { mode: Mode; invite: string }) {
  return (
    <>
      {mode === "teams" ? (
        <Input
          label="Team name"
          name="teamName"
          maxLength={80}
          required
          autoComplete="organization"
          placeholder="Your team's hive"
        />
      ) : null}
      {mode === "join" ? (
        <Input
          label="Invite code"
          name="inviteCode"
          defaultValue={invite}
          required
          maxLength={64}
          placeholder="hive-..."
        />
      ) : null}
      {mode !== "session" ? (
        <Input
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          maxLength={200}
          required
          placeholder="you@company.com"
        />
      ) : null}
      {mode !== "session" ? (
        <Input
          label="Your name"
          name="memberName"
          autoComplete="name"
          maxLength={80}
          required
          placeholder="How the hive knows you"
        />
      ) : (
        <Input
          label="API key"
          name="apiKey"
          type="password"
          autoComplete="off"
          required
          placeholder="hm_..."
          hint="Your key stays private. It opens your team's hive."
        />
      )}
    </>
  );
}
