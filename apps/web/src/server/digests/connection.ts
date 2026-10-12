import type { HiveContext } from "@hivemind/core";
import { HiveError } from "../errors";
import type { DigestTransport } from "./runner";
import type { DigestChannel } from "./store";
export async function digestChannels(
  _ctx: HiveContext,
): Promise<DigestChannel[]> {
  return [];
}
export async function digestChannel(
  _ctx: HiveContext,
  id: string,
): Promise<DigestChannel> {
  return { id, name: id };
}
export const digestTransport: DigestTransport = {
  async authors() {
    return new Map();
  },
  async send() {
    throw new HiveError("The Slack connection is not available yet.", 503);
  },
};
