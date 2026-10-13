import { authError } from "@/lib/auth-error";
import { ErrorLink, ErrorShell } from "./error-shell";

export function AuthErrorPage({ reason }: { reason: string }) {
  const error = authError(reason);
  return <ErrorShell code="Access" title={error.title} actions={<ErrorLink href={error.href}>{error.label}</ErrorLink>}><p>{error.next}</p></ErrorShell>;
}
