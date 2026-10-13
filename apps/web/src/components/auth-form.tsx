"use client";

import { useActionState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@hivemind/design-system";
import {
  submitCredentials,
  initialAuthFormState,
  type AuthFormState,
  type LoginMode,
} from "@/lib/credential-flow";
export type { LoginMode } from "@/lib/credential-flow";
import { ErrorPanel } from "./primitives";

export function AuthForm({
  mode,
  invite,
  returnTo,
}: {
  mode: LoginMode;
  invite: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const credentials = useRef({ email: "", password: "" });
  const [state, submit, pending] = useActionState(
    (previous: AuthFormState, form: FormData) =>
      submitCredentials(mode, previous, form, credentials.current, () => {
        router.push(returnTo ?? "/app/join");
        router.refresh();
      }),
    initialAuthFormState,
  );
  return (
    <form className="stack" action={submit} aria-label={modeLabels[mode]}>
      {state.notice ? <p role="status">{state.notice}</p> : null}
      {state.stage === "credentials" ? (
        <CredentialFields mode={mode} invite={invite} />
      ) : (
        <Input
          label="Email code"
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          required
        />
      )}
      <PasswordField stage={state.stage} mode={mode} />
      {state.error ? <ErrorPanel message={state.error} /> : null}
      <AuthActions stage={state.stage} mode={mode} pending={pending} />
    </form>
  );
}

function CredentialFields({
  mode,
  invite,
}: {
  mode: LoginMode;
  invite: string;
}) {
  return (
    <>
      {mode === "create" ? (
        <Input
          label="Team name"
          name="teamName"
          autoComplete="organization"
          required
          maxLength={80}
          placeholder="Your team's hive"
        />
      ) : null}
      {mode === "join" ? (
        <Input
          label="Invite link or code"
          name="inviteCode"
          defaultValue={invite}
          maxLength={200}
          placeholder="Leave empty to use your work domain"
          hint="Use an invite, or join the hive that allows your verified work domain."
        />
      ) : null}
      {mode !== "sign-in" ? (
        <Input
          label="Your name"
          name="name"
          autoComplete="name"
          required
          maxLength={80}
          placeholder="How the hive knows you"
        />
      ) : null}
      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={200}
        placeholder="you@company.com"
      />
    </>
  );
}

const modeLabels = {
  "sign-in": "Sign in",
  create: "Create a team",
  join: "Join",
};

function PasswordField({
  stage,
  mode,
}: {
  stage: AuthFormState["stage"];
  mode: LoginMode;
}) {
  if (stage === "verify") return null;
  return (
    <Input
      label={stage === "reset" ? "New password" : "Password"}
      name="password"
      type="password"
      autoComplete={
        mode === "sign-in" && stage !== "reset"
          ? "current-password"
          : "new-password"
      }
      required
      minLength={8}
      maxLength={128}
      hint={mode === "sign-in" ? undefined : "At least 8 characters."}
    />
  );
}

function AuthActions({
  stage,
  mode,
  pending,
}: {
  stage: AuthFormState["stage"];
  mode: LoginMode;
  pending: boolean;
}) {
  const label =
    stage === "verify"
      ? "Verify email and sign in"
      : stage === "reset"
        ? "Set password and sign in"
        : modeLabels[mode];
  return (
    <>
      <Button type="submit" loading={pending} fullWidth>
        {label}
      </Button>
      {stage === "credentials" && mode === "sign-in" ? (
        <Button
          type="submit"
          name="action"
          value="reset"
          variant="ghost"
          formNoValidate
          disabled={pending}
        >
          Set or reset your password
        </Button>
      ) : null}
      {stage === "verify" ? (
        <Button
          type="submit"
          name="action"
          value="resend"
          variant="ghost"
          formNoValidate
          disabled={pending}
        >
          Send another code
        </Button>
      ) : null}
      {stage !== "credentials" ? (
        <Button
          type="submit"
          name="action"
          value="back"
          variant="ghost"
          formNoValidate
          disabled={pending}
        >
          Back to sign in
        </Button>
      ) : null}
    </>
  );
}
