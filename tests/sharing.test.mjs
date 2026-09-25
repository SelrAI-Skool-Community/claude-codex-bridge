// The two sharing checks vendored from Claude Sync: the scrubber blocks, the
// portability check warns. Fixtures and answer keys are copied unchanged; the
// answer keys live outside the fixture directories on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './helpers.mjs';
import { scrubFiles } from '../scripts/scrub.mjs';
import { checkPortability } from '../scripts/portability.mjs';

const SHARING = join(REPO, 'tests/fixtures/sharing');
function fixture(name) {
  const files = [];
  const walk = (dir, rel) => { for (const entry of readdirSync(dir).sort()) { const full = join(dir, entry); const r = rel ? `${rel}/${entry}` : entry; if (statSync(full).isDirectory()) walk(full, r); else files.push({ path: r, content: readFileSync(full, 'utf8') }); } };
  walk(join(SHARING, name), '');
  return files;
}
const key = name => JSON.parse(readFileSync(join(SHARING, `${name}.expected.json`), 'utf8'));
const PLANTED_VALUES = ['mailer-team-2026!', 'kx9-live-4f8a2c-team', 'Trellis-9-Quartz', 'ghp_FakeExampleTokenFakeExampleToken9876', 'AKIAIOSFODNN7EXAMPLE', '-----BEGIN RSA PRIVATE KEY-----', 'wxj-4421-team-weather-key', 'gho_TeamFakeOAuthTokenTeamFakeOAuthTk9zz', 'qs7-3308-team-mailer-vault'];

test('scrub: every planted secret is caught, and nothing beyond the plants', () => {
  const r = scrubFiles(fixture('planted-secrets'));
  assert.deepEqual(r.hits.map(({ ruleId, path, line, fingerprint, label }) => ({ ruleId, path, line, fingerprint, label })), key('planted-secrets').scrub);
});
test('scrub: no planted value ever appears in the output', () => {
  const out = JSON.stringify(scrubFiles(fixture('planted-secrets')));
  for (const v of PLANTED_VALUES) assert.ok(!out.includes(v), 'a planted value leaked');
  assert.ok(!/"value"/.test(out));
  for (const line of fixture('planted-secrets').flatMap(f => f.content.split(/\r?\n/))) { const t = line.trim(); if (t.length >= 8) assert.ok(!out.includes(t), 'a raw fixture line leaked'); }
});
test('scrub: the planted values and the pinned fingerprints agree', () => {
  assert.deepEqual(PLANTED_VALUES.map(v => createHash('sha256').update(v, 'utf8').digest('hex').slice(0, 8)).sort(), key('planted-secrets').scrub.map(h => h.fingerprint).sort());
});
test('scrub: benign lookalikes and clean content produce zero false positives; placeholder env files are skipped and disclosed', () => {
  const benign = scrubFiles(fixture('benign-lookalike'));
  assert.deepEqual(benign.hits, []);
  assert.ok(benign.filesSkipped.some(s => s.path.endsWith('.env.example') && s.why === 'placeholder-env-file'));
  assert.ok(benign.filesScanned > 0);
  assert.deepEqual(scrubFiles(fixture('clean')).hits, []);
  assert.deepEqual(scrubFiles(fixture('machine-bound')).hits, key('machine-bound').scrub, 'machine paths are not secrets');
});
test('scrub: a binary file is named in the skip list and is not counted as scanned', () => {
  const r = scrubFiles(fixture('unscannable'));
  assert.deepEqual(r.hits, key('unscannable').scrub);
  assert.ok(r.filesSkipped.some(s => s.path === 'assets/logo.png' && s.why === 'binary'));
});
test('scrub and portability: the vendored files match their pinned checksums', () => {
  const lineage = JSON.parse(readFileSync(join(REPO, 'docs/lineage.json'), 'utf8'));
  for (const file of ['scripts/scrub.mjs', 'scripts/portability.mjs']) {
    const pin = lineage.ports.find(p => p.local === file).sha256;
    assert.equal(createHash('sha256').update(readFileSync(join(REPO, file), 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex'), pin, `${file} changed without a re-vendor`);
  }
  assert.equal(lineage.ports.find(p => p.local === 'scripts/scrub.mjs').sha256, 'cf466a181ca13a52095be3e0b2d9020d6fa862a3a9d325e099642c6fec6e80a9', 'the scrub pin equals the Claude Sync pin');
});
test('scrub: the same files twice give byte-identical output', () => {
  assert.equal(JSON.stringify(scrubFiles(fixture('planted-secrets'))), JSON.stringify(scrubFiles(fixture('planted-secrets'))));
});
test('portability: every planted machine-specific reference is flagged, and nothing beyond the plants', () => {
  const r = checkPortability(fixture('machine-bound'));
  assert.deepEqual(r.warnings.map(({ ruleId, path, line, reference }) => ({ ruleId, path, line, reference })), key('machine-bound').portability);
  assert.ok(r.warnings.every(w => !('fingerprint' in w)), 'a machine path is not a secret and carries no fingerprint');
});
test('portability: the secrets fixture is portability-clean; benign references produce zero false positives', () => {
  assert.deepEqual(checkPortability(fixture('planted-secrets')).warnings, key('planted-secrets').portability);
  for (const name of ['clean', 'benign-lookalike']) assert.deepEqual(checkPortability(fixture(name)).warnings, []);
});
test('portability: the same files twice give byte-identical output', () => {
  assert.equal(JSON.stringify(checkPortability(fixture('machine-bound'))), JSON.stringify(checkPortability(fixture('machine-bound'))));
});
