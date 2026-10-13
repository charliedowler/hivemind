import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { startRuntime, scenarioContext, writeArtifact } from './runtime.mjs';
import { evidenceRoot, packageRoot } from './paths.mjs';
import { fingerprintRealConfigs, assertRealConfigs, outputViolations } from './guards.mjs';
import { stopAll } from './processes.mjs';
import { writeReports } from './report.mjs';
import { layers } from '../scenarios/index.mjs';

const args = process.argv.slice(2);
const mode = args.includes('--real') ? 'real' : args.includes('--full') ? 'full' : 'fast';
const filter = args.find(arg => arg.startsWith('--only='))?.slice(7);
const realHome = homedir();
const before = await fingerprintRealConfigs(realHome);
const started = Date.now();
const report = { mode, commit: null, version: null, durationMs: 0, configUnchanged: false, scenarios: [] };
let runtime;
let starting;
const startup = new AbortController();
let active;
let stopping;
async function finish() {
  if (stopping) return stopping;
  stopping = (async () => {
    startup.abort(new Error('Harness is stopping'));
    const failures = [];
    try { await active?.finish(); } catch (error) { failures.push(error); }
    active = null;
    try { await stopAll(); } catch (error) { failures.push(error); }
    if (starting) runtime = await starting.catch(() => runtime);
    try { await runtime?.close(); } catch (error) { failures.push(error); }
    for (const error of failures) {
      process.exitCode = 1;
      report.scenarios.push({ name: 'harness-cleanup', status: 'fail', error: error.message, durationMs: 0 });
    }
    const after = await fingerprintRealConfigs(realHome);
    try { assertRealConfigs(before, after); report.configUnchanged = true; }
    catch (error) { process.exitCode = 1; report.scenarios.push({ name: 'real-config-integrity', status: 'fail', error: error.message, durationMs: 0 }); }
    await writeArtifact(evidenceRoot, 'config-fingerprints.json', { before, after });
    report.durationMs = Date.now() - started;
    await writeReports(report, evidenceRoot);
  })();
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, async () => { report.interruptedBy = signal; process.exitCode = 130; await finish(); process.exit(130); });
try {
  runtime = await (starting = startRuntime({ signal: startup.signal }));
  report.commit = runtime.commit;
  report.version = runtime.version;
  const scenarios = [];
  for (const module of layers.filter(layer => layer !== 'real' || mode === 'real')) {
    const path = resolve(packageRoot, 'scenarios', `${module}.mjs`);
    if (!existsSync(path)) {
      if (!filter) throw new Error(`Missing scenario layer ${module}`);
      continue;
    }
    const imported = await import(pathToFileURL(path));
    scenarios.push(...imported.default);
  }
  const selected = scenarios.filter(test => (!filter || test.name.includes(filter)) && (mode !== 'fast' || test.fast));
  if (!selected.length) throw new Error('No scenarios selected.');
  for (const scenario of selected) {
    const started = Date.now();
    console.log(`RUN ${scenario.name}`);
    const context = scenarioContext(runtime, scenario.name);
    active = context;
    const result = { name: scenario.name, status: 'pass', durationMs: 0, directory: context.directory };
    try {
      await context.resetRateLimits();
      await scenario.run(context);
      const inspected = [...context.outputs, ...context.events.filter(event => event.kind === 'mail').map(event => ({ text: event.body.text, surface: 'mail' })), ...context.events.filter(event => event.kind === 'slack' && event.body.text).map(event => ({ text: event.body.text, surface: 'slack' }))];
      const violations = inspected.flatMap(item => outputViolations(item.text || '').map(violation => ({ ...violation, surface: item.surface })));
      await context.artifact('output-guard.json', { inspected: inspected.length, violations });
      if (violations.length) throw new Error(`Output contract: ${JSON.stringify(violations)}`);
    } catch (error) {
      result.status = error.code === 'E2E_BLOCKED' ? 'blocked' : 'fail';
      result.error = error.message;
      result.stack = error.stack;
      if (result.status === 'fail') process.exitCode = 1;
      else if (!process.exitCode) process.exitCode = 2;
    } finally {
      try { await context.finish(); } catch (error) { result.status = 'fail'; result.error = [result.error, error.message].filter(Boolean).join('\n'); process.exitCode = 1; }
      active = null;
      result.durationMs = Date.now() - started;
      report.scenarios.push(result);
      await writeArtifact(result.directory, 'result.json', result);
      console.log(`${result.status.toUpperCase()} ${scenario.name} (${(result.durationMs / 1000).toFixed(1)}s)${result.error ? ': ' + result.error : ''}`);
      await writeReports({ ...report, durationMs: Date.now() - started }, evidenceRoot);
    }
    if (stopping) break;
  }
} catch (error) {
  process.exitCode = 1;
  report.scenarios.push({ name: 'harness-infrastructure', status: 'fail', durationMs: 0, error: error.message, stack: error.stack });
  console.error(error);
} finally { await finish(); }
console.log(`Report: ${evidenceRoot}/report.md`);
