export function authError(reason: string) {
  const code = reason.toLowerCase().replaceAll("-", "_");
  if (["state_mismatch", "state_not_found", "invalid_state", "invalid_code", "invalid_token", "token_expired", "session_expired", "expired_token"].includes(code))
    return { title: "This sign-in link has expired.", next: "Start again from the sign-in page.", href: "/app/login", label: "Sign in" };
  if (["access_denied", "denied", "consent_denied"].includes(code))
    return { title: "You did not allow the connection.", next: "Start again when you want to connect.", href: "/app", label: "Open your hive" };
  if (["connection_expired", "invalid_request", "invalid_client", "invalid_signature", "invalid_code_verifier", "invalid_grant"].includes(code))
    return { title: "This connection request has expired or changed.", next: "Start the connection again from your agent.", href: "/app/install", label: "Install Hive" };
  if (["email_not_verified", "email_not_verified_by_provider"].includes(code))
    return { title: "Your email is not verified.", next: "Sign in with your email to request a verification code.", href: "/app/login?email", label: "Sign in" };
  if (["account_not_linked", "email_doesn't_match", "email_mismatch", "email_not_found", "unable_to_get_user_info"].includes(code))
    return { title: "This sign-in option could not verify your account.", next: "Sign in with your email and password.", href: "/app/login?email", label: "Sign in" };
  if (["invite_expired", "invite_revoked", "invite_invalid", "invite_exhausted"].includes(code))
    return { title: "This invite is no longer valid.", next: "Ask your team admin for a new invite.", href: "/app/login", label: "Sign in" };
  if (code === "domain_not_allowed")
    return { title: "Your email domain cannot join this hive.", next: "Ask your team admin for an invite.", href: "/app", label: "Open your hive" };
  if (code === "key_revoked")
    return { title: "This key is no longer active.", next: "Create a new key in your account and reconnect your agent.", href: "/app/install", label: "Manage keys" };
  if (["unknown_org", "access_changed"].includes(code))
    return { title: "You do not have access to this hive.", next: "Sign out, then sign in with an account that has access.", href: "/app/login", label: "Sign out" };
  return { title: "Sign-in could not finish.", next: "Start again from the sign-in page.", href: "/app/login", label: "Sign in" };
}
