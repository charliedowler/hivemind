import type { CreateTeamInput, HiveContext, JoinTeamInput } from "@hivemind/core";

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

export async function createTeam(
  input: CreateTeamInput,
): Promise<{ ctx: HiveContext; apiKey: string; inviteCode: string }> {
  return notImplemented("createTeam");
}

export async function joinTeam(
  input: JoinTeamInput,
): Promise<{ ctx: HiveContext; apiKey: string } | null> {
  return notImplemented("joinTeam");
}

export async function authenticateApiKey(rawKey: string): Promise<HiveContext | null> {
  return notImplemented("authenticateApiKey");
}

export async function issueApiKey(
  ctx: HiveContext,
  label?: string,
): Promise<{ apiKey: string; prefix: string }> {
  return notImplemented("issueApiKey");
}

export async function startWebSession(ctx: HiveContext): Promise<void> {
  return notImplemented("startWebSession");
}

export async function getWebContext(): Promise<HiveContext | null> {
  return notImplemented("getWebContext");
}

export async function endWebSession(): Promise<void> {
  return notImplemented("endWebSession");
}
