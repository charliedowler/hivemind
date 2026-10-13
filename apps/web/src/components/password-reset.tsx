"use client";

import { useActionState } from "react";
import { Button, Input } from "@hivemind/design-system";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/client";
import { ErrorPanel } from "./primitives";

export function PasswordReset({ email }: { email: string }) {
  const [state, submit, pending] = useActionState(async (previous: { sent: boolean; error: string; saved: boolean }, form: FormData) => {
    try {
      if (String(form.get("action")) === "send") {
        const result = await authClient.emailOtp.requestPasswordReset({ email });
        if (result.error) throw new Error(result.error.message);
        return { sent: true, error: "", saved: false };
      }
      const result = await authClient.emailOtp.resetPassword({ email, otp: String(form.get("code")), password: String(form.get("password")) });
      if (result.error) throw new Error(result.error.message);
      return { sent: false, error: "", saved: true };
    } catch (error) { return { ...previous, error: errorMessage(error) }; }
  }, { sent: false, error: "", saved: false });
  return <form action={submit} className="stack">
    <h2>Your password</h2>
    <p className="muted">Set or reset your password with a code sent to {email}. This signs out your other web sessions.</p>
    {state.saved ? <p role="status">Password saved. Sign in with your email and new password.</p> : null}
    {state.sent ? <>
      <Input label="Email code" name="code" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" />
      <Input label="New password" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
      <Button type="submit" loading={pending}>Save password</Button>
    </> : null}
    {state.error ? <ErrorPanel message={state.error} /> : null}
    <Button type="submit" name="action" value="send" variant="secondary" loading={pending} formNoValidate>Send password code</Button>
  </form>;
}
