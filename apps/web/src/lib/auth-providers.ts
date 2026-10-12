export type SignInProvider = "google" | "slack";

export function enabledSignInProviders(env: Record<string, string | undefined> = process.env): SignInProvider[] {
  return (["google", "slack"] as const).filter((provider) => {
    const prefix = provider.toUpperCase();
    return Boolean(env[`${prefix}_CLIENT_ID`]?.trim() && env[`${prefix}_CLIENT_SECRET`]?.trim());
  });
}
