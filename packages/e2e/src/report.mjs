import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function markdownReport(report) {
  const counts = Object.fromEntries(['pass', 'fail', 'blocked'].map(status => [status, report.scenarios.filter(row => row.status === status).length]));
  return `# Hive E2E run\n\nCommit: ${report.commit}. Installer: ${report.version}. Mode: ${report.mode}.\n\n${counts.pass} pass, ${counts.fail} fail, ${counts.blocked} blocked. Runtime: ${(report.durationMs / 1000).toFixed(1)} seconds.\n\n| Scenario | Result | Seconds | Evidence |\n| --- | --- | ---: | --- |\n${report.scenarios.map(row => `| ${row.name} | ${row.status} | ${(row.durationMs / 1000).toFixed(1)} | ${row.directory} |`).join('\n')}\n\n${report.scenarios.filter(row => row.status !== 'pass').map(row => `## ${row.name}\n\n${row.error}\n`).join('\n')}\nReal configuration fingerprints: ${report.configUnchanged ? 'unchanged' : 'FAILED'}.\n`;
}

export async function writeReports(report, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  await writeFile(`${directory}/report.md`, markdownReport(report), { mode: 0o600 });
  if (process.env.HIVE_E2E_BUG_REPORT) {
    const path = process.env.HIVE_E2E_BUG_REPORT;
    await mkdir(dirname(path), { recursive: true });
    const failures = report.scenarios.filter(row => row.status === 'fail');
    await writeFile(path, `# Hive E2E current failures\n\nTested ${report.commit}, installer ${report.version}, ${report.mode}. Failures below require classification as product or harness faults before dispatch.\n\n${failures.map(row => `## ${row.name}\n\nStep and assertion: ${row.error}\n\nEvidence: ${row.directory}\n\n${row.stack ? '```text\n' + row.stack + '\n```\n' : ''}`).join('\n')}\n`, { mode: 0o600 });
  }
}
