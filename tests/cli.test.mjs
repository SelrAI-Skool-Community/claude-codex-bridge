import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO, fixtureHome, skill } from './helpers.mjs';
import { parseArgs } from '../scripts/bridge.mjs';

const cli = (fx, ...args) => spawnSync(process.execPath, [join(REPO, 'scripts/bridge.mjs'), ...args, '--home', fx.home, '--kit', REPO], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });

test('the command line drives the whole workflow and always prints one JSON document with a plain summary', () => {
  const fx = fixtureHome('cli');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { notes: skill('notes') } });
    fx.seed('codex', { instructions: 'Hi.\n' });
    let out = cli(fx, 'inspect'); assert.equal(out.status, 0, out.stderr);
    const inv = JSON.parse(out.stdout); assert.equal(inv.providers.claude.present, true); assert.equal(inv.nativeImport.claude.available, 'unknown', 'with no binaries on PATH the probe reports unknown, never assumed');
    out = cli(fx, 'plan', '--provider', 'claude', '--host', 'cli'); assert.equal(out.status, 0, out.stderr);
    const p = JSON.parse(out.stdout); assert.ok(p.id && Array.isArray(p.summary) && p.summary[0].includes('found'));
    out = cli(fx, 'apply', '--plan', p.id); assert.equal(out.status, 0, out.stderr);
    assert.match(JSON.parse(out.stdout).summary, /Applied plan/);
    out = cli(fx, 'verify'); assert.equal(JSON.parse(out.stdout).healthy, true);
    out = cli(fx, 'status'); assert.match(JSON.parse(out.stdout).summary, /Bridge installed for claude and codex/);
    out = cli(fx, 'sync', '--provider', 'codex'); assert.equal(JSON.parse(out.stdout).noop, true);
    out = cli(fx, 'apply'); assert.equal(out.status, 1); assert.match(out.stderr, /Unknown plan id/);
    out = cli(fx, 'remove'); assert.equal(out.status, 1); assert.match(out.stderr, /--remove-provider/);
    out = cli(fx, 'bogus'); assert.equal(out.status, 1); assert.match(out.stderr, /Commands:/);
    out = cli(fx, 'handoff', 'list'); assert.deepEqual(JSON.parse(out.stdout).handoffs, []);
    const input = join(fx.root, 'h.json');
    fx.write(input, JSON.stringify({ name: 'demo', purpose: 'p', currentState: 'c', completedWork: ['a'], decisions: 'none', openWork: ['b'], blockers: 'none', relevantPaths: ['src'], verificationRun: 'none' }));
    out = cli(fx, 'handoff', 'create', '--input', input, '--provider', 'codex'); assert.equal(out.status, 0, out.stderr); assert.equal(JSON.parse(out.stdout).saved, true);
    out = cli(fx, 'handoff', 'show', '--name', 'demo'); assert.ok(JSON.parse(out.stdout).body.includes('- Provider: codex'));
    out = cli(fx, 'handoff', 'create', '--provider', 'codex'); assert.equal(out.status, 1); assert.match(out.stderr, /--input/);
  } finally { fx.cleanup(); }
});

test('argument parsing rejects bad values by name', () => {
  assert.throws(() => parseArgs(['plan', '--provider', 'gemini']), /claude or codex/);
  assert.throws(() => parseArgs(['plan', '--resolve', 'x']), /--resolve takes/);
  assert.throws(() => parseArgs(['plan', '--resolve', 'x=maybe']), /choose claude, codex, core or keep-separate/);
  assert.throws(() => parseArgs(['plan', '--instructions-from', 'both']), /claude, codex or none/);
  assert.throws(() => parseArgs(['plan', '--home']), /needs a value/);
  assert.throws(() => parseArgs(['plan', '--wat']), /Unknown option/);
  const { options } = parseArgs(['plan', '--only', 'a, b', '--skip', 'c', '--resolve', 'a=claude', '--resolve', 'b=core']);
  assert.deepEqual(options.only, ['a', 'b']); assert.deepEqual(options.skip, ['c']); assert.deepEqual(options.resolve, { a: 'claude', b: 'core' });
});
