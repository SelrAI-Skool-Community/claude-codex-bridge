import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { B, fixtureHome, skill } from './helpers.mjs';
import { hash, safePath, save } from '../scripts/bridge-files.mjs';
import { retireSkill } from '../scripts/bridge-skills.mjs';

test('writes through symlinked parents are refused; a linked shared root leaves everything unchanged', () => {
  const fx = fixtureHome('symlink');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { notes: skill('notes') } });
    const elsewhere = join(fx.root, 'elsewhere'); mkdirSync(elsewhere);
    mkdirSync(join(fx.home, '.selr')); symlinkSync(elsewhere, join(fx.home, '.selr/bridge'));
    assert.throws(() => { const p = B.plan(fx); B.apply(fx, p.id); }, /Linked path left unchanged/);
    assert.equal(existsSync(join(elsewhere, 'manifest.json')), false);
    assert.equal(fx.readText(fx.instructions('claude')), 'Hi.\n');
    rmSync(join(fx.home, '.selr/bridge'));
    // A linked skill root on the provider side is refused too.
    fx.seed('codex', { instructions: 'Hi.\n' });
    mkdirSync(join(fx.home, '.agents')); symlinkSync(elsewhere, join(fx.home, '.agents/skills'));
    const p = B.plan(fx);
    assert.throws(() => B.apply(fx, p.id), /Linked path left unchanged/);
    assert.equal(existsSync(join(elsewhere, 'notes')), false);
    assert.throws(() => safePath(join(fx.home, '.agents/skills/x')), /Linked/);
    assert.throws(() => save(join(fx.home, '.agents/skills/x'), 'x'));
  } finally { fx.cleanup(); }
});

test('malformed receipts, forged ownership and path traversal in receipts are refused; identical bytes are not ownership', () => {
  const fx = fixtureHome('forge');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { notes: skill('notes') } });
    fx.seed('codex', { instructions: 'Hi.\n' });
    B.bridge(fx);
    const manifestPath = join(fx.home, '.selr/bridge/manifest.json');
    const good = readFileSync(manifestPath, 'utf8');
    writeFileSync(manifestPath, '{"schema":1,"owner":"someone-else","providers":{},"core":{}}');
    assert.throws(() => B.plan(fx), /Unrecognised bridge receipt/);
    writeFileSync(manifestPath, '{ not json');
    assert.throws(() => B.plan(fx), /unreadable/);
    writeFileSync(manifestPath, good);
    // Traversal: a receipt naming a skill outside its root is refused by retirement.
    const m = JSON.parse(good);
    const receipt = m.providers.claude;
    receipt.skills['../../escape'] = { files: { 'SKILL.md': hash('x') } };
    assert.throws(() => retireSkill({ name: '../../escape', skillRoot: receipt.skillRoot, receipt, persist: () => {}, kept: [] }), /Invalid owned skill path/);
    receipt.skills.notes.files['../../../CLAUDE.md'] = hash(fx.readText(fx.instructions('claude')));
    delete receipt.skills['../../escape'];
    assert.throws(() => retireSkill({ name: 'notes', skillRoot: receipt.skillRoot, receipt, persist: () => {}, kept: [] }), /Invalid owned file path/);
    assert.ok(fx.readText(fx.instructions('claude')).includes('selr-bridge:begin'), 'nothing outside the root was touched');
    // Forged ownership: a hash in the receipt that does not match the file keeps the file.
    const forged = JSON.parse(good);
    forged.providers.codex.skills.notes.files['SKILL.md'] = hash('not what is there');
    writeFileSync(manifestPath, JSON.stringify(forged));
    const { result } = B.remove(fx, 'codex');
    assert.ok(existsSync(fx.skillPath('codex', 'notes')), 'a file whose hash disagrees with its receipt is preserved');
    assert.ok(result.preserved.includes('notes'));
    // Identical bytes are not ownership: an unowned pre-existing copy is never overwritten or removed.
    const fy = fixtureHome('identical');
    try {
      fy.seed('claude', { instructions: 'Hi.\n', skills: { twin: skill('twin') } });
      fy.seed('codex', { instructions: 'Hi.\n', skills: { twin: skill('twin') } });
      const p = B.plan(fy);
      assert.equal(p.items.find(i => i.id === 'skill:twin').collision, 'equal');
      B.apply(fy, p.id);
      assert.ok(fy.manifest().providers.codex.skills.twin, 'an equal twin becomes owned through the plan, with its intent recorded');
      fy.write(fy.skillPath('codex', 'twin'), skill('twin', 'changed later\n')['SKILL.md']);
      fy.write(fy.skillPath('claude', 'twin'), skill('twin', 'changed differently\n')['SKILL.md']);
      assert.ok(B.plan(fy).conflicts.includes('sync:twin'));
    } finally { fy.cleanup(); }
  } finally { fx.cleanup(); }
});

test('a stale plan is refused once its sources change; deletion never reaches outside an owned root', () => {
  const fx = fixtureHome('stale');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { notes: skill('notes') } });
    fx.seed('codex', { instructions: 'Hi.\n' });
    const p = B.plan(fx);
    fx.write(fx.skillPath('claude', 'notes'), skill('notes', 'edited after planning\n')['SKILL.md']);
    assert.throws(() => B.apply(fx, p.id), /plan is stale/);
    assert.equal(existsSync(fx.corePath('skills/notes')), false);
    assert.throws(() => B.apply(fx, 'nonexistent'), /Unknown plan id/);
    const fresh = B.plan(fx);
    B.apply(fx, fresh.id);
    assert.equal(fx.readText(fx.skillPath('codex', 'notes')), skill('notes', 'edited after planning\n')['SKILL.md']);
    // A plan made for another home is refused.
    const other = fixtureHome('other');
    try { other.seed('claude', { instructions: 'x\n' }); const q = B.plan(other); assert.throws(() => B.apply(fx, q.id), /Unknown plan id|different home/); } finally { other.cleanup(); }
    // Permissions: bridge-written files are private to the user where the platform supports modes.
    if (process.platform !== 'win32') { const { statSync } = fsModule(); assert.equal(statSync(join(fx.home, '.selr/bridge/manifest.json')).mode & 0o077, 0); }
  } finally { fx.cleanup(); }
});
import * as fsNs from 'node:fs';
function fsModule() { return fsNs; }
