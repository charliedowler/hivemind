import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webRequire, webRoot } from './paths.mjs';
import { command, freePort } from './processes.mjs';

const postgres = webRequire('postgres');

export function validateDatabaseUrl(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('E2E PostgreSQL must run on loopback. Remote databases are forbidden.');
  return url;
}

export async function startDatabase() {
  const name = `hive_capture_rules_hive_digest_e2e_${randomBytes(7).toString('hex')}`;
  let url = validateDatabaseUrl(process.env.HIVE_E2E_ADMIN_URL || 'postgres://hivemind:hivemind@127.0.0.1:54329/postgres');
  let container;
  let admin = postgres(url.href, { max: 1, connect_timeout: 2, onnotice() {} });
  try { await admin`SELECT 1`; }
  catch (error) {
    await admin.end({ timeout: 1 });
    if (process.env.HIVE_E2E_ADMIN_URL) throw error;
    const port = await freePort();
    container = `hive-e2e-${randomBytes(7).toString('hex')}`;
    await command('docker', ['run', '--rm', '--detach', '--name', container, '-e', 'POSTGRES_USER=hivemind', '-e', 'POSTGRES_PASSWORD=hivemind', '-e', 'POSTGRES_DB=postgres', '-p', `127.0.0.1:${port}:5432`, 'pgvector/pgvector:pg17']);
    url = new URL(`postgres://hivemind:hivemind@127.0.0.1:${port}/postgres`);
    admin = postgres(url.href, { max: 1, connect_timeout: 2, onnotice() {} });
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await admin`SELECT 1`; break; }
      catch (err) { if (attempt === 29) { await command('docker', ['stop', container]); throw err; } await new Promise(resolve => setTimeout(resolve, 500)); }
    }
  }
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const sql = postgres(url.href, { max: 4, onnotice() {} });
  const migrations = [];
  const close = async () => {
    await sql.end({ timeout: 3 });
    try {
      await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${name} AND pid <> pg_backend_pid()`;
      await admin.unsafe(`DROP DATABASE "${name}"`);
    } finally {
      await admin.end({ timeout: 2 });
      if (container) await command('docker', ['stop', container]);
    }
  };
  try {
    await sql`CREATE TABLE _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const directory = resolve(webRoot, 'drizzle');
    for (const filename of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      const body = await readFile(resolve(directory, filename), 'utf8');
      try {
        await sql.begin(async tx => { await tx.unsafe(body); await tx`INSERT INTO _migrations (name) VALUES (${filename})`; });
        migrations.push({ name: filename, status: 'applied' });
      } catch (error) {
        if (filename !== '0002_pgvector.sql') throw error;
        migrations.push({ name: filename, status: 'fts-fallback', message: error.message });
      }
    }
    return { sql, url: url.href, name, migrations, close };
  } catch (error) { await close(); throw error; }
}
