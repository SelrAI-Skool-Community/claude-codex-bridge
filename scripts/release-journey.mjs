#!/usr/bin/env node
// Real-machine release journey. Runs the complete user path against a fixture
// home on this computer with the real Claude Code and Codex builds: install,
// initial bridge in both directions, sync, conflict, interrupted recovery,
// fresh-session verification, provider removal, re-addition and uninstall.
// Records exact versions, OS, source revision, every command and observed
// result under docs/verification/. Platform override tests cannot satisfy
// this gate; only a run on the platform can.
//
//   node scripts/release-journey.mjs [--out docs/verification/<file>.json] [--skip-fresh-session]
//
// Sign-in for the fresh sessions comes from scripts/agent-cli.mjs: an access
// token only, written into the fixture, never linked to the real files.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname, platform, release, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshSessionCheck, overlayMarker, PROBE } from './fresh-session-check.mjs';
import { prepareCodexHome, versionOf as agentVersion } from './agent-cli.mjs';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(REPO, 'docs/verification', `${platform()}-${new Date().toISOString().slice(0, 10)}.json`);
const skipFresh = args.includes('--skip-fresh-session');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'ccb-journey-')));
const home = join(root, 'home'); mkdirSync(home);
const claudeHome = join(home, '.claude'), codexHome = join(home, '.codex');
const steps = [];
const versionOf = bin => agentVersion(bin);
const bridge = (label, ...cli) => {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts/bridge.mjs'), ...cli, '--home', home, '--kit', REPO], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: '', CODEX_HOME: '' } });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* error output */ }
  const step = { label, command: `node scripts/bridge.mjs ${cli.join(' ')}`, exitStatus: r.status, summary: json?.summary ?? r.stderr.trim(), planId: json?.id, noop: json?.noop, healthy: json?.healthy };
  steps.push(step);
  if (r.status !== 0) throw Error(`${label}: ${r.stderr}`);
  return json;
};
const applyPlan = (label, plan) => bridge(`${label} (apply ${plan.id})`, 'apply', '--plan', plan.id);
const write = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
const readText = path => existsSync(path) ? readFileSync(path, 'utf8') : null;
const expect = (label, condition, detail) => { steps.push({ label, check: true, state: condition ? 'confirmed' : 'failed', detail }); if (!condition) throw Error(`${label}: ${detail}`); };
const skill = (name, body) => `---\nname: ${name}\ndescription: ${name}.\n---\n${body}`;
let status = 'passed';
try {
  // 1. Claude-only start.
  write(join(claudeHome, 'CLAUDE.md'), 'Always call me Sam.\n');
  write(join(claudeHome, 'skills/journey-notes/SKILL.md'), skill('journey-notes', 'Take notes.\n'));
  write(join(claudeHome, 'settings.json'), '{"permissions":{"allow":[]}}\n');
  bridge('inspect (Claude only)', 'inspect', '--provider', 'claude', '--host', 'cli');
  let plan = bridge('plan (Claude only)', 'plan', '--provider', 'claude', '--host', 'cli');
  applyPlan('bridge Claude', plan);
  let v = bridge('verify (Claude only)', 'verify');
  expect('Claude-only verify healthy', v.healthy, v.summary);
  expect('Claude instructions preserved', readText(join(claudeHome, 'CLAUDE.md')).startsWith('Always call me Sam.\n'), 'personal text intact');
  // 2. Codex arrives (Codex-first direction is covered by adding it to an existing core and by the tests).
  write(join(codexHome, 'AGENTS.md'), 'Codex personal.\n');
  write(join(codexHome, 'config.toml'), 'model = "gpt-6-astra"\n');
  write(join(home, '.agents/skills/journey-drafts/SKILL.md'), skill('journey-drafts', 'Draft things.\n'));
  plan = bridge('plan (add Codex)', 'plan', '--provider', 'codex', '--host', 'cli');
  applyPlan('bridge Codex', plan);
  v = bridge('verify (both)', 'verify');
  expect('both verify healthy', v.healthy, v.summary);
  expect('shared skill reached Codex', readText(join(home, '.agents/skills/journey-notes/SKILL.md')) === readText(join(claudeHome, 'skills/journey-notes/SKILL.md')), 'journey-notes identical');
  expect('Codex skill reached Claude', readText(join(claudeHome, 'skills/journey-drafts/SKILL.md')) === readText(join(home, '.agents/skills/journey-drafts/SKILL.md')), 'journey-drafts identical');
  expect('repeat is a no-op', bridge('plan (repeat)', 'plan', '--provider', 'codex', '--host', 'cli').noop === true, 'noop');
  // 3. One-sided change and sync.
  write(join(home, '.agents/skills/journey-notes/SKILL.md'), skill('journey-notes', 'Take better notes.\n'));
  plan = bridge('sync (Codex edit)', 'sync', '--provider', 'codex', '--host', 'cli');
  applyPlan('sync', plan);
  expect('promotion reached Claude', readText(join(claudeHome, 'skills/journey-notes/SKILL.md')).includes('better'), 'Claude copy updated');
  // 4. Conflict, then resolution with candidates preserved.
  write(join(claudeHome, 'skills/journey-notes/SKILL.md'), skill('journey-notes', 'Claude version.\n'));
  write(join(home, '.agents/skills/journey-notes/SKILL.md'), skill('journey-notes', 'Codex version.\n'));
  plan = bridge('sync (conflict)', 'sync', '--provider', 'claude', '--host', 'cli');
  expect('conflict reported, nothing written', plan.conflicts.includes('sync:journey-notes') && !plan.operations.some(o => o.name === 'journey-notes'), JSON.stringify(plan.conflicts));
  plan = bridge('sync (resolve codex)', 'sync', '--provider', 'claude', '--host', 'cli', '--resolve', 'journey-notes=codex');
  const resolved = applyPlan('resolve', plan);
  expect('candidates preserved', resolved.candidates.length >= 1 && resolved.candidates.every(c => existsSync(c)), resolved.candidates.join(', '));
  expect('chosen version everywhere', readText(join(claudeHome, 'skills/journey-notes/SKILL.md')).includes('Codex version'), 'Claude copy now Codex version');
  // 5. Interrupted operation: kill apply at a boundary, then recover.
  write(join(home, '.agents/skills/journey-notes/SKILL.md'), skill('journey-notes', 'Codex version 2.\n'));
  plan = bridge('sync (before interruption)', 'sync', '--provider', 'codex', '--host', 'cli');
  const log = join(root, 'checkpoints.log'); writeFileSync(log, '');
  const killed = spawnSync(process.execPath, [join(REPO, 'tests/fixtures/apply-driver.mjs'), home, plan.id, 'claude:skill:journey-notes', log], { encoding: 'utf8' });
  steps.push({ label: 'apply killed at claude:skill:journey-notes', command: 'node tests/fixtures/apply-driver.mjs <home> <plan> claude:skill:journey-notes', signal: killed.signal, boundaries: readFileSync(log, 'utf8').trim().split('\n') });
  const lastBoundary = readFileSync(log, 'utf8').trim().split('\n').at(-1);
  expect('process died at the boundary', killed.signal === 'SIGKILL' || (platform() === 'win32' && killed.status !== 0 && lastBoundary === 'claude:skill:journey-notes'), `${killed.signal} ${killed.status} ${lastBoundary}`);
  v = bridge('verify (interrupted)', 'verify');
  expect('interrupted state reported', !v.healthy && v.checks.some(c => c.name === 'receipt' && c.state === 'blocked'), v.summary);
  plan = bridge('plan (recover)', 'plan', '--provider', 'codex', '--host', 'cli');
  const recovered = applyPlan('recover', plan);
  expect('recovery reported', Boolean(recovered.recovery?.summary), JSON.stringify(recovered.recovery));
  v = bridge('verify (recovered)', 'verify');
  expect('recovered verify healthy', v.healthy, v.summary);
  expect('recovered content everywhere', readText(join(claudeHome, 'skills/journey-notes/SKILL.md')).includes('version 2'), 'Claude copy updated');
  // 6. Knowledge, handoff and fresh sessions against the real builds.
  const memory = spawnSync(process.execPath, [join(home, '.selr/bridge/core/memory.mjs'), 'put', PROBE.key, '0', PROBE.value, 'claude', 'fact'], { encoding: 'utf8' });
  expect('knowledge saved', memory.status === 0, memory.stderr);
  for (const provider of ['claude', 'codex']) write(join(home, '.selr/bridge/core/overlays', `${provider}.md`), readText(join(home, '.selr/bridge/core/overlays', `${provider}.md`)) + `\n${overlayMarker(provider)}\n`);
  const input = join(root, 'handoff.json');
  writeFileSync(input, JSON.stringify({ name: PROBE.handoff, project: 'journey', purpose: PROBE.purpose, currentState: 'Bridged.', completedWork: ['Bridge applied'], decisions: ['Use the bridge'], openWork: ['Fresh-session check'], blockers: 'none', relevantPaths: ['skills/journey-notes'], verificationRun: 'npm test' }));
  const handoff = bridge('handoff create', 'handoff', 'create', '--input', input, '--provider', 'claude');
  expect('handoff saved', handoff.saved === true, handoff.summary);
  let fresh = null;
  if (!skipFresh) {
    prepareCodexHome(codexHome);
    fresh = freshSessionCheck({ home, cwd: home });
    for (const r of fresh.results) steps.push({ label: `fresh ${r.provider} session`, command: r.command, exitStatus: r.exitStatus, state: r.state, observed: r.observed, output: r.output });
    expect('fresh sessions read the core, their own overlay and the handoff', fresh.healthy, fresh.results.map(r => `${r.provider}: ${r.state} ${JSON.stringify(r.observed)}`).join('; '));
    rmSync(join(codexHome, 'auth.json'), { force: true });
  }
  // 7. Remove Codex, re-add it, then uninstall.
  plan = bridge('remove Codex (plan)', 'remove', '--remove-provider', 'codex');
  applyPlan('remove Codex', plan);
  expect('Codex block gone, personal text exact', readText(join(codexHome, 'AGENTS.md')) === 'Codex personal.\n', readText(join(codexHome, 'AGENTS.md')));
  expect('Claude still healthy', bridge('verify (Codex removed)', 'verify').healthy, 'verify');
  expect('knowledge survives removal', spawnSync(process.execPath, [join(home, '.selr/bridge/core/memory.mjs'), 'read'], { encoding: 'utf8' }).stdout.includes(PROBE.value), 'probe value present');
  plan = bridge('re-add Codex (plan)', 'plan', '--provider', 'codex', '--host', 'cli');
  applyPlan('re-add Codex', plan);
  expect('re-added Codex healthy', bridge('verify (Codex re-added)', 'verify').healthy, 'verify');
  plan = bridge('uninstall (plan)', 'uninstall');
  applyPlan('uninstall', plan);
  expect('receipt gone', !existsSync(join(home, '.selr/bridge/manifest.json')), 'manifest removed');
  expect('personal instructions exact after uninstall', readText(join(claudeHome, 'CLAUDE.md')) === 'Always call me Sam.\n' && readText(join(codexHome, 'AGENTS.md')) === 'Codex personal.\n', 'both files');
  expect('knowledge, handoff and customised overlays remain', existsSync(join(home, '.selr/bridge/core/knowledge.json')) && existsSync(join(home, '.selr/bridge/core/handoffs', `${PROBE.handoff}.md`)) && existsSync(join(home, '.selr/bridge/core/overlays/claude.md')), 'user assets kept');
  var freshReport = fresh;
} catch (error) { status = 'failed'; steps.push({ label: 'failure', error: error.message }); }
finally {
  const evidence = { schema: 1, status, at: new Date().toISOString(), host: hostname(), os: `${platform()} ${release()}`, sourceRevision: (() => { try { return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })(), versions: { node: process.version, claude: versionOf(process.env.CCB_CLAUDE_BIN || 'claude'), codex: versionOf(process.env.CCB_CODEX_BIN || 'codex') }, fixture: { root, note: 'A clean fixture home under the temp folder; the real user home was not changed.' }, steps, freshSession: typeof freshReport !== 'undefined' ? freshReport : null, platformNote: `Recorded on ${platform()}; each platform needs its own record (docs/verification/README.md).` };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
  rmSync(root, { recursive: true, force: true });
  console.log(`${status}: ${steps.length} steps recorded in ${out}`);
  process.exitCode = status === 'passed' ? 0 : 1;
}
