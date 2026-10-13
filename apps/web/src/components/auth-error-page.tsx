import { authError } from "@/lib/auth-error";
import { ErrorLink, ErrorShell } from "./error-shell";
import { signOutAndContinue } from "@/app/app/actions";

export function AuthErrorPage({ reason }: { reason: string }) {
  const error = authError(reason);
  const actions = error.label === "Sign out" ? (
    <form action={signOutAndContinue}>
      <button className="hm-btn hm-btn-primary hm-btn-md" type="submit">Sign out</button>
    </form>
  ) : <ErrorLink href={error.href}>{error.label}</ErrorLink>;
  return <ErrorShell code="Access" title={error.title} actions={actions}><p>{error.next}</p></ErrorShell>;
}
