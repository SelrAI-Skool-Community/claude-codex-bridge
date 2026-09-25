#!/usr/bin/env node
// Agent acceptance: the member journey driven through the real Claude Code and
// Codex command lines, with a fixture home standing in for the member's
// computer. The agents read the setup prompt and the bridge skill themselves;
// this script only plays the member (prompts and approvals) and checks what is
// on disk and what the agents answer. Nothing in the real home is written.
//
//   node scripts/acceptance.mjs [--out <json>] [--scenario <name>]...
//
// Scenarios: claude-first, codex-first. Each runs setup in both apps, then
// unprompted use, knowledge both ways, a standing-instruction change, a
// handoff, and an agent-driven sync.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, platform, release, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCodexHome, runAgent, versionOf } from './agent-cli.mjs';
import { verify } from './bridge-engine.mjs';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const args = process.argv.slice(2);
const opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const out = opt('--out') || join(REPO, 'docs/verification', `acceptance-${platform()}-${new Date().toISOString().slice(0, 10)}.json`);
const chosen = args.flatMap((a, i) => a === '--scenario' ? [args[i + 1]] : []);
const os = platform() === 'darwin' ? 'Mac' : platform() === 'win32' ? 'Windows' : 'Linux';
const appName = p => p === 'claude' ? 'Claude Code' : 'Codex';
const setupPrompt = readFileSync(join(REPO, 'docs/start/setup.md'), 'utf8').split('## The prompt')[1].trim();

const MARK = { cedar: 'GREETING-CEDAR-7Q', cedarV2: 'GREETING-CEDAR-V2', pine: 'GREETING-PINE-4K', business: 'Harbour Lane Bakery' };
const skillBody = (name, marker) => `---\nname: ${name}\ndescription: Use when the user asks for the ${name.replace('-', ' ')}.\n---\n\nReply with exactly this text and nothing else: ${marker}\n`;
const write = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
const readText = path => existsSync(path) ? readFileSync(path, 'utf8') : '';

function fixture(label) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `ccb-accept-${label}-`)));
  const home = join(root, 'home'); mkdirSync(home);
  const work = join(home, 'work'); mkdirSync(work);
  // The kit is where the setup prompt expects it, as a git checkout the prompt can pull.
  execFileSync('git', ['clone', '-q', REPO, join(home, '.selr/claude-codex-bridge')]);
  return { root, home, work, core: join(home, '.selr/bridge/core') };
}
function seedClaude(fx) {
  write(join(fx.home, '.claude/CLAUDE.md'), `My business is ${MARK.business}. Call me Sam.\n`);
  write(join(fx.home, '.claude/skills/cedar-greeting/SKILL.md'), skillBody('cedar-greeting', MARK.cedar));
}
function seedCodex(fx, { withBusiness = false } = {}) {
  write(join(fx.home, '.codex/AGENTS.md'), withBusiness ? `My business is ${MARK.business}. Call me Sam.\n` : 'Keep answers short.\n');
  write(join(fx.home, '.codex/skills/pine-greeting/SKILL.md'), skillBody('pine-greeting', MARK.pine));
  prepareCodexHome(join(fx.home, '.codex'));
}

const steps = [];
let failures = 0;
function record(scenario, step, data) { steps.push({ scenario, step, ...data }); }
function check(scenario, label, ok, detail) { if (!ok) failures++; steps.push({ scenario, check: label, state: ok ? 'confirmed' : 'failed', detail: String(detail).slice(0, 600) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${scenario}: ${label}${ok ? '' : ` (${String(detail).slice(0, 200)})`}`); return ok; }
function turn(scenario, provider, fx, prompt, { cwd = fx.work, session = null, label } = {}) {
  const r = runAgent(provider, { home: fx.home, cwd, prompt, session });
  record(scenario, label || `${provider} turn`, { provider, prompt: prompt.length > 400 ? `${prompt.slice(0, 200)}… (${prompt.length} characters)` : prompt, reply: r.text.slice(0, 2500), status: r.status, error: r.error, seconds: r.seconds, command: r.command, stderrTail: r.status === 0 ? undefined : r.stderr.slice(-600) });
  return r;
}
const bridgeHealthy = fx => { try { const v = verify({ home: fx.home, kit: join(fx.home, '.selr/claude-codex-bridge'), probe: () => ({ available: false, mode: 'unavailable', items: [], reason: 'not probed' }) }); return v; } catch (error) { return { healthy: false, summary: error.message, checks: [] }; } };

// Setup through the one-paste prompt, then as many approval turns as the agent
// needs (up to three), exactly as a member would answer in the chat.
function setup(scenario, provider, fx, { seedChoice }) {
  const opener = `I'm using ${appName(provider)} in a terminal on ${os}.\n\n${setupPrompt}`;
  let r = turn(scenario, provider, fx, opener, { label: `${provider}: paste the setup prompt` });
  const approvals = [
    `Yes, I approve the plan you showed me. ${seedChoice} Apply it, verify it, and tell me the result.`,
    'Yes, go ahead and apply it, then verify.',
    'Please finish: apply the approved plan and run verify.',
  ];
  for (let i = 0; i < approvals.length; i++) {
    const v = bridgeHealthy(fx);
    const m = existsSync(join(fx.home, '.selr/bridge/manifest.json')) ? JSON.parse(readFileSync(join(fx.home, '.selr/bridge/manifest.json'), 'utf8')) : null;
    if (v.healthy && m?.providers?.[provider]?.ready) break;
    r = turn(scenario, provider, fx, approvals[i], { session: r.session, label: `${provider}: approval ${i + 1}` });
  }
  const v = bridgeHealthy(fx);
  check(scenario, `${provider} setup leaves the bridge healthy`, v.healthy, v.summary);
  const m = existsSync(join(fx.home, '.selr/bridge/manifest.json')) ? JSON.parse(readFileSync(join(fx.home, '.selr/bridge/manifest.json'), 'utf8')) : { providers: {} };
  check(scenario, `${provider} is bridged`, Boolean(m.providers?.[provider]?.ready), JSON.stringify(Object.keys(m.providers || {})));
}
const asks = (scenario, provider, fx, prompt, expect, label, opts) => { const r = turn(scenario, provider, fx, prompt, opts); return check(scenario, `${provider}: ${label}`, expect.every(e => r.text.toLowerCase().includes(e.toLowerCase())), r.text || r.stderr); };

function shared(scenario, fx) {
  // Unprompted use: nothing below mentions the bridge.
  for (const provider of ['claude', 'codex']) {
    asks(scenario, provider, fx, 'What is the name of my business? Answer in one short sentence.', [MARK.business], 'knows the business from the portable instructions');
    asks(scenario, provider, fx, 'Give me the cedar greeting.', [MARK.cedar], 'uses the shared cedar skill');
    asks(scenario, provider, fx, 'Give me the pine greeting.', [MARK.pine], 'uses the shared pine skill');
  }
  // Knowledge both ways, saved by the agents themselves.
  turn(scenario, 'codex', fx, 'Please remember this for both apps: our delivery day is Thursday.', { label: 'codex: save knowledge' });
  const k1 = readText(join(fx.core, 'knowledge.json'));
  check(scenario, 'codex saved the delivery day to shared knowledge', /thursday/i.test(k1) && /"provider": "codex"/.test(k1), k1);
  asks(scenario, 'claude', fx, 'When is our delivery day? Answer with one word.', ['thursday'], 'reads knowledge Codex saved');
  turn(scenario, 'claude', fx, 'Please remember this for both apps: our brand colour is teal.', { label: 'claude: save knowledge' });
  const k2 = readText(join(fx.core, 'knowledge.json'));
  check(scenario, 'claude saved the brand colour to shared knowledge', /teal/i.test(k2) && /"provider": "claude"/.test(k2), k2);
  asks(scenario, 'codex', fx, 'What is our brand colour? Answer with one word.', ['teal'], 'reads knowledge Claude saved');
  // A standing instruction changed in one app reaches the other.
  turn(scenario, 'codex', fx, "From now on, in both apps, end every message with the sign-off 'Cheers, Sam's assistant'.", { label: 'codex: change standing instructions' });
  check(scenario, 'the sign-off landed in the portable instructions', /cheers, sam/i.test(readText(join(fx.core, 'instructions.md'))), readText(join(fx.core, 'instructions.md')));
  asks(scenario, 'claude', fx, "Write a one-sentence note to our supplier confirming Thursday's delivery.", ['cheers'], 'follows the instruction Codex added');
  // Handoff from Claude to Codex for a real project folder.
  const project = join(fx.work, 'invoice-tool');
  write(join(project, 'README.md'), '# Invoice tool\n\nExports invoices. CSV export is done and tested. We decided to use ISO dates.\n');
  write(join(project, 'TODO.md'), '- [x] CSV export\n- [ ] PDF export\n- [ ] Email invoices to customers\n');
  turn(scenario, 'claude', fx, "I'm switching to Codex for this project now. Create a handoff so Codex can carry on.", { cwd: project, label: 'claude: create a handoff' });
  const handoffs = existsSync(join(fx.core, 'handoffs')) ? readdirSync(join(fx.core, 'handoffs')).filter(f => f.endsWith('.md')) : [];
  check(scenario, 'claude saved a handoff through the bridge', handoffs.length > 0 && handoffs.some(f => /provider: claude/i.test(readText(join(fx.core, 'handoffs', f)))), handoffs.join(', '));
  asks(scenario, 'codex', fx, 'Pick up this project where Claude left off. What work is still open? List it briefly.', ['pdf', 'email'], 'continues from the handoff', { cwd: project });
  // Agent-driven sync after an edit in one app.
  write(join(fx.home, '.agents/skills/cedar-greeting/SKILL.md'), skillBody('cedar-greeting', MARK.cedarV2));
  let r = turn(scenario, 'codex', fx, 'I edited the cedar greeting skill here in Codex. Sync the bridge so Claude gets my edit. I approve the sync plan; apply it and verify.', { label: 'codex: sync after an edit' });
  if (!readText(join(fx.home, '.claude/skills/cedar-greeting/SKILL.md')).includes(MARK.cedarV2)) r = turn(scenario, 'codex', fx, 'Yes, apply that sync plan now and verify.', { session: r.session, label: 'codex: approve the sync' });
  check(scenario, 'the Codex edit reached Claude through sync', readText(join(fx.home, '.claude/skills/cedar-greeting/SKILL.md')).includes(MARK.cedarV2), readText(join(fx.home, '.claude/skills/cedar-greeting/SKILL.md')));
  asks(scenario, 'claude', fx, 'Give me the cedar greeting.', [MARK.cedarV2], 'uses the synced skill');
  const v = bridgeHealthy(fx);
  check(scenario, 'the bridge is healthy at the end', v.healthy, v.summary);
}

const scenarios = {
  'claude-first': () => {
    const fx = fixture('claude-first');
    try {
      seedClaude(fx);
      setup('claude-first', 'claude', fx, { seedChoice: 'Seed the portable instructions from my Claude instructions.' });
      check('claude-first', 'Codex was not touched while only Claude was set up', !existsSync(join(fx.home, '.codex')), 'a .codex folder appeared');
      seedCodex(fx);
      setup('claude-first', 'codex', fx, { seedChoice: 'Keep my existing Codex instructions as Codex-only.' });
      check('claude-first', 'the old Codex skills folder no longer duplicates the shared pine skill', !existsSync(join(fx.home, '.codex/skills/pine-greeting')), 'still present');
      shared('claude-first', fx);
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  },
  'codex-first': () => {
    const fx = fixture('codex-first');
    try {
      seedCodex(fx, { withBusiness: true });
      write(join(fx.home, '.agents/skills/cedar-greeting/SKILL.md'), skillBody('cedar-greeting', MARK.cedar));
      setup('codex-first', 'codex', fx, { seedChoice: 'Seed the portable instructions from my Codex instructions.' });
      check('codex-first', 'Claude was not touched while only Codex was set up', !existsSync(join(fx.home, '.claude')), 'a .claude folder appeared');
      mkdirSync(join(fx.home, '.claude'), { recursive: true });
      setup('codex-first', 'claude', fx, { seedChoice: 'Use the existing portable instructions.' });
      shared('codex-first', fx);
    } finally { rmSync(fx.root, { recursive: true, force: true }); }
  },
};

const started = new Date().toISOString();
for (const name of chosen.length ? chosen : Object.keys(scenarios)) {
  try { scenarios[name](); } catch (error) { check(name, 'scenario ran to the end', false, error.stack || error.message); }
}
const revision = (() => { try { return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })();
const evidence = { schema: 1, status: failures ? 'failed' : 'passed', started, finished: new Date().toISOString(), host: hostname(), os: `${platform()} ${release()}`, sourceRevision: revision, versions: { node: process.version, claude: versionOf(process.env.CCB_CLAUDE_BIN || 'claude'), codex: versionOf(process.env.CCB_CODEX_BIN || 'codex') }, fixture: 'A fresh fixture home per scenario in the temp folder; the kit is cloned into it at the path the setup prompt uses.', checks: steps.filter(s => s.check).length, failures, steps };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
console.log(`${evidence.status}: ${evidence.checks} checks, ${failures} failed; ${out}`);
process.exitCode = failures ? 1 : 0;
