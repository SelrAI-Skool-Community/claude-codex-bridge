// Interrupted operations recover from the receipt's own saved progress. A
// child process runs apply and is killed (SIGKILL, no cleanup) at a named
// external write boundary; the next ordinary plan + apply must finish the job,
// keep every user file, adopt only what the bridge provably wrote, report the
// recovery, and leave a receipt a third run does not change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { B, REPO, fixtureHome, skill } from './helpers.mjs';
import { hash } from '../scripts/bridge-files.mjs';

const driver = join(REPO, 'tests/fixtures/apply-driver.mjs');
function runApply(fx, planId, killAt = '') {
  const log = join(fx.root, 'checkpoints.log');
  writeFileSync(log, '');
  const out = spawnSync(process.execPath, [driver, fx.home, planId, killAt, log], { encoding: 'utf8' });
  return { ...out, boundaries: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean), result: out.status === 0 ? JSON.parse(out.stdout) : null };
}
const seedBoth = fx => {
  fx.seed('claude', { instructions: 'Always call me Sam.\n', skills: { notes: skill('notes', 'n\n', { 'ref/a.md': 'a\n' }), mine: skill('mine', 'mine\n') }, files: { 'settings.json': '{}' } });
  fx.seed('codex', { instructions: 'Always call me Sam.\n', skills: { own: skill('own', 'Set model_reasoning_effort.\n') } });
  return { [fx.instructions('claude')]: 'Always call me Sam.\n', [fx.instructions('codex')]: 'Always call me Sam.\n', [join(fx.config('claude'), 'settings.json')]: '{}', [fx.skillPath('codex', 'own')]: skill('own', 'Set model_reasoning_effort.\n')['SKILL.md'] };
};
const stable = m => { const c = JSON.parse(JSON.stringify(m)); delete c.lastPlan; delete c.createdAt; for (const v of Object.values(c.providers)) delete v.installedAt; return JSON.stringify(c); };
function assertComplete(fx, label) {
  const m = fx.manifest();
  assert.equal(m.pending, undefined, `${label}: no unfinished progress left`);
  assert.equal(existsSync(join(fx.home, '.selr/bridge/operation.lock')), false, `${label}: lock released`);
  for (const provider of Object.keys(m.providers)) {
    assert.ok(m.providers[provider].ready, `${label}: ${provider} ready`);
    const global = fx.readText(m.providers[provider].instructions);
    assert.equal((global.match(/<!-- selr-bridge:begin -->/g) || []).length, 1, `${label}: one block in ${provider}`);
    for (const [name, owned] of Object.entries(m.providers[provider].skills)) for (const [file, h] of Object.entries(owned.files)) assert.equal(hash(readFileSync(join(m.providers[provider].skillRoot, name, file))), h, `${label}: ${provider} ${name}/${file} owned and current`);
  }
  for (const [name, owned] of Object.entries(m.core.skills)) for (const [file, h] of Object.entries(owned.files)) assert.equal(hash(readFileSync(fx.corePath('skills', name, file))), h, `${label}: core ${name}/${file}`);
  for (const key of ['memory', 'contract']) assert.equal(hash(fx.readText(m.core[key].path)), m.core[key].hash, `${label}: ${key} matches receipt`);
  const v = B.verify(fx); assert.ok(v.healthy, `${label}: ${v.summary}`);
  return m;
}
const assertPersonal = (personal, fx, label) => { for (const [path, body] of Object.entries(personal)) assert.ok(fx.readText(path)?.startsWith(body), `${label}: personal file ${path} intact`); };

test('an initial bridge killed at every write boundary recovers on the next plan + apply, adopts its own writes, keeps personal files and stays stable', () => {
  const probe = fixtureHome('recovery-probe');
  let boundaries;
  try { seedBoth(probe); const p = B.plan(probe); const dry = runApply(probe, p.id); assert.equal(dry.status, 0, dry.stderr); assert.equal(dry.result.recovery, null); boundaries = dry.boundaries; } finally { probe.cleanup(); }
  assert.ok(boundaries.includes('lock') && boundaries.includes('core:memory') && boundaries.includes('adapter:claude') && boundaries.includes('adapter:codex') && boundaries.some(b => b.startsWith('core:skill:')) && boundaries.some(b => b.startsWith('codex:skill-file:')), `boundaries enumerated: ${boundaries.join(' ')}`);
  let passes = 0;
  for (const killAt of boundaries) {
    const fx = fixtureHome('recovery');
    try {
      const personal = seedBoth(fx);
      const first = B.plan(fx);
      const killed = runApply(fx, first.id, killAt);
      assert.equal(killed.signal, 'SIGKILL', `${killAt}: process died there (${killed.stderr})`);
      assert.ok(existsSync(join(fx.home, '.selr/bridge/operation.lock')), `${killAt}: a killed run leaves its lock`);
      if (killAt !== 'lock') assert.ok(fx.manifest().pending, `${killAt}: progress record survives`);
      assert.equal(B.verify(fx).healthy, false, `${killAt}: verify reports the unfinished state`);
      const again = B.plan(fx);
      const recovered = runApply(fx, again.id);
      assert.equal(recovered.status, 0, `${killAt}: recovery run succeeds (${recovered.stderr})`);
      assert.ok(recovered.result.recovery, `${killAt}: recovery reported`);
      assert.ok(recovered.result.recovery.actions.some(a => /lock/.test(a)), `${killAt}: stale lock removal named`);
      assert.ok(recovered.result.recovery.summary.length > 20);
      if (/^(core:|claude:|codex:|adapter:)/.test(killAt) && killAt !== 'core:instructions') assert.ok(recovered.result.recovery.adopted.length > 0, `${killAt}: files written before the kill are adopted, not treated as customised (${JSON.stringify(recovered.result.recovery)})`);
      assert.equal(recovered.result.preserved.filter(p => p.startsWith('notes')).length, 0, `${killAt}: nothing the bridge wrote is mistaken for a customisation (${recovered.result.preserved})`);
      assertComplete(fx, killAt);
      assertPersonal(personal, fx, killAt);
      assert.equal(fx.readText(fx.corePath('instructions.md')), 'Always call me Sam.\n');
      const before = stable(fx.manifest());
      const third = B.plan(fx);
      assert.equal(third.noop, true, `${killAt}: a later plan is a no-op`);
      const repeat = runApply(fx, third.id);
      assert.equal(repeat.status, 0, repeat.stderr);
      assert.equal(repeat.result.recovery, null, `${killAt}: a later run is ordinary`);
      assert.equal(stable(fx.manifest()), before, `${killAt}: receipt stable after repeat`);
      passes++;
    } finally { fx.cleanup(); }
  }
  assert.ok(passes >= 8, `${passes} boundaries exercised`);
});

test('an interrupted sync and an interrupted removal complete, and an edit made after the interruption is kept, never adopted', () => {
  // Sync: a promotion killed between files finishes; the baseline ends consistent.
  const fx = fixtureHome('recovery-sync');
  try {
    seedBoth(fx);
    B.bridge(fx);
    fx.write(fx.skillPath('codex', 'notes'), skill('notes', 'v2\n')['SKILL.md']);
    fx.write(fx.skillPath('codex', 'notes', 'ref/b.md'), 'b\n');
    const p = B.plan(fx, { provider: 'codex' });
    const probe = runApply(fx, p.id);
    assert.equal(probe.status, 0, probe.stderr);
    const syncBoundaries = probe.boundaries.filter(b => /skill/.test(b));
    assert.ok(syncBoundaries.length >= 2, syncBoundaries.join(' '));
    for (const killAt of syncBoundaries) {
      const fy = fixtureHome('recovery-sync-case');
      try {
        seedBoth(fy); B.bridge(fy);
        fy.write(fy.skillPath('codex', 'notes'), skill('notes', 'v2\n')['SKILL.md']);
        fy.write(fy.skillPath('codex', 'notes', 'ref/b.md'), 'b\n');
        const q = B.plan(fy, { provider: 'codex' });
        const killed = runApply(fy, q.id, killAt);
        assert.equal(killed.signal, 'SIGKILL', killAt);
        const again = B.plan(fy, { provider: 'codex' });
        const recovered = runApply(fy, again.id);
        assert.equal(recovered.status, 0, `${killAt}: ${recovered.stderr}`);
        assert.equal(fy.readText(fy.skillPath('claude', 'notes')), skill('notes', 'v2\n')['SKILL.md'], `${killAt}: promotion finished`);
        assert.equal(fy.readText(fy.skillPath('claude', 'notes', 'ref/b.md')), 'b\n');
        assertComplete(fy, `sync @ ${killAt}`);
        assert.equal(B.plan(fy).noop, true, `${killAt}: stable`);
      } finally { fy.cleanup(); }
    }
  } finally { fx.cleanup(); }
  // A genuine edit after the interruption survives and is reported, never adopted.
  const fz = fixtureHome('recovery-edit');
  try {
    seedBoth(fz);
    const p = B.plan(fz);
    const killed = runApply(fz, p.id, 'codex:skill:notes');
    assert.equal(killed.signal, 'SIGKILL');
    fz.write(fz.skillPath('codex', 'notes', 'ref/a.md'), 'My own reference.\n');
    const recovered = runApply(fz, B.plan(fz).id);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(fz.readText(fz.skillPath('codex', 'notes', 'ref/a.md')), 'My own reference.\n', 'a real edit survives recovery');
    assert.notEqual(fz.manifest().providers.codex.skills.notes.files['ref/a.md'], hash('My own reference.\n'), 'and its content is never adopted as the bridge\'s');
    // Verify then reports the divergence as a sync task, not as health.
    assert.ok(B.verify(fz).checks.some(c => c.name === 'codex:skill:notes' && c.state === 'blocked'));
  } finally { fz.cleanup(); }
  // Removal: killed after the block is removed but before the receipt forgets the provider.
  const fw = fixtureHome('recovery-remove');
  try {
    seedBoth(fw); B.bridge(fw);
    const p = B.plan(fw, { intent: 'remove', removeProvider: 'claude' });
    const killed = runApply(fw, p.id, 'remove-block:claude');
    assert.equal(killed.signal, 'SIGKILL');
    assert.ok(fw.manifest().providers.claude, 'the receipt still names Claude until removal completes');
    const again = B.plan(fw, { intent: 'remove', removeProvider: 'claude' });
    const recovered = runApply(fw, again.id);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.ok(recovered.result.recovery.actions.some(a => /already removed/.test(a)), 'the finished block removal is named');
    assert.equal(fw.manifest().providers.claude, undefined);
    assert.equal(fw.readText(fw.instructions('claude')), 'Always call me Sam.\n');
    assert.ok(fw.manifest().providers.codex.ready);
    assertComplete(fw, 'removal');
  } finally { fw.cleanup(); }
});

test('the operation lock is reclaimed only from a stopped owner on this computer, never a live one or another computer; stale temporary files are swept', async () => {
  const fx = fixtureHome('lock');
  try {
    seedBoth(fx); B.bridge(fx);
    const lock = join(fx.home, '.selr/bridge/operation.lock');
    mkdirSync(lock);
    const p = B.plan(fx);
    assert.throws(() => B.apply(fx, p.id), /starting right now/, 'a lock with no owner record yet is another operation starting');
    const old = new Date(Date.now() - 10 * 60 * 1000); utimesSync(lock, old, old);
    const reclaimed = B.apply(fx, p.id);
    assert.ok(reclaimed.recovery.actions.some(a => /no owner record/.test(a)), 'an abandoned ownerless lock is reclaimed and named');
    mkdirSync(lock); writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname(), reason: 'sync', startedAt: '2026-09-18T01:00:00.000Z' }));
    assert.throws(() => B.apply(fx, p.id), new RegExp(`process ${process.pid}`), 'a live owner keeps the lock');
    assert.ok(existsSync(lock));
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 2147483000, host: hostname(), reason: 'sync', startedAt: '2026-09-18T01:00:00.000Z' }));
    const dead = B.apply(fx, p.id);
    assert.ok(dead.recovery.actions.some(a => /2147483000/.test(a)), 'a stopped owner is named');
    mkdirSync(lock); writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 1, host: 'another-computer', reason: 'sync', startedAt: '2026-09-18T01:00:00.000Z' }));
    assert.throws(() => B.apply(fx, p.id), /another computer/);
    assert.ok(B.verify(fx).checks.some(c => c.name === 'lock' && c.state === 'blocked'));
    rmSync(lock, { recursive: true });
    writeFileSync(join(fx.home, '.selr/bridge/manifest.json.selr-4242.tmp'), '{ partial');
    writeFileSync(join(fx.home, '.selr/bridge/core/skills/notes/SKILL.md.selr-4242-abcd1234.tmp'), 'partial');
    const swept = B.apply(fx, B.plan(fx).id);
    assert.equal(existsSync(join(fx.home, '.selr/bridge/manifest.json.selr-4242.tmp')), false);
    assert.equal(existsSync(join(fx.home, '.selr/bridge/core/skills/notes/SKILL.md.selr-4242-abcd1234.tmp')), false);
    assert.ok(swept.recovery.actions.some(a => /temporary/.test(a)));
    assertComplete(fx, 'lock');
  } finally { fx.cleanup(); }
});

test('resolution, translation, project pointer and uninstall are killed at every boundary and complete on the next run', () => {
  const scenarios = [
    { label: 'resolve', seed: fx => { seedBoth(fx); B.bridge(fx); fx.write(fx.skillPath('claude', 'notes'), skill('notes', 'claude\n')['SKILL.md']); fx.write(fx.skillPath('codex', 'notes'), skill('notes', 'codex\n')['SKILL.md']); }, plan: fx => B.plan(fx, { resolve: { notes: 'codex' } }), replan: fx => B.plan(fx, { resolve: { notes: 'codex' } }), done: fx => { assert.equal(fx.readText(fx.skillPath('claude', 'notes')), skill('notes', 'codex\n')['SKILL.md']); assertComplete(fx, 'resolve'); } },
    { label: 'translate', seed: fx => { seedBoth(fx); fx.seed('claude', { commands: { plain: 'Write a summary.\n' } }); }, plan: fx => B.plan(fx), replan: fx => B.plan(fx), done: fx => { assert.ok(fx.readText(fx.skillPath('codex', 'plain'))?.includes('Write a summary.')); assertComplete(fx, 'translate'); } },
    { label: 'project', seed: fx => { seedBoth(fx); mkdirSync(join(fx.root, 'proj')); writeFileSync(join(fx.root, 'proj/AGENTS.md'), 'Rules.\n'); }, plan: fx => B.plan(fx, { projects: [join(fx.root, 'proj')] }), replan: fx => B.plan(fx, { projects: [join(fx.root, 'proj')] }), done: fx => { assert.equal(fx.readText(join(fx.root, 'proj/CLAUDE.md')), '@AGENTS.md\n'); assert.ok(fx.manifest().projects[join(fx.root, 'proj')].hash); assertComplete(fx, 'project'); } },
    { label: 'kit-update', seed: fx => { seedBoth(fx); B.bridge(fx); const newer = join(fx.root, 'kit-newer'); mkdirSync(newer); for (const part of ['scripts', 'core', 'skills', 'VERSION']) cpSync(join(REPO, part), join(newer, part), { recursive: true }); writeFileSync(join(newer, 'skills/claude-codex-bridge/SKILL.md'), readFileSync(join(REPO, 'skills/claude-codex-bridge/SKILL.md'), 'utf8') + '\nNewer kit line.\n'); }, plan: fx => B.plan(fx, { kit: join(fx.root, 'kit-newer') }), replan: fx => B.plan(fx, { kit: join(fx.root, 'kit-newer') }), done: fx => { for (const x of ['claude', 'codex']) assert.ok(fx.readText(fx.skillPath(x, 'claude-codex-bridge')).includes('Newer kit line.'), `${x} updated`); assert.ok(B.verify(fx, { kit: join(fx.root, 'kit-newer') }).healthy, B.verify(fx, { kit: join(fx.root, 'kit-newer') }).summary); assert.equal(B.plan(fx, { kit: join(fx.root, 'kit-newer') }).noop, true); } },
    { label: 'uninstall', seed: fx => { seedBoth(fx); B.bridge(fx); }, plan: fx => B.plan(fx, { intent: 'uninstall' }), replan: fx => B.plan(fx, { intent: 'uninstall' }), done: fx => { assert.equal(existsSync(join(fx.home, '.selr/bridge/manifest.json')), false); assert.equal(fx.readText(fx.instructions('claude')), 'Always call me Sam.\n'); assert.equal(fx.readText(fx.instructions('codex')), 'Always call me Sam.\n'); assert.equal(existsSync(fx.corePath('memory.mjs')), false); } },
  ];
  let passes = 0;
  for (const sc of scenarios) {
    const probe = fixtureHome(`rb-${sc.label}`);
    let boundaries;
    try { sc.seed(probe); const p = sc.plan(probe); const dry = runApply(probe, p.id); assert.equal(dry.status, 0, `${sc.label}: ${dry.stderr}`); boundaries = dry.boundaries.filter(b => b !== 'lock'); } finally { probe.cleanup(); }
    assert.ok(boundaries.length >= 2, `${sc.label}: ${boundaries.join(' ')}`);
    if (sc.label === 'resolve') assert.ok(boundaries.some(b => b.startsWith('preserve:')) && boundaries.some(b => b.startsWith('drop:') || b.includes('skill')), boundaries.join(' '));
    if (sc.label === 'uninstall') assert.ok(boundaries.some(b => b.startsWith('uninstall:')) && boundaries.some(b => b.startsWith('remove-block:')), boundaries.join(' '));
    for (const killAt of boundaries) {
      const fx = fixtureHome(`rb-${sc.label}-case`);
      try {
        sc.seed(fx);
        const p = sc.plan(fx);
        const killed = runApply(fx, p.id, killAt);
        assert.equal(killed.signal, 'SIGKILL', `${sc.label} @ ${killAt}: ${killed.stderr}`);
        const again = sc.replan(fx);
        const recovered = runApply(fx, again.id);
        assert.equal(recovered.status, 0, `${sc.label} @ ${killAt}: ${recovered.stderr}`);
        sc.done(fx);
        passes++;
      } finally { fx.cleanup(); }
    }
  }
  assert.ok(passes >= 10, `${passes} boundaries`);
});
