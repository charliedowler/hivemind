import { ErrorShell } from "@/components/error-shell";
import { switchAccount } from "./switch";

export default function Page() {
  return <ErrorShell code="Account" title="Switch account" actions={<form action={switchAccount}><button className="hm-btn hm-btn-primary hm-btn-md" type="submit">Sign out and continue</button></form>}><p>Sign out of this account, then sign in with another email.</p></ErrorShell>;
}
