import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { B, fixtureHome } from './helpers.mjs';

const memory = (fx, ...args) => spawnSync(process.execPath, [fx.corePath('memory.mjs'), ...args], { encoding: 'utf8' });

test('shared knowledge survives switching providers, rejects stale edits, keeps unrelated keys, and persists after either provider is removed', async () => {
  const fx = fixtureHome('knowledge');
  try {
    fx.seed('claude', { instructions: 'Hi.\n' }); fx.seed('codex', { instructions: 'Hi.\n' });
    B.bridge(fx);
    assert.ok(fx.readText(fx.instructions('claude')).includes('knowledge-contract.md'), 'the block points at the knowledge contract');
    assert.ok(fx.readText(fx.corePath('knowledge-contract.md')).includes('memory.mjs'));
    let put = memory(fx, 'put', 'delivery-day', '0', 'Friday', 'claude', 'fact');
    assert.equal(put.status, 0, put.stderr);
    assert.equal(memory(fx, 'put', 'tone', '0', 'Short and friendly', 'codex', 'preference').status, 0);
    assert.equal(memory(fx, 'put', 'delivery-day', '1', 'Thursday', 'codex', 'fact').status, 0);
    const stale = memory(fx, 'put', 'delivery-day', '1', 'Monday', 'claude', 'fact');
    assert.equal(stale.status, 2);
    const conflict = JSON.parse(stale.stdout);
    assert.equal(conflict.conflict, true); assert.equal(conflict.current.value, 'Thursday'); assert.equal(conflict.proposed.value, 'Monday');
    const store = JSON.parse(memory(fx, 'read').stdout);
    assert.equal(store.entries['delivery-day'].value, 'Thursday'); assert.equal(store.entries['delivery-day'].provider, 'codex'); assert.equal(store.entries['delivery-day'].revision, 2);
    assert.ok(store.entries['delivery-day'].updatedAt); assert.equal(store.entries.tone.category, 'preference');
    const race = value => new Promise(done => { const child = spawn(process.execPath, [fx.corePath('memory.mjs'), 'put', 'delivery-day', '2', value, 'codex', 'fact']); let stdout = ''; child.stdout.on('data', c => stdout += c); child.on('close', status => done({ status, stdout })); });
    const racers = await Promise.all([race('Tuesday'), race('Wednesday')]);
    assert.equal(racers.filter(r => r.status === 0).length, 1, 'exactly one writer wins');
    assert.ok(racers.some(r => [1, 2].includes(r.status)), 'the loser reports busy or stale');
    assert.equal(JSON.parse(memory(fx, 'read').stdout).entries['delivery-day'].revision, 3);
    // Busy lock, invalid schema, temp files.
    mkdirSync(fx.corePath('knowledge.lock'));
    const busy = memory(fx, 'put', 'x', '0', 'y', 'claude', 'fact');
    assert.equal(busy.status, 1); assert.match(busy.stderr, /busy/);
    rmSync(fx.corePath('knowledge.lock'), { recursive: true });
    assert.equal(memory(fx, 'put', 'bad key!', '0', 'y', 'claude', 'fact').status, 1);
    assert.equal(memory(fx, 'put', 'k', '0', 'y', 'gemini', 'fact').status, 1);
    assert.equal(memory(fx, 'put', 'k', '0', 'y', 'claude', 'wish').status, 1);
    const good = readFileSync(fx.corePath('knowledge.json'), 'utf8');
    writeFileSync(fx.corePath('knowledge.json'), '{"schema":2}');
    const invalid = memory(fx, 'read'); assert.equal(invalid.status, 1); assert.match(invalid.stderr, /Unrecognised/);
    assert.equal(B.verify(fx).checks.find(c => c.name === 'core:knowledge').state, 'failed', 'an unreadable store is reported, not treated as empty');
    writeFileSync(fx.corePath('knowledge.json'), good);
    writeFileSync(fx.corePath('knowledge-deadbeef.tmp'), '{ partial');
    assert.equal(JSON.parse(memory(fx, 'read').stdout).entries['delivery-day'].revision, 3, 'a temporary file is never read as knowledge');
    // Removal of either provider keeps the store.
    B.remove(fx, 'claude');
    assert.equal(JSON.parse(memory(fx, 'read').stdout).entries.tone.value, 'Short and friendly');
    B.remove(fx, 'codex');
    assert.ok(existsSync(fx.corePath('knowledge.json')));
    assert.deepEqual(fx.manifest().providers, {});
    B.bridge(fx, { provider: 'codex' });
    assert.equal(JSON.parse(memory(fx, 'read').stdout).entries.tone.value, 'Short and friendly');
    assert.equal(B.verify(fx).checks.find(c => c.name === 'core:knowledge').detail, '2 shared knowledge entries readable.');
  } finally { fx.cleanup(); }
});
