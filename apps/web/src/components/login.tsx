"use client";

import { useState } from "react";
import { Card, Sprite, Tabs } from "@hivemind/design-system";
import { authClient } from "@/lib/auth-client";
import type { SignInProvider } from "@/lib/auth-providers";
import { errorMessage } from "@/lib/client";
import { ErrorPanel } from "./primitives";
import { AuthForm, type LoginMode } from "./auth-form";
import styles from "./auth-provider-buttons.module.css";

export function Login({ invite, providers, initialError = "" }: { invite: string; providers: SignInProvider[]; initialError?: string }) {
  const [mode, setMode] = useState<LoginMode>(invite ? "join" : "sign-in");
  return (
    <div className="login-layout">
      <div className="login-intro">
        <h1>Your agents learn together.</h1>
        <p className="lead">Create a hive or join your team's. Connect your agent to start sharing learnings.</p>
        <div className="login-scene" aria-hidden="true"><Sprite name="comb-cluster" scale={5} /><Sprite name="bee-carry" scale={3} className="hm-bob" /></div>
      </div>
      <Card className="login-panel">
        <h2>{mode === "sign-in" ? "Welcome back" : mode === "create" ? "Start your hive" : "Join your hive"}</h2>
        <p className="muted">{mode === "sign-in" ? "Sign in to your team's hive." : mode === "create" ? "Create a hive with your work email." : "Use an invite link or an allowed work email domain."}</p>
        <Tabs label="Account options" tabs={[{ id: "sign-in", label: "Sign in" }, { id: "create", label: "Create a team" }, { id: "join", label: "Join" }]} value={mode} onChange={(value) => setMode(value as LoginMode)} />
        {initialError ? <ErrorPanel message={initialError} /> : null}
        {providers.length ? <ProviderButtons providers={providers} /> : null}
        {providers.length ? <p className="auth-divider small muted">Or use your email</p> : null}
        <AuthForm key={mode} mode={mode} invite={invite} />
      </Card>
    </div>
  );
}

function ProviderButtons({ providers }: { providers: SignInProvider[] }) {
  const [pending, setPending] = useState<SignInProvider>();
  const [error, setError] = useState("");
  async function signIn(provider: SignInProvider) {
    setPending(provider);
    setError("");
    try {
      const callbackURL = `${window.location.origin}/app/join${window.location.search}`;
      if (provider === "agentid") {
        window.location.assign(`/api/auth/agentid/start${window.location.search}`);
        return;
      }
      const result = await authClient.signIn.social({ provider, callbackURL, errorCallbackURL: `${window.location.origin}/app/auth-error` });
      if (result.error) throw new Error(result.error.message);
    } catch (error) { setError(errorMessage(error)); setPending(undefined); }
  }
  return <div className={`stack auth-providers ${styles.providers}`}>
    {providers.map((provider) => <button
      key={provider}
      type="button"
      className={`${styles.button} ${styles[provider]}`}
      aria-label={providerLabels[provider]}
      aria-busy={pending === provider}
      disabled={Boolean(pending)}
      onClick={() => void signIn(provider)}
    >
      {provider === "google" ? <img src="/auth-providers/google-sign-in.svg" alt="" width={180} height={40} className={styles.googleArtwork} /> : <>
        <img src={`/auth-providers/${provider}.svg`} alt="" width={20} height={20} />
        <span>{providerLabels[provider]}</span>
      </>}
    </button>)}
    {pending ? <p className="sr-only" role="status">Opening {providerNames[pending]} sign-in…</p> : null}
    {error ? <ErrorPanel message={error} /> : null}
  </div>;
}

const providerNames = { google: "Google", slack: "Slack", agentid: "AgentID" };
const providerLabels = { google: "Sign in with Google", slack: "Sign in with Slack", agentid: "Sign in with AgentID" };
