import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDependencies } from './dependency-audit.mjs';
const report = (counts, status = 0) => ({ status, stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 0, critical: 0, total: 0, ...counts } } }) });
const outage = { status: 1, stdout: JSON.stringify({ error: { code: 'E503' } }) };
function check(sequence, expected, calls) {
  let n = 0;
  assert.equal(auditDependencies({ run: () => sequence[n++], log: () => {} }), expected);
  assert.equal(n, calls);
}
test('clean audit passes', () => check([report({})], 0, 1));
test('high/critical findings fail immediately without retry', () => {
  for (const severity of ['high', 'critical']) check([report({ [severity]: 1, total: 1 }, 1)], 1, 1);
});
test('moderate findings retain existing high-severity threshold', () => check([report({ moderate: 1, total: 1 })], 0, 1));
test('registry outage retries and can recover', () => check([outage, report({})], 0, 2));
test('timeout is retried', () => check([{ error: { code: 'ETIMEDOUT' } }, report({})], 0, 2));
test('persistent outages fail closed after three attempts', () => check([outage, outage, outage], 1, 3));
test('invalid, error and contradictory results cannot pass', () => {
  for (const result of [{ status: 0, stdout: '{}' }, { status: 0, stdout: '<html>' }, report({}, 1), { status: 0, stdout: JSON.stringify({ error: { code: 'EUSAGE' } }) }]) check([result], 1, 1);
});
