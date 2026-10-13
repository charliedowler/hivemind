import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const repoRoot = resolve(packageRoot, '../..');
export const webRoot = resolve(repoRoot, 'apps/web');
export const webRequire = createRequire(resolve(webRoot, 'package.json'));
export const evidenceRoot = resolve(process.env.HIVE_E2E_EVIDENCE || '/tmp/hive-e2e');
