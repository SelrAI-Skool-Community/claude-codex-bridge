import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { B, fixtureHome, skill } from './helpers.mjs';

test('one provider is removed independently; the other keeps working; the core survives; repeats are harmless; uninstall keeps user files', () => {
  const fx = fixtureHome('removal');
  try {
    fx.seed('claude', { instructions: 'Always call me Sam.\n', skills: { notes: skill('notes'), kept: skill('kept', 'k\n', { 'examples/e.md': 'example\n' }) } });
    fx.seed('codex', { instructions: 'Codex personal.\n', files: { 'config.toml': '# personal\n' } });
    B.bridge(fx, { instructionsFrom: 'claude' });
    fx.write(fx.skillPath('claude', 'kept', 'examples/e.md'), 'Personal example.\n');
    fx.write(fx.skillPath('claude', 'kept', 'my-notes.md'), 'Personal notes.\n');
    const preview = B.plan(fx, { intent: 'remove', removeProvider: 'claude' });
    assert.ok(existsSync(fx.skillPath('claude', 'notes')), 'planning changes nothing');
    assert.equal(preview.items[0].disposition, 'claude-only');
    const { result } = B.remove(fx, 'claude');
    assert.equal(existsSync(fx.skillPath('claude', 'notes')), false, 'unchanged owned skill removed');
    assert.equal(fx.readText(fx.skillPath('claude', 'kept')), skill('kept', 'k\n')['SKILL.md'], 'a customised skill keeps its unchanged dependencies too');
    assert.equal(fx.readText(fx.skillPath('claude', 'kept', 'examples/e.md')), 'Personal example.\n');
    assert.equal(fx.readText(fx.skillPath('claude', 'kept', 'my-notes.md')), 'Personal notes.\n');
    assert.ok(result.preserved.includes('kept'));
    assert.equal(fx.readText(fx.instructions('claude')), 'Always call me Sam.\n', 'the block is gone and the personal text is exact');
    const m = fx.manifest();
    assert.equal(m.providers.claude, undefined); assert.ok(m.providers.codex.ready);
    assert.ok(existsSync(fx.corePath('skills/notes/SKILL.md')) && existsSync(fx.corePath('instructions.md')), 'the portable core survives');
    assert.ok(existsSync(fx.skillPath('codex', 'notes')), 'Codex keeps its copy');
    assert.ok(B.verify(fx).healthy, B.verify(fx).summary);
    assert.equal(fx.readText(join(fx.config('codex'), 'config.toml')), '# personal\n');
    assert.throws(() => B.plan(fx, { intent: 'remove', removeProvider: 'claude' }), /no bridge receipt/, 'repeated removal is refused harmlessly');
    // Re-adding Claude later reinstalls the shared skill without touching the customised one.
    B.bridge(fx, { provider: 'claude' });
    assert.ok(existsSync(fx.skillPath('claude', 'notes')));
    assert.equal(fx.readText(fx.skillPath('claude', 'kept', 'my-notes.md')), 'Personal notes.\n');
    // Remove the other way, then uninstall everything.
    B.remove(fx, 'codex');
    assert.equal(fx.readText(fx.instructions('codex')), 'Codex personal.\n');
    assert.ok(existsSync(fx.skillPath('codex', 'notes')) === false);
    fx.write(fx.corePath('overlays/claude.md'), '# mine\n');
    const un = B.uninstall(fx);
    assert.equal(existsSync(join(fx.home, '.selr/bridge/manifest.json')), false);
    assert.equal(existsSync(fx.corePath('memory.mjs')), false, 'unchanged bridge-owned file removed');
    assert.equal(fx.readText(fx.corePath('overlays/claude.md')), '# mine\n', 'a customised overlay stays');
    assert.equal(existsSync(fx.corePath('overlays/codex.md')), false);
    assert.ok(existsSync(fx.corePath('instructions.md')), 'portable instructions are yours');
    assert.equal(existsSync(fx.corePath('skills/notes')), false, 'unchanged core skill copies are removed');
    assert.equal(fx.readText(fx.instructions('claude')), 'Always call me Sam.\n');
    assert.ok(existsSync(fx.skillPath('claude', 'kept', 'my-notes.md')));
    assert.match(un.result.summary, /uninstalled/);
    assert.equal(B.verify(fx).healthy, false);
  } finally { fx.cleanup(); }
});
