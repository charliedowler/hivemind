"use client";
import { useActionState } from "react";
import { Button, Input } from "@hivemind/design-system";
import { errorMessage, requestJson } from "@/lib/client";
import { ErrorPanel } from "./primitives";
export function EmailCode({
  token,
  onVerified,
  onBack,
}: {
  token: string;
  onVerified: (result: { apiKey: string; inviteCode?: string }) => void;
  onBack: () => void;
}) {
  const [state, submit, pending] = useActionState(
    async (_previous: { error: string }, form: FormData) => {
      try {
        onVerified(
          await requestJson(
            "/api/app/email",
            { verificationToken: token, code: String(form.get("code") ?? "") },
            undefined,
            "PUT",
          ),
        );
        return { error: "" };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
    { error: "" },
  );
  return (
    <form className="stack" action={submit}>
      <h2>Check your email</h2>
      <p className="muted">
        Enter the six-digit code. It expires in 15 minutes. Your key appears
        after you verify.
      </p>
      <Input
        label="Email code"
        name="code"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        autoComplete="one-time-code"
        required
        disabled={pending}
      />
      {state.error ? <ErrorPanel message={state.error} /> : null}
      <Button type="submit" loading={pending}>
        Verify email
      </Button>
      <Button variant="ghost" onClick={onBack} disabled={pending}>
        Request another code
      </Button>
    </form>
  );
}
