import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, mkdirSync, rmSync, statSync, chmodSync, cpSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { B, fixtureHome, item, ops, skill } from './helpers.mjs';

test('Claude-only to both: the portable core is seeded from Claude and Codex joins later without touching Claude', () => {
  const fx = fixtureHome('claude-only');
  try {
    fx.seed('claude', { instructions: 'Always call me Sam.\n', skills: { notes: skill('notes') } });
    const first = B.plan(fx);
    assert.equal(item(first, 'instructions:portable').source, fx.instructions('claude'));
    assert.equal(item(first, 'skill:notes').disposition, 'shared');
    assert.ok(!ops(first).includes('adapter:codex'));
    const result = B.apply(fx, first.id);
    assert.equal(result.applied, true);
    assert.equal(fx.readText(fx.corePath('instructions.md')), 'Always call me Sam.\n');
    assert.ok(fx.readText(fx.instructions('claude')).startsWith('Always call me Sam.\n'), 'unrelated Claude instructions preserved');
    assert.equal(existsSync(fx.config('codex')), false, 'Codex is never created by a Claude-only bridge');
    assert.ok(B.verify(fx).healthy, B.verify(fx).summary);
    // Codex arrives with its own instructions.
    fx.seed('codex', { instructions: 'Codex personal.\n' });
    const second = B.bridge(fx, { provider: 'codex' });
    assert.ok(second.plan.items.every(i => i.id !== 'instructions:portable'), 'the portable instructions are seeded once');
    assert.ok(fx.readText(fx.instructions('codex')).startsWith('Codex personal.\n'));
    assert.ok(fx.readText(fx.instructions('codex')).includes('overlays/codex.md') && !fx.readText(fx.instructions('codex')).includes('overlays/claude.md'), 'Codex reads only its own overlay');
    assert.equal(fx.readText(fx.skillPath('codex', 'notes')), fx.readText(fx.skillPath('claude', 'notes')), 'the shared skill is now in Codex');
    const m = fx.manifest();
    assert.ok(m.providers.claude.ready && m.providers.codex.ready);
    assert.ok(m.core.skills.notes.files['SKILL.md'], 'baseline recorded');
    assert.ok(B.verify(fx).healthy, B.verify(fx).summary);
  } finally { fx.cleanup(); }
});

test('Codex-only to both mirrors the Claude-only path, using AGENTS.override.md when it is active', () => {
  const fx = fixtureHome('codex-only');
  try {
    fx.seed('codex', { instructions: 'Inactive.\n', skills: { drafts: skill('drafts') }, files: { 'AGENTS.override.md': 'Active override.\n', 'config.toml': '# personal\n' } });
    const { plan: p } = B.bridge(fx, { provider: 'codex' });
    assert.equal(item(p, 'instructions:portable').source, join(fx.config('codex'), 'AGENTS.override.md'));
    assert.equal(fx.readText(join(fx.config('codex'), 'AGENTS.md')), 'Inactive.\n', 'the inactive file is untouched');
    assert.ok(fx.readText(join(fx.config('codex'), 'AGENTS.override.md')).startsWith('Active override.\n'));
    assert.ok(fx.readText(join(fx.config('codex'), 'AGENTS.override.md')).includes('<!-- selr-bridge:begin -->'));
    assert.equal(fx.readText(join(fx.config('codex'), 'config.toml')), '# personal\n');
    assert.equal(item(p, 'settings:codex').disposition, 'codex-only');
    fx.seed('claude', {});
    B.bridge(fx, { provider: 'claude' });
    assert.equal(fx.readText(fx.skillPath('claude', 'drafts')), fx.readText(fx.skillPath('codex', 'drafts')));
    assert.ok(fx.readText(fx.instructions('claude')).includes('overlays/claude.md'));
    assert.ok(B.verify(fx).healthy);
  } finally { fx.cleanup(); }
});

test('both unmanaged to managed: equal twins are shared, differing twins conflict until chosen, and re-running is a no-op', () => {
  const fx = fixtureHome('both');
  try {
    fx.seed('claude', { instructions: 'Same everywhere.\n', skills: { same: skill('same'), twin: skill('twin', 'Claude flavour.\n') } });
    fx.seed('codex', { instructions: 'Same everywhere.\n', skills: { same: skill('same'), twin: skill('twin', 'Codex flavour.\n') } });
    const p = B.plan(fx);
    assert.equal(item(p, 'instructions:portable').collision, 'none', 'identical instructions need no choice');
    assert.equal(item(p, 'skill:same').collision, 'equal');
    assert.equal(item(p, 'skill:twin').collision, 'conflict');
    assert.ok(p.conflicts.includes('skill:twin'));
    assert.ok(!p.operations.some(o => o.name === 'twin'), 'nothing is written for a conflicted twin');
    B.apply(fx, p.id);
    assert.equal(fx.readText(fx.skillPath('codex', 'twin')), skill('twin', 'Codex flavour.\n')['SKILL.md'], 'the conflicted Codex copy is untouched');
    const chosen = B.plan(fx, { resolve: { twin: 'claude' } });
    assert.deepEqual(ops(chosen).filter(o => o !== 'adapter'), ['preserve-candidate', 'replace-unowned-skill', 'share-skill']);
    const result = B.apply(fx, chosen.id);
    assert.equal(result.candidates.length, 1, 'the losing copy is preserved before replacement');
    assert.equal(readFileSync(join(result.candidates[0], 'SKILL.md'), 'utf8'), skill('twin', 'Codex flavour.\n')['SKILL.md']);
    assert.equal(fx.readText(fx.skillPath('codex', 'twin')), skill('twin', 'Claude flavour.\n')['SKILL.md']);
    const again = B.plan(fx);
    assert.equal(again.noop, true, again.summary.join(' '));
    const before = JSON.stringify(fx.manifest());
    const repeat = B.apply(fx, again.id);
    assert.equal(repeat.noop, true);
    const after = fx.manifest(); delete after.lastPlan; const b = JSON.parse(before); delete b.lastPlan;
    assert.deepEqual(after, b, 'the receipt is stable across a no-op');
    assert.ok(B.verify(fx).healthy);
  } finally { fx.cleanup(); }
});

test('differing global instructions need an explicit seed choice; the unchosen file is still preserved', () => {
  const fx = fixtureHome('seed');
  try {
    fx.seed('claude', { instructions: 'Claude words.\n' });
    fx.seed('codex', { instructions: 'Codex words.\n' });
    const p = B.plan(fx);
    assert.equal(item(p, 'instructions:portable').collision, 'conflict');
    assert.ok(!ops(p).includes('seed-instructions'));
    B.apply(fx, p.id);
    assert.equal(existsSync(fx.corePath('instructions.md')), false);
    const chosen = B.plan(fx, { instructionsFrom: 'codex' });
    B.apply(fx, chosen.id);
    assert.equal(fx.readText(fx.corePath('instructions.md')), 'Codex words.\n');
    assert.ok(fx.readText(fx.instructions('claude')).startsWith('Claude words.\n'));
    const none = fixtureHome('seed-none');
    try {
      none.seed('claude', { instructions: 'A.\n' }); none.seed('codex', { instructions: 'B.\n' });
      B.bridge(none, { instructionsFrom: 'none' });
      assert.ok(none.readText(none.corePath('instructions.md')).startsWith('# Portable instructions'));
    } finally { none.cleanup(); }
  } finally { fx.cleanup(); }
});

test('one-sided change in each direction is promoted; equal two-sided change is accepted once', () => {
  const fx = fixtureHome('sync');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { notes: skill('notes', 'v1\n', { 'ref/a.md': 'a\n' }) } });
    fx.seed('codex', { instructions: 'Hi.\n' });
    B.bridge(fx);
    fx.write(fx.skillPath('codex', 'notes'), skill('notes', 'v2 from codex\n')['SKILL.md']);
    fx.write(fx.skillPath('codex', 'notes', 'ref/b.md'), 'b\n');
    let s = B.status(fx);
    assert.equal(s.changed[0].decision, 'promote'); assert.equal(s.changed[0].from, 'codex');
    let p = B.plan(fx, { provider: 'codex' });
    assert.equal(p.operations.find(o => o.op === 'promote-skill').from, 'codex');
    B.apply(fx, p.id);
    assert.equal(fx.readText(fx.skillPath('claude', 'notes')), skill('notes', 'v2 from codex\n')['SKILL.md']);
    assert.equal(fx.readText(fx.skillPath('claude', 'notes', 'ref/b.md')), 'b\n');
    assert.equal(fx.readText(fx.corePath('skills/notes/ref/b.md')), 'b\n');
    assert.ok(B.verify(fx).healthy, B.verify(fx).summary);
    // The other direction, including a file removed on the changed side.
    fx.write(fx.skillPath('claude', 'notes'), skill('notes', 'v3 from claude\n')['SKILL.md']);
    rmSync(fx.skillPath('claude', 'notes', 'ref/a.md'));
    p = B.plan(fx);
    B.apply(fx, p.id);
    assert.equal(fx.readText(fx.skillPath('codex', 'notes')), skill('notes', 'v3 from claude\n')['SKILL.md']);
    assert.equal(existsSync(fx.skillPath('codex', 'notes', 'ref/a.md')), false, 'a removal on the changed side follows');
    assert.equal(existsSync(fx.corePath('skills/notes/ref/a.md')), false);
    assert.ok(B.verify(fx).healthy, B.verify(fx).summary);
    // Equal changes on both sides.
    for (const provider of ['claude', 'codex']) fx.write(fx.skillPath(provider, 'notes'), skill('notes', 'v4 both\n')['SKILL.md']);
    p = B.plan(fx);
    assert.ok(ops(p).includes('accept-both'));
    B.apply(fx, p.id);
    assert.equal(fx.readText(fx.corePath('skills/notes/SKILL.md')), skill('notes', 'v4 both\n')['SKILL.md']);
    assert.equal(B.plan(fx).noop, true);
    // An edit made directly to the portable copy flows to both providers.
    fx.write(fx.corePath('skills/notes/SKILL.md'), skill('notes', 'v5 core\n')['SKILL.md']);
    p = B.plan(fx);
    assert.equal(p.operations.find(o => o.op === 'promote-skill').from, 'core');
    B.apply(fx, p.id);
    assert.equal(fx.readText(fx.skillPath('codex', 'notes')), skill('notes', 'v5 core\n')['SKILL.md']);
    assert.ok(B.verify(fx).healthy);
  } finally { fx.cleanup(); }
});

test('divergent edits, edit-versus-delete and independent core edits are conflicts with every candidate preserved', () => {
  const fx = fixtureHome('conflict');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { notes: skill('notes', 'base\n') } });
    fx.seed('codex', { instructions: 'Hi.\n' });
    B.bridge(fx);
    fx.write(fx.skillPath('claude', 'notes'), skill('notes', 'claude\n')['SKILL.md']);
    fx.write(fx.skillPath('codex', 'notes'), skill('notes', 'codex\n')['SKILL.md']);
    let p = B.plan(fx);
    assert.ok(p.conflicts.includes('sync:notes'));
    assert.ok(!p.operations.some(o => o.name === 'notes'));
    assert.equal(B.status(fx).conflicted[0].name, 'notes');
    assert.equal(B.verify(fx).checks.find(c => c.name === 'shared:notes').state, 'conflicted');
    B.apply(fx, p.id);
    assert.equal(fx.readText(fx.skillPath('codex', 'notes')), skill('notes', 'codex\n')['SKILL.md'], 'nothing overwritten');
    // Choosing Codex: the Claude and core candidates are preserved first.
    p = B.plan(fx, { resolve: { notes: 'codex' } });
    const result = B.apply(fx, p.id);
    assert.equal(result.candidates.length, 2);
    assert.ok(result.candidates.some(c => c.includes('/claude-') && readFileSync(join(c, 'SKILL.md'), 'utf8').includes('claude')));
    assert.equal(fx.readText(fx.skillPath('claude', 'notes')), skill('notes', 'codex\n')['SKILL.md']);
    assert.ok(B.verify(fx).checks.some(c => c.name === 'candidates:notes' && c.state === 'unknown'), 'preserved candidates are reported until deleted');
    // Edit versus delete.
    fx.write(fx.skillPath('claude', 'notes'), skill('notes', 'edited after\n')['SKILL.md']);
    rmSync(join(fx.skillRoot('codex'), 'notes'), { recursive: true });
    p = B.plan(fx);
    assert.ok(p.conflicts.includes('sync:notes'), 'delete versus edit is a conflict');
    assert.match(item(p, 'sync:notes').reason, /removed this skill while the other edited/);
    // Keep separate: both sides keep what they have and the bridge stops managing it.
    p = B.plan(fx, { resolve: { notes: 'keep-separate' } });
    B.apply(fx, p.id);
    assert.equal(fx.manifest().core.skills.notes, undefined);
    assert.equal(fx.readText(fx.skillPath('claude', 'notes')), skill('notes', 'edited after\n')['SKILL.md']);
    // Core edited while a provider also changed.
    const fy = fixtureHome('core-conflict');
    try {
      fy.seed('claude', { instructions: 'Hi.\n', skills: { k: skill('k', 'base\n') } }); fy.seed('codex', { instructions: 'Hi.\n' });
      B.bridge(fy);
      fy.write(fy.corePath('skills/k/SKILL.md'), skill('k', 'core edit\n')['SKILL.md']);
      fy.write(fy.skillPath('codex', 'k'), skill('k', 'codex edit\n')['SKILL.md']);
      const q = B.plan(fy);
      assert.ok(q.conflicts.includes('sync:k'));
      const r = B.plan(fy, { resolve: { k: 'core' } });
      B.apply(fy, r.id);
      assert.equal(fy.readText(fy.skillPath('codex', 'k')), skill('k', 'core edit\n')['SKILL.md']);
      assert.equal(fy.readText(fy.skillPath('claude', 'k')), skill('k', 'core edit\n')['SKILL.md']);
    } finally { fy.cleanup(); }
  } finally { fx.cleanup(); }
});

test('a deletion on one side with the other unchanged is promoted, keeping customised files', () => {
  const fx = fixtureHome('delete');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { gone: skill('gone'), mine: skill('mine') } });
    fx.seed('codex', { instructions: 'Hi.\n' });
    B.bridge(fx);
    rmSync(join(fx.skillRoot('codex'), 'gone'), { recursive: true });
    rmSync(join(fx.skillRoot('claude'), 'mine'), { recursive: true });
    fx.write(fx.skillPath('codex', 'mine', 'personal.md'), 'my note\n');
    const p = B.plan(fx);
    assert.deepEqual(p.operations.filter(o => o.op === 'retire-shared-skill').map(o => o.name), ['gone'], 'a plain deletion with the other side unchanged is promoted');
    assert.ok(p.conflicts.includes('sync:mine'), 'a deletion against a user-added file is delete-versus-edit, so it is a conflict');
    B.apply(fx, p.id);
    assert.equal(existsSync(join(fx.skillRoot('claude'), 'gone')), false);
    assert.equal(existsSync(fx.corePath('skills/gone')), false);
    assert.equal(fx.readText(fx.skillPath('codex', 'mine', 'personal.md')), 'my note\n', 'the user-added file is untouched');
    assert.equal(fx.manifest().core.skills.gone, undefined);
    assert.ok(fx.manifest().core.skills.mine, 'the conflicted skill stays managed until chosen');
    // Choosing the surviving copy brings it back to Claude, user-added file included.
    B.apply(fx, B.plan(fx, { resolve: { mine: 'codex' } }).id);
    assert.equal(fx.readText(fx.skillPath('claude', 'mine', 'personal.md')), 'my note\n');
    assert.ok(B.verify(fx).healthy, B.verify(fx).summary);
  } finally { fx.cleanup(); }
});

test('provider-specific, unsupported and translated artefacts are called out, never silently skipped', () => {
  const fx = fixtureHome('dispositions');
  try {
    fx.seed('claude', {
      instructions: 'Hi.\n',
      skills: { portable: skill('portable', 'Plain.\n'), claudey: skill('claudey', 'Use mcp__linear__get_issue.\n'), secretive: skill('secretive', 'api_key = "sk_live_ABCDEFGHIJKLMNOP123"\n'), sub: skill('sub', 'Fine.\n', { 'scripts/run.sh': '#!/bin/sh\necho ok\n' }) },
      commands: { plain: '---\ndescription: Summarise the day.\n---\nWrite a summary.\n', args: 'Review $ARGUMENTS carefully.\n', shelly: 'Run !`git status` first.\n' },
      files: { 'settings.json': JSON.stringify({ hooks: { PreToolUse: [] } }), 'agents/helper.md': '---\nname: helper\n---\nHelp.\n', 'projects/x/session.jsonl': '{}\n', '.credentials.json': '{"claudeAiOauth":{}}\n' },
    });
    fx.seed('codex', { instructions: 'Hi.\n', skills: { codexy: skill('codexy', 'Set model_reasoning_effort high.\n') }, files: { 'sessions/1.jsonl': '{}\n', 'auth.json': '{"tokens":{}}\n', 'agents/e.toml': 'name = "e"\n' } });
    mkdirSync(join(fx.skillRoot('claude'), 'linked'), { recursive: true });
    symlinkSync(join(fx.skillRoot('claude'), 'portable/SKILL.md'), join(fx.skillRoot('claude'), 'linked/SKILL.md'));
    const p = B.plan(fx);
    const d = id => item(p, id).disposition;
    assert.equal(d('skill:portable'), 'shared'); assert.equal(d('skill:sub'), 'shared');
    assert.equal(d('skill:claude/claudey'), 'claude-only'); assert.match(item(p, 'skill:claude/claudey').reason, /assumes claude/);
    assert.equal(d('skill:codex/codexy'), 'codex-only');
    assert.equal(d('skill:claude/secretive'), 'unsupported'); assert.match(item(p, 'skill:claude/secretive').userAction, /Remove the secret/);
    assert.ok(!JSON.stringify(p).includes('sk_live_ABCDEFGHIJKLMNOP123'), 'the secret never appears in the plan');
    assert.equal(d('skill:claude/linked'), 'claude-only'); assert.match(item(p, 'skill:claude/linked').reason, /link/);
    assert.equal(d('command:claude/plain'), 'translated'); assert.equal(item(p, 'command:claude/plain').translator, 'claude-command-to-skill');
    assert.equal(d('command:claude/args'), 'claude-only'); assert.match(item(p, 'command:claude/args').reason, /arguments/);
    assert.equal(d('command:claude/shelly'), 'claude-only'); assert.match(item(p, 'command:claude/shelly').reason, /shell/);
    assert.equal(d('subagent:claude/helper'), 'claude-only'); assert.equal(d('subagent:codex/e'), 'codex-only');
    assert.equal(d('hooks:claude'), 'claude-only'); assert.equal(d('settings:claude'), 'claude-only');
    assert.equal(d('private:claude/transcripts'), 'unsupported'); assert.equal(d('private:codex/sessions'), 'unsupported');
    assert.equal(d('credentials:claude'), 'unsupported'); assert.equal(d('credentials:codex'), 'unsupported');
    for (const it of p.items) { assert.ok(it.reason, `${it.id} has a reason`); assert.ok(['shared', 'claude-only', 'codex-only', 'translated', 'unsupported'].includes(it.disposition)); }
    const result = B.apply(fx, p.id);
    assert.equal(fx.readText(fx.skillPath('codex', 'plain')).includes('Write a summary.'), true, 'the translated command is a skill in Codex');
    assert.equal(fx.readText(fx.skillPath('claude', 'plain')).startsWith('---\nname: plain\ndescription: Summarise the day.'), true);
    assert.ok(existsSync(join(fx.config('claude'), 'commands/plain.md')), 'the original command stays');
    assert.equal(existsSync(fx.skillPath('codex', 'claudey')), false, 'provider-specific skills stay where they work');
    assert.equal(existsSync(fx.skillPath('codex', 'secretive')), false);
    if (process.platform !== 'win32') assert.equal(statSync(fx.skillPath('codex', 'sub', 'scripts/run.sh')).mode & 0o111, 0, 'a mode the source did not carry is not invented');
    assert.ok(!JSON.stringify(result).includes('sk_live_'));
    const s = B.status(fx);
    assert.ok(s.unsupported.some(u => u.name === 'claude/secretive'));
    assert.ok(s.providerSpecific.some(u => u.name === 'claude/claudey'));
  } finally { fx.cleanup(); }
});

test('executable modes are carried across when the source has them; nested directories and user-added files survive updates', () => {
  const fx = fixtureHome('modes');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { tool: skill('tool', 'Run scripts/go.sh.\n', { 'scripts/go.sh': '#!/bin/sh\necho go\n', 'deep/er/file.txt': 'x\n' }) } });
    chmodSync(fx.skillPath('claude', 'tool', 'scripts/go.sh'), 0o755);
    fx.seed('codex', { instructions: 'Hi.\n' });
    B.bridge(fx);
    if (process.platform !== 'win32') assert.equal(statSync(fx.skillPath('codex', 'tool', 'scripts/go.sh')).mode & 0o111, 0o111);
    assert.equal(fx.readText(fx.skillPath('codex', 'tool', 'deep/er/file.txt')), 'x\n');
    fx.write(fx.skillPath('codex', 'tool', 'my-notes.md'), 'mine\n');
    let p = B.plan(fx);
    assert.equal(p.operations.find(o => o.op === 'promote-skill')?.from, 'codex', 'a user-added file is a one-sided change and travels');
    B.apply(fx, p.id);
    assert.equal(fx.readText(fx.skillPath('claude', 'tool', 'my-notes.md')), 'mine\n');
    fx.write(fx.skillPath('claude', 'tool'), skill('tool', 'Run scripts/go.sh now.\n')['SKILL.md']);
    fx.write(fx.skillPath('codex', 'tool', 'more.md'), 'more\n');
    p = B.plan(fx);
    assert.ok(p.conflicts.includes('sync:tool'), 'an edit on one side and an added file on the other is a conflict');
    B.apply(fx, p.id);
    assert.equal(fx.readText(fx.skillPath('codex', 'tool', 'more.md')), 'more\n');
    assert.equal(fx.readText(fx.skillPath('claude', 'tool')), skill('tool', 'Run scripts/go.sh now.\n')['SKILL.md']);
  } finally { fx.cleanup(); }
});

test('ambiguous markers stop the write; a customised block is never replaced; another profile is refused', () => {
  const fx = fixtureHome('markers');
  try {
    fx.seed('claude', { instructions: 'Personal.\n<!-- selr-bridge:begin -->\nPersonal tail.\n' });
    const p = B.plan(fx);
    assert.equal(item(p, 'instruction-block:claude').disposition, 'unsupported');
    assert.ok(p.conflicts.includes('instruction-block:claude'));
    B.apply(fx, p.id);
    assert.ok(fx.readText(fx.instructions('claude')).endsWith('Personal tail.\n'));
    assert.equal(fx.manifest().providers.claude?.ready, undefined);
    fx.write(fx.instructions('claude'), 'Personal.\n');
    B.bridge(fx);
    const edited = fx.readText(fx.instructions('claude')).replace('Current provider: claude.', 'Current provider: claude. My own note.');
    fx.write(fx.instructions('claude'), edited);
    const again = B.plan(fx);
    assert.throws(() => B.apply(fx, again.id), /customised or has no ownership receipt/);
    assert.equal(fx.readText(fx.instructions('claude')), edited);
    assert.equal(fx.manifest().providers.claude.ready, false, 'a failed update cannot stay ready');
    assert.equal(fx.manifest().pending?.planId, again.id, 'the stopped run is recorded for resumption');
    fx.write(fx.instructions('claude'), fx.readText(fx.instructions('claude')).replace(' My own note.', ''));
    const fixed = B.plan(fx);
    const r = B.apply(fx, fixed.id);
    assert.ok(r.recovery, 'the earlier blocked run is reported as continued');
    assert.ok(B.verify(fx).healthy, B.verify(fx).summary);
  } finally { fx.cleanup(); }
});

test('neither provider present stops with guidance; a custom provider home is honoured', () => {
  const fx = fixtureHome('none');
  try {
    assert.throws(() => B.plan(fx), /Neither Claude Code nor Codex/);
    const custom = join(fx.root, 'active-claude');
    mkdirSync(custom, { recursive: true });
    writeFileSync(join(custom, 'CLAUDE.md'), 'Custom home.\n');
    const { result } = B.bridge(fx, { providerHomes: { claude: custom } });
    assert.equal(result.providers.claude.instructions, join(custom, 'CLAUDE.md'));
    assert.equal(existsSync(join(fx.home, '.claude')), false);
    assert.ok(B.verify(fx, { providerHomes: { claude: custom } }).healthy);
    assert.ok(B.verify(fx).healthy, 'the receipt remembers the custom home');
  } finally { fx.cleanup(); }
});

test('a kit update refreshes unchanged bridge-owned core files and keeps customised overlays and contracts', () => {
  const fx = fixtureHome('update');
  try {
    fx.seed('claude', { instructions: 'Hi.\n' });
    B.bridge(fx);
    const overlay = fx.corePath('overlays/claude.md');
    fx.write(overlay, '# My routing\n');
    const newer = join(fx.root, 'kit-newer');
    mkdirSync(newer);
    for (const part of ['scripts', 'core', 'VERSION']) cpSync(join(process.cwd(), part), join(newer, part), { recursive: true });
    appendFileSync(join(newer, 'core/knowledge-contract.md'), '\nNewer contract line.\n');
    appendFileSync(join(newer, 'core/overlays/claude.md'), '\nNewer overlay line.\n');
    writeFileSync(join(newer, 'VERSION'), '9.9.9\n');
    const p = B.plan(fx, { kit: newer });
    assert.equal(item(p, 'core:overlay:claude').collision, 'customised');
    B.apply(fx, p.id);
    assert.equal(fx.readText(overlay), '# My routing\n', 'a customised overlay survives the update');
    assert.ok(fx.readText(fx.corePath('knowledge-contract.md')).includes('Newer contract line.'));
    assert.equal(fx.manifest().kit.version, 'file:9.9.9');
    assert.ok(fx.readText(fx.instructions('claude')).includes(`Kit home: ${newer}`));
    assert.ok(B.verify(fx, { kit: newer }).checks.find(c => c.name === 'core:contract').state === 'confirmed');
  } finally { fx.cleanup(); }
});
