import { test } from 'node:test';
import assert from 'node:assert/strict';
import { B, fixtureHome, item } from './helpers.mjs';
import { probeNativeImport, compareVersions } from '../scripts/bridge-native-import.mjs';

const probeWith = table => ({ provider }) => table[provider] || { provider, source: provider === 'claude' ? 'codex' : 'claude', available: false, mode: 'unavailable', version: null, items: [], command: null, reason: 'not installed' };
const both = fx => { fx.seed('claude', { instructions: 'Hi.\n' }); fx.seed('codex', { instructions: 'Hi.\n' }); };

test('capability fixtures: supported programmatic, unsupported, interactive-only, restricted host, failed and partial imports are reported accurately and verified independently', () => {
  const cases = {
    supported: { probe: { claude: { provider: 'claude', source: 'codex', available: true, mode: 'programmatic', version: '9.9.9', items: ['instructions', 'skills'], command: null, reason: 'fixture: programmatic importer' } }, runner: () => ({ imported: ['instructions', 'skills'], failed: [] }), expect: 'completed' },
    unsupported: { probe: { claude: { provider: 'claude', source: 'codex', available: false, mode: 'unavailable', version: '1.0.0', items: [], command: null, reason: 'fixture: too old' } }, expect: null },
    interactive: { probe: { claude: { provider: 'claude', source: 'codex', available: true, mode: 'interactive', version: '2.1.276', items: ['skills'], command: '/import codex', reason: 'fixture: interactive' } }, expect: 'user-step' },
    restricted: { probe: { claude: { provider: 'claude', source: 'codex', available: false, mode: 'unavailable', version: null, items: [], command: null, reason: 'fixture: restricted host' } }, expect: null },
    failed: { probe: { claude: { provider: 'claude', source: 'codex', available: true, mode: 'programmatic', version: '9.9.9', items: ['skills'], command: null, reason: 'fixture' } }, runner: () => { throw Error('importer crashed'); }, expect: 'failed' },
    partial: { probe: { claude: { provider: 'claude', source: 'codex', available: true, mode: 'programmatic', version: '9.9.9', items: ['skills', 'mcp'], command: null, reason: 'fixture' } }, runner: () => ({ imported: ['skills'], failed: ['mcp'] }), expect: 'partial' },
  };
  for (const [name, c] of Object.entries(cases)) {
    const fx = fixtureHome(`native-${name}`);
    try {
      both(fx);
      const p = B.plan(fx, { probe: probeWith(c.probe) });
      const it = item(p, 'native-import:codex->claude');
      if (c.expect === null) { assert.equal(it.disposition, 'unsupported', name); assert.match(it.reason, /fixture/); assert.ok(!p.operations.some(o => o.op === 'native-import')); }
      else if (c.expect === 'user-step') { assert.equal(it.disposition, 'translated'); assert.match(it.userAction, /you run it|never claims/i); assert.ok(p.userSteps.some(s => s.includes('/import codex'))); assert.ok(!p.operations.some(o => o.op === 'native-import'), 'an interactive command is never run by the bridge'); }
      else { assert.ok(p.operations.some(o => o.op === 'native-import')); }
      const result = B.apply(fx, p.id, { nativeImportRunner: c.runner || null });
      const v = B.verify(fx, { probe: probeWith(c.probe) });
      const check = v.checks.find(x => x.name === 'native-import:codex->claude');
      if (c.expect === null || c.expect === 'user-step') { assert.equal(check, undefined, `${name}: nothing was delegated, so nothing is claimed`); assert.equal(fx.manifest().nativeImports.length, 0); }
      else {
        assert.equal(result.nativeImports[0].status, c.expect, name);
        assert.equal(check.state, c.expect === 'completed' ? 'confirmed' : c.expect === 'partial' ? 'blocked' : 'failed');
        if (c.expect === 'partial') assert.match(check.detail, /failed: mcp/);
        if (c.expect === 'failed') assert.match(check.detail, /importer crashed/);
      }
      assert.ok(v.checks.filter(x => x.name.endsWith(':block')).every(x => x.state === 'confirmed'), 'destination state is inspected independently of the importer');
    } finally { fx.cleanup(); }
  }
  const fx = fixtureHome('native-norunner');
  try {
    both(fx);
    const p = B.plan(fx, { probe: probeWith({ claude: { provider: 'claude', source: 'codex', available: true, mode: 'programmatic', version: '9.9.9', items: ['skills'], command: null, reason: 'fixture' } }) });
    const r = B.apply(fx, p.id);
    assert.equal(r.nativeImports[0].status, 'blocked', 'no runner in this session means blocked, never completed');
  } finally { fx.cleanup(); }
});

test('the real probe is capability-driven: version gate, restricted hosts and a missing binary give distinct answers', () => {
  assert.ok(compareVersions('2.1.213', '2.1.213') === 0 && compareVersions('2.1.212', '2.1.213') < 0 && compareVersions('2.2.0', '2.1.999') > 0);
  const exec = version => (bin) => bin === 'claude' ? `${version} (Claude Code)` : bin === 'codex' ? `codex-cli ${version}` : null;
  let r = probeNativeImport({ provider: 'claude', exec: exec('2.1.276'), env: {} });
  assert.equal(r.available, true); assert.equal(r.mode, 'interactive'); assert.equal(r.command, '/import codex'); assert.ok(r.items.includes('subagents'));
  r = probeNativeImport({ provider: 'claude', exec: exec('2.1.100'), env: {} });
  assert.equal(r.available, false); assert.match(r.reason, /older than 2\.1\.213/);
  r = probeNativeImport({ provider: 'claude', exec: exec('2.1.276'), env: { CLAUDE_CODE_USE_BEDROCK: '1' } });
  assert.equal(r.available, false); assert.match(r.reason, /unavailable on this host/);
  r = probeNativeImport({ provider: 'claude', exec: () => null, env: {} });
  assert.equal(r.available, 'unknown'); assert.equal(r.mode, 'unavailable');
  r = probeNativeImport({ provider: 'codex', exec: exec('0.155.0'), env: {} });
  assert.equal(r.available, 'unknown'); assert.equal(r.mode, 'interactive'); assert.match(r.reason, /without a stated minimum version/);
  r = probeNativeImport({ provider: 'codex', exec: () => null, env: {} });
  assert.equal(r.available, 'unknown'); assert.equal(r.mode, 'unavailable');
});
