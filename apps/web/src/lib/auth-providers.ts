export type SignInProvider = "google" | "slack" | "agentid";

export function enabledSignInProviders(env: Record<string, string | undefined> = process.env): SignInProvider[] {
  return (["google", "slack", "agentid"] as const).filter((provider) => {
    const prefix = provider.toUpperCase();
    return Boolean(env[`${prefix}_CLIENT_ID`]?.trim() && env[`${prefix}_CLIENT_SECRET`]?.trim());
  });
}
