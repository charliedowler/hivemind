import { AsyncLocalStorage } from "node:async_hooks";
import type { HiveContext } from "@hivemind/core";
import { getSql } from "../db/client";

const credentials = new AsyncLocalStorage<{ memberId: string; personWide: boolean }>();
export const personScope = "hive:person";
export const credentialVersion = 2;
export async function credentialEpoch(): Promise<number> {
  const rows = await getSql()`SELECT value FROM auth_verification WHERE id = 'hive-oauth-cutover'`;
  return rows[0] ? Number(rows[0].value) : 0;
}

export function withCredentialScope<T>(memberId: string, personWide: boolean, run: () => T): T {
  return credentials.run({ memberId, personWide }, run);
}

export function hasPersonScope(ctx: HiveContext): boolean {
  const value = credentials.getStore();
  return value?.memberId === ctx.memberId && value.personWide;
}
