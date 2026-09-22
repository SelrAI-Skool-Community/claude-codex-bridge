// Behaviours the spec names that the first suites did not exercise directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { B, REPO, fixtureHome, item, ops, skill } from './helpers.mjs';

const both = fx => { fx.seed('claude', { instructions: 'Hi.\n' }); fx.seed('codex', { instructions: 'Hi.\n' }); };

test('selected-project instructions: AGENTS.md is portable and Claude gets a bridge-owned pointer; other shapes are called out', () => {
  const fx = fixtureHome('projects');
  try {
    both(fx);
    const agentsOnly = join(fx.root, 'p-agents'), claudeOnly = join(fx.root, 'p-claude'), bothFiles = join(fx.root, 'p-both'), pointer = join(fx.root, 'p-pointer'), empty = join(fx.root, 'p-empty');
    for (const d of [agentsOnly, claudeOnly, bothFiles, pointer, empty]) mkdirSync(d);
    writeFileSync(join(agentsOnly, 'AGENTS.md'), 'Project rules.\n');
    writeFileSync(join(claudeOnly, 'CLAUDE.md'), 'Claude project rules.\n');
    writeFileSync(join(bothFiles, 'AGENTS.md'), 'A\n'); writeFileSync(join(bothFiles, 'CLAUDE.md'), 'B\n');
    writeFileSync(join(pointer, 'AGENTS.md'), 'A\n'); writeFileSync(join(pointer, 'CLAUDE.md'), '@AGENTS.md\n');
    const projects = [agentsOnly, claudeOnly, bothFiles, pointer, empty];
    const p = B.plan(fx, { projects });
    assert.equal(item(p, `project:${agentsOnly}`).disposition, 'translated');
    assert.equal(item(p, `project:${claudeOnly}`).disposition, 'claude-only'); assert.match(item(p, `project:${claudeOnly}`).userAction, /Rename/);
    assert.equal(item(p, `project:${bothFiles}`).disposition, 'unsupported'); assert.equal(item(p, `project:${bothFiles}`).collision, 'both-exist');
    assert.equal(item(p, `project:${pointer}`).disposition, 'translated'); assert.equal(item(p, `project:${pointer}`).already, true);
    assert.equal(item(p, `project:${empty}`).disposition, 'unsupported');
    B.apply(fx, p.id);
    assert.equal(readFileSync(join(agentsOnly, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
    assert.equal(readFileSync(join(agentsOnly, 'AGENTS.md'), 'utf8'), 'Project rules.\n', 'the portable file is untouched');
    assert.equal(existsSync(join(claudeOnly, 'AGENTS.md')), false); assert.equal(readFileSync(join(bothFiles, 'CLAUDE.md'), 'utf8'), 'B\n');
    const m = fx.manifest();
    assert.ok(m.projects[agentsOnly].hash && m.projects[pointer].adoptedAt, 'an existing pointer is adopted, a new one owned');
    const v = B.verify(fx);
    assert.ok(v.checks.some(c => c.name === `project:${agentsOnly}` && c.state === 'confirmed'), v.summary);
    assert.equal(B.plan(fx).noop, true, 'remembered projects are re-checked without the option and need nothing');
    writeFileSync(join(pointer, 'CLAUDE.md'), '@AGENTS.md\nMy extra line.\n');
    assert.equal(B.verify(fx).checks.find(c => c.name === `project:${pointer}`).state, 'blocked');
    assert.equal(item(B.plan(fx), `project:${pointer}`).collision, 'customised');
    B.uninstall(fx);
    assert.equal(existsSync(join(agentsOnly, 'CLAUDE.md')), false, 'an unchanged owned pointer goes with the bridge');
    assert.equal(readFileSync(join(pointer, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\nMy extra line.\n', 'a customised pointer stays');
  } finally { fx.cleanup(); }
});

test('Codex prompts translate to skills by the codex-command-to-skill translator, and selection options narrow sharing', () => {
  const fx = fixtureHome('codex-prompts');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { a: skill('a'), b: skill('b'), c: skill('c') } });
    fx.seed('codex', { instructions: 'Hi.\n', commands: { daily: '---\ndescription: Daily plan.\n---\nPlan the day.\n', argsy: 'Handle $1 now.\n' } });
    const p = B.plan(fx, { only: ['a', 'daily'], skip: ['b'] });
    assert.equal(item(p, 'command:codex/daily').disposition, 'translated'); assert.equal(item(p, 'command:codex/daily').translator, 'codex-command-to-skill');
    assert.equal(item(p, 'command:codex/argsy').disposition, 'codex-only');
    assert.equal(item(p, 'skill:a').disposition, 'shared');
    assert.equal(item(p, 'skill:claude/b').disposition, 'claude-only'); assert.match(item(p, 'skill:claude/b').reason, /provider-specific/);
    assert.equal(item(p, 'skill:claude/c').disposition, 'claude-only'); assert.match(item(p, 'skill:claude/c').reason, /Not in the selection/);
    B.apply(fx, p.id);
    assert.ok(readFileSync(fx.skillPath('claude', 'daily'), 'utf8').includes('Plan the day.'));
    assert.ok(readFileSync(fx.skillPath('claude', 'daily'), 'utf8').includes('codex-command-to-skill'));
    assert.equal(existsSync(fx.skillPath('codex', 'b')), false); assert.equal(existsSync(fx.skillPath('codex', 'c')), false);
    assert.equal(existsSync(join(fx.config('codex'), 'prompts/daily.md')), true, 'the original prompt stays');
    assert.equal(B.plan(fx, { only: ['a', 'daily'], skip: ['b'] }).noop, true, 'a translated prompt is not translated twice');
  } finally { fx.cleanup(); }
});

test('status reports unhealthy checks; a joining provider with an unowned same-name skill is a conflict until --resolve <name>=core', () => {
  const fx = fixtureHome('join');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { notes: skill('notes', 'shared\n') } });
    B.bridge(fx);
    fx.seed('codex', { instructions: 'Hi.\n', skills: { notes: skill('notes', 'my own codex notes\n') } });
    let p = B.plan(fx, { provider: 'codex' });
    assert.ok(p.conflicts.includes(`join:codex/notes`), JSON.stringify(p.conflicts));
    B.apply(fx, p.id);
    assert.equal(readFileSync(fx.skillPath('codex', 'notes'), 'utf8'), skill('notes', 'my own codex notes\n')['SKILL.md'], 'unowned copy untouched');
    p = B.plan(fx, { provider: 'codex', resolve: { notes: 'core' } });
    assert.deepEqual(ops(p).filter(o => !['adapter', 'write-core-file'].includes(o)), ['preserve-candidate', 'replace-unowned-skill', 'install-core-skill']);
    const r = B.apply(fx, p.id);
    assert.equal(r.candidates.length, 1);
    assert.equal(readFileSync(fx.skillPath('codex', 'notes'), 'utf8'), skill('notes', 'shared\n')['SKILL.md']);
    assert.ok(B.verify(fx).healthy, B.verify(fx).summary);
    assert.equal(B.plan(fx).noop, true);
    // Unhealthy: a hand-edited bridge block and a missing core file.
    fx.write(fx.instructions('codex'), fx.readText(fx.instructions('codex')).replace('Current provider: codex.', 'Current provider: codex. Edited.'));
    rmSync(fx.corePath('knowledge-contract.md'));
    const s = B.status(fx);
    assert.ok(s.unhealthy.some(c => c.name === 'codex:block' && c.state === 'blocked'));
    assert.ok(s.unhealthy.some(c => c.name === 'core:contract' && c.state === 'failed'));
    assert.match(s.summary, /health check/);
  } finally { fx.cleanup(); }
});

test('the kit skill follows a kit update while unchanged, and a customised copy blocks the update', () => {
  const fx = fixtureHome('kit-skill');
  try {
    both(fx); B.bridge(fx);
    assert.ok(existsSync(fx.skillPath('codex', 'claude-codex-bridge')) && existsSync(fx.skillPath('claude', 'claude-codex-bridge')));
    const newer = join(fx.root, 'kit-newer'); mkdirSync(newer);
    for (const part of ['scripts', 'core', 'skills', 'VERSION']) cpSync(join(REPO, part), join(newer, part), { recursive: true });
    writeFileSync(join(newer, 'skills/claude-codex-bridge/SKILL.md'), readFileSync(join(REPO, 'skills/claude-codex-bridge/SKILL.md'), 'utf8') + '\nNewer kit line.\n');
    let p = B.plan(fx, { kit: newer });
    assert.equal(p.operations.find(o => o.name === 'claude-codex-bridge')?.op, 'promote-skill');
    B.apply(fx, p.id);
    assert.ok(readFileSync(fx.skillPath('codex', 'claude-codex-bridge'), 'utf8').includes('Newer kit line.'));
    assert.equal(B.plan(fx, { kit: newer }).noop, true);
    writeFileSync(fx.skillPath('claude', 'claude-codex-bridge'), 'My own version.\n');
    writeFileSync(join(newer, 'skills/claude-codex-bridge/SKILL.md'), 'Even newer.\n');
    p = B.plan(fx, { kit: newer });
    assert.equal(item(p, 'skill:claude-codex-bridge').collision, 'customised');
    assert.ok(!p.operations.some(o => o.name === 'claude-codex-bridge' && o.sourceDir?.startsWith(newer)), 'nothing is written from the kit; the user edit itself still syncs as an ordinary one-sided change');
  } finally { fx.cleanup(); }
});

test('different-key concurrent knowledge writes both succeed and preserve each other', async () => {
  const fx = fixtureHome('knowledge-keys');
  try {
    both(fx); B.bridge(fx);
    const put = (key, value, provider) => new Promise(done => { const c = spawn(process.execPath, [fx.corePath('memory.mjs'), 'put', key, '0', value, provider, 'fact']); let out = ''; c.stdout.on('data', d => out += d); c.on('close', status => done({ status, out })); });
    let done = 0;
    for (let attempt = 0; attempt < 5 && done < 2; attempt++) {
      const results = await Promise.all([put('colour', 'blue', 'claude'), put('city', 'Perth', 'codex')]);
      done = results.filter(r => r.status === 0).length;
      for (const [i, r] of results.entries()) if (r.status !== 0) { const again = spawnSync(process.execPath, [fx.corePath('memory.mjs'), 'put', ['colour', 'city'][i], '0', ['blue', 'Perth'][i], ['claude', 'codex'][i], 'fact'], { encoding: 'utf8' }); assert.equal(again.status, 0, 'a busy loser succeeds on retry'); done++; }
    }
    const store = JSON.parse(spawnSync(process.execPath, [fx.corePath('memory.mjs'), 'read'], { encoding: 'utf8' }).stdout);
    assert.equal(store.entries.colour.value, 'blue'); assert.equal(store.entries.city.value, 'Perth');
    assert.equal(store.entries.colour.provider, 'claude'); assert.equal(store.entries.city.provider, 'codex');
  } finally { fx.cleanup(); }
});

test('the setup prompt names paths and commands that exist in this kit', () => {
  const prompt = readFileSync(join(REPO, 'docs/start/setup.md'), 'utf8');
  assert.ok(prompt.includes('skills/claude-codex-bridge/SKILL.md') && existsSync(join(REPO, 'skills/claude-codex-bridge/SKILL.md')));
  assert.ok(prompt.includes('SelrAI-Skool-Community/claude-codex-bridge'));
  const skillText = readFileSync(join(REPO, 'skills/claude-codex-bridge/SKILL.md'), 'utf8');
  assert.ok(skillText.includes('## Bridge or sync'), 'the section the prompt points at exists');
  for (const command of ['inspect', 'plan', 'apply', 'verify', 'status', 'sync', 'handoff']) assert.ok(skillText.includes(`\`${command}`) || skillText.includes(` ${command}`), command);
  const cli = readFileSync(join(REPO, 'scripts/bridge.mjs'), 'utf8');
  for (const opt of ['--skip', '--only', '--instructions-from', '--resolve', '--project']) assert.ok(cli.includes(`'${opt}'`), `${opt} is a real option`);
});

test('path traversal in a forged receipt is refused through the public removal workflow', () => {
  const fx = fixtureHome('traversal');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', skills: { notes: skill('notes') } });
    B.bridge(fx);
    const path = join(fx.home, '.selr/bridge/manifest.json');
    const m = JSON.parse(readFileSync(path, 'utf8'));
    m.providers.claude.skills['../../escape'] = { files: { 'SKILL.md': 'deadbeef' } };
    writeFileSync(path, JSON.stringify(m));
    const p = B.plan(fx, { intent: 'remove', removeProvider: 'claude' });
    assert.throws(() => B.apply(fx, p.id), /Invalid owned skill path/);
    assert.ok(fx.readText(fx.instructions('claude')).includes('selr-bridge:begin'), 'nothing removed');
  } finally { fx.cleanup(); }
});

test('reviewed defects stay fixed: MCP url and command secrets, seed instruction secrets, same-named commands, adopted-twin staleness, loser-only files, byte-exact block removal, removal after an adapter kill, CLI home isolation', () => {
  const fx = fixtureHome('regressions');
  try {
    const SECRETS = ['Trellis9QuartzPass', 'ghp_FakeExampleTokenFakeExampleToken9876', 'sk_live_ABCDEFGHIJKLMNOP1234'];
    fx.seed('claude', { instructions: `Section A.\n\n\n\nSection B.\n\n`, commands: { summ: 'Claude summary.\n' } });
    fx.seed('codex', { instructions: `Hi.\nTOKEN = "${SECRETS[1]}"\n`, commands: { summ: 'Codex summary.\n' }, files: { 'config.toml': `[mcp_servers.basic]\nurl = "https://alice:${SECRETS[0]}@host.example/sse"\n[mcp_servers.query]\nurl = "https://host.example/sse?access_token=${SECRETS[1]}"\n[mcp_servers.cmd]\ncommand = "API_TOKEN=${SECRETS[2]} node server.mjs"\n` } });
    let p = B.plan(fx, { instructionsFrom: 'codex' });
    const text = JSON.stringify(p);
    for (const s of SECRETS) assert.ok(!text.includes(s), `plan leaked ${s.slice(0, 6)}`);
    for (const name of ['basic', 'query', 'cmd']) assert.ok(item(p, `mcp:codex/${name}`).metadata.redacted.length, name);
    assert.equal(item(p, 'instructions:portable').collision, 'conflict', 'a secret in the seed source blocks the seed');
    assert.match(item(p, 'instructions:portable').userAction, /secret-shaped/);
    assert.equal(item(p, 'command:claude/summ').collision, 'conflict', 'same-named commands with different text conflict');
    assert.ok(!p.operations.some(o => o.op === 'translate-command'));
    p = B.plan(fx, { instructionsFrom: 'claude', resolve: { summ: 'claude' } });
    assert.equal(item(p, 'command:claude/summ').disposition, 'translated'); assert.equal(item(p, 'command:codex/summ').disposition, 'codex-only');
    assert.ok(!p.operations.some(o => o.op === 'seed-instructions' && 'body' in o), 'the plan references the seed source instead of carrying its text');
    B.apply(fx, p.id);
    assert.ok(readFileSync(fx.skillPath('codex', 'summ'), 'utf8').includes('Claude summary.'));
    const inventory = readFileSync(fx.corePath('mcp-inventory.json'), 'utf8');
    for (const s of SECRETS) assert.ok(!inventory.includes(s));
    // Byte-exact removal around blank-line runs.
    B.remove(fx, 'claude');
    assert.equal(fx.readText(fx.instructions('claude')), `Section A.\n\n\n\nSection B.\n\n`);
    // Removal after a kill at the adapter boundary.
    B.bridge(fx);
    const codexHome = join(fx.root, 'k2'); mkdirSync(codexHome);
    const fy = fixtureHome('adapter-kill');
    try {
      fy.seed('claude', { instructions: 'Hi.\n' }); fy.seed('codex', { instructions: 'Hi.\n' });
      const q = B.plan(fy);
      const log = join(fy.root, 'log'); writeFileSync(log, '');
      const killed = spawnSync(process.execPath, [join(REPO, 'tests/fixtures/apply-driver.mjs'), fy.home, q.id, 'adapter:codex', log], { encoding: 'utf8' });
      assert.equal(killed.signal, 'SIGKILL');
      const removal = B.remove(fy, 'codex');
      assert.equal(removal.result.applied, true);
      assert.equal(fy.readText(fy.instructions('codex')), 'Hi.\n');
    } finally { fy.cleanup(); }
    // Adopted twin edited after planning is a stale plan.
    const fz = fixtureHome('twin-stale');
    try {
      fz.seed('claude', { instructions: 'Hi.\n', skills: { twin: skill('twin') } }); fz.seed('codex', { instructions: 'Hi.\n', skills: { twin: skill('twin') } });
      const q = B.plan(fz);
      fz.write(fz.skillPath('codex', 'twin'), skill('twin', 'edited after planning\n')['SKILL.md']);
      assert.throws(() => B.apply(fz, q.id), /plan is stale/);
    } finally { fz.cleanup(); }
    // A file only the losing copy had survives a forced resolution and a later removal.
    const fw = fixtureHome('loser-only');
    try {
      fw.seed('claude', { instructions: 'Hi.\n', skills: { notes: skill('notes', 'base\n') } }); fw.seed('codex', { instructions: 'Hi.\n' });
      B.bridge(fw);
      fw.write(fw.skillPath('claude', 'notes'), skill('notes', 'claude\n')['SKILL.md']);
      fw.write(fw.skillPath('codex', 'notes'), skill('notes', 'codex\n')['SKILL.md']);
      fw.write(fw.skillPath('codex', 'notes', 'my-private-notes.md'), 'private\n');
      B.apply(fw, B.plan(fw, { resolve: { notes: 'claude' } }).id);
      assert.equal(fw.readText(fw.skillPath('codex', 'notes', 'my-private-notes.md')), 'private\n');
      assert.equal(fw.manifest().providers.codex.skills.notes.files['my-private-notes.md'], undefined, 'never owned');
      const removal = B.remove(fw, 'codex');
      assert.equal(fw.readText(fw.skillPath('codex', 'notes', 'my-private-notes.md')), 'private\n', 'a user file is never removed');
      assert.ok(removal.result.preserved.includes('notes'));
    } finally { fw.cleanup(); }
    // A joining provider after a core edit: the other provider still receives the edit.
    const fv = fixtureHome('rejoin');
    try {
      fv.seed('claude', { instructions: 'Hi.\n', skills: { notes: skill('notes', 'v1\n') } }); fv.seed('codex', { instructions: 'Hi.\n' });
      B.bridge(fv); B.remove(fv, 'codex');
      fv.write(fv.corePath('skills/notes/SKILL.md'), skill('notes', 'v2 core\n')['SKILL.md']);
      B.apply(fv, B.plan(fv, { provider: 'codex' }).id);
      const q = B.plan(fv);
      assert.equal(q.operations.find(o => o.op === 'promote-skill')?.from, 'core');
      B.apply(fv, q.id);
      assert.equal(fv.readText(fv.skillPath('claude', 'notes')), skill('notes', 'v2 core\n')['SKILL.md']);
      assert.ok(B.verify(fv).healthy, B.verify(fv).summary);
    } finally { fv.cleanup(); }
    // CLI --home ignores the shell's provider homes.
    const fu = fixtureHome('cli-isolation');
    try {
      fu.seed('claude', { instructions: 'Fixture.\n' });
      const elsewhere = join(fu.root, 'real-claude'); mkdirSync(elsewhere); writeFileSync(join(elsewhere, 'CLAUDE.md'), 'Real.\n');
      const out = spawnSync(process.execPath, [join(REPO, 'scripts/bridge.mjs'), 'plan', '--provider', 'claude', '--home', fu.home, '--kit', REPO], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent', CLAUDE_CONFIG_DIR: elsewhere } });
      assert.equal(out.status, 0, out.stderr);
      const adapter = JSON.parse(out.stdout).operations.find(o => o.op === 'adapter');
      assert.equal(adapter.instructions, fu.instructions('claude'));
    } finally { fu.cleanup(); }
  } finally { fx.cleanup(); }
});
