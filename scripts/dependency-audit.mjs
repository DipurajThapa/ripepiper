import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const platform = fileURLToPath(new URL('../platform/ripe-piper-platform/', import.meta.url));
const transient = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|E(?:429|500|502|503|504)|network timeout|audit endpoint returned an error/i;

export function auditDependencies({ run, log = console.log, attempts = 3 } = {}) {
  run ??= () => spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['audit', '--json', '--audit-level=high', '--fetch-timeout=20000', '--fetch-retries=0'],
    { cwd: platform, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = run();
    let report;
    try { report = JSON.parse(result.stdout); } catch { /* Invalid reports never pass. */ }
    const counts = report?.metadata?.vulnerabilities;
    if (counts && !report.error && ['high', 'critical', 'total'].every(k => Number.isInteger(counts[k]) && counts[k] >= 0)) {
      log(`Dependency audit: ${counts.high} high, ${counts.critical} critical, ${counts.total} total.`);
      if (counts.high || counts.critical) return 1;
      if (result.status === 0 && !result.error && !result.signal) return 0;
    }
    const diagnostic = `${result.error?.code || ''} ${result.stderr || ''} ${JSON.stringify(report?.error || '')}`;
    if (!transient.test(diagnostic)) {
      log('Dependency audit failed: no successful, valid security report.');
      return 1;
    }
    log(`Audit service unavailable (attempt ${attempt}/${attempts}); security gate remains closed.`);
  }
  log('Dependency audit could not complete after bounded retries. Re-run after the registry recovers.');
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = auditDependencies();
}
