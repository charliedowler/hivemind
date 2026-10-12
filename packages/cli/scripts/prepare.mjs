import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../../../skills/hive/', import.meta.url));
const target = fileURLToPath(new URL('../assets/hive/', import.meta.url));
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

const matcher = fileURLToPath(new URL('../../core/src/capture-matchers.mjs', import.meta.url));
if (existsSync(matcher)) cpSync(matcher, target + '/scripts/capture-matchers.mjs');
