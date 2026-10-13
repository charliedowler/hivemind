import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.argv[2] || process.env.HIVE_HOME || process.env.HOME;
try {
  const stored = JSON.parse(readFileSync(join(home, '.hive/agent.json'), 'utf8'));
  const token = process.env.HIVE_AGENT_TOKEN || stored.credential;
  if (!/^ha_[A-Za-z0-9_-]{43}$/.test(token || '')) throw new Error();
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}` }));
} catch { process.exitCode = 1; }
