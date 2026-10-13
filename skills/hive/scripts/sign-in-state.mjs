import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homeDirectory } from './mcp.mjs';
export function readSignIn() {
  try { return JSON.parse(readFileSync(join(homeDirectory(), '.hive/sign-in.json'), 'utf8')); } catch { return {}; }
}
export function updateSignIn(value) {
  const previous = readSignIn();
  if (process.env.HIVE_SIGN_IN_ATTEMPT && previous.attempt !== process.env.HIVE_SIGN_IN_ATTEMPT) throw new Error('Another sign-in replaced this attempt');
  const file = join(homeDirectory(), '.hive/sign-in.json');
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify({ ...previous, ...value }), { mode: 0o600 }); renameSync(temp, file);
}
