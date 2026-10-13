import { agentid } from "@agentmail/agentid-better-auth";
import { decodeJwt } from "jose";

export function agentidProvider() {
  const provider = agentid({
    clientId: process.env.AGENTID_CLIENT_ID!,
    clientSecret: process.env.AGENTID_CLIENT_SECRET!,
    scopes: ["openid", "email", "profile", "owner_profile", "owner_email"],
  });
  return {
    ...provider,
    getUserInfo: async (tokens: Parameters<NonNullable<typeof provider.getUserInfo>>[0]) => {
      const profile = await provider.getUserInfo!(tokens);
      if (!profile || !tokens.idToken) return null;
      return { ...profile, actor_type: decodeJwt(tokens.idToken).actor_type };
    },
  };
}
