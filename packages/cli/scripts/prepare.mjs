import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../../../skills/hive/', import.meta.url));
const target = fileURLToPath(new URL('../assets/hive/', import.meta.url));
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

for (const script of ['capture-matchers.mjs', 'capture-privacy.mjs']) {
  const source = fileURLToPath(new URL(`../../core/src/${script}`, import.meta.url));
  if (!existsSync(source)) throw new Error(`Missing shared Hive runtime: ${script}`);
  cpSync(source, `${target}/scripts/${script}`);
}
