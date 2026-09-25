#!/usr/bin/env node
// Rehearsal on a copy of a real setup. Copies the configuration a bridge would
// read (instructions, skills, commands, agents, settings, MCP definitions) from
// a real home into a temp fixture, stands in empty placeholders for private
// stores and credentials (presence is all the bridge ever reads), then runs
// the whole lifecycle there. It proves: realistic sizes and shapes plan and
// apply, repeat is a no-op, removal and uninstall restore the provider files,
// no secret value from the real MCP configuration appears in any plan,
// receipt, core file or report, and the real home is byte-identical afterwards.
//
//   node scripts/rehearse-real-setup.mjs [--source <home>] [--out <json>]
//
// The evidence records counts only; skill names and file contents stay local.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname, platform, release, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, plan, status, verify, inspect } from './bridge-engine.mjs';
import { tomlTables } from './bridge-adapters.mjs';
import { scrubFiles } from './scrub.mjs';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const args = process.argv.slice(2);
const opt = n => args.includes(n) ? args[args.indexOf(n) + 1] : null;
const source = resolve(opt('--source') || homedir());
const out = opt('--out') || join(REPO, 'docs/verification', `rehearsal-${platform()}-${new Date().toISOString().slice(0, 10)}.json`);
const noProbe = ({ provider }) => ({ provider, source: provider === 'claude' ? 'codex' : 'claude', available: false, mode: 'unavailable', version: null, items: [], command: null, reason: 'Not probed in the rehearsal.' });

const COPY = {
  '.claude': ['CLAUDE.md', 'skills', 'agents', 'commands', 'settings.json'],
  '.codex': ['AGENTS.md', 'AGENTS.override.md', 'config.toml', 'skills', 'agents', 'prompts', 'hooks.json'],
  '.agents': ['skills'],
};
const PLACEHOLDERS = { '.claude': ['projects', 'history.jsonl', 'todos', 'plugins', '.credentials.json'], '.codex': ['sessions', 'archived_sessions', 'memories', 'history.jsonl', 'auth.json'] };

function snapshot() {
  const h = createHash('sha256');
  const walk = p => { let st; try { st = lstatSync(p); } catch { return; } if (st.isSymbolicLink()) h.update(`L${p}>${readlinkSync(p)}`); else if (st.isDirectory()) for (const e of readdirSync(p).sort()) walk(join(p, e)); else h.update(`F${p}`).update(readFileSync(p)); };
  for (const [dir, items] of Object.entries(COPY)) for (const item of items) walk(join(source, dir, item));
  walk(join(source, '.claude.json'));
  return h.digest('hex');
}
// Links in the copy are repointed at a placeholder inside the fixture, so the
// rehearsal keeps "this is a link" without ever pointing at the real home.
function neuterLinks(dir, placeholder) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  let n = 0;
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) { unlinkSync(p); symlinkSync(placeholder, p, 'dir'); n++; }
    else if (e.isDirectory()) n += neuterLinks(p, placeholder);
  }
  return n;
}
// Secret-shaped values in the real MCP configuration: every header value, and
// every environment value whose name looks like a credential or whose value
// the vendored scrubber flags. Plain paths and flags in env are not secrets.
const SECRET_NAME = /(token|secret|key|pass|auth|cookie|credential|session)/i;
function secretValues() {
  const values = new Set();
  const consider = (name, v, always = false) => { if (typeof v !== 'string' || v.length < 8) return; if (always || SECRET_NAME.test(name) || scrubFiles([{ path: 'v', content: `${name} = "${v}"` }]).hits.length) values.add(v); };
  try { const d = JSON.parse(readFileSync(join(source, '.claude.json'), 'utf8')); for (const s of Object.values(d.mcpServers || {})) { for (const [k, v] of Object.entries(s.env || {})) consider(k, v); for (const [k, v] of Object.entries(s.headers || {})) consider(k, v, true); for (const a of s.args || []) if (scrubFiles([{ path: 'a', content: String(a) }]).hits.length) values.add(String(a)); } } catch { /* none */ }
  try { for (const [table, v] of Object.entries(tomlTables(readFileSync(join(source, '.codex/config.toml'), 'utf8')))) { const m = table.match(/^mcp_servers\.[^.]+\.(env|http_headers)$/); if (m) for (const [k, x] of Object.entries(v)) consider(k, x, m[1] === 'http_headers'); } } catch { /* none */ }
  return [...values];
}

const before = snapshot();
const root = realpathSync(mkdtempSync(join(tmpdir(), 'ccb-rehearsal-')));
const home = join(root, 'home'); mkdirSync(home);
const placeholder = join(root, 'link-target'); mkdirSync(placeholder);
const evidence = { schema: 1, at: new Date().toISOString(), host: hostname(), os: `${platform()} ${release()}`, sourceRevision: null, steps: [], checks: [] };
const checkThat = (label, ok, detail = '') => { evidence.checks.push({ label, state: ok ? 'confirmed' : 'failed', detail: String(detail).slice(0, 400) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` (${detail})`}`); return ok; };
const time = (label, fn) => { const t = Date.now(); const r = fn(); evidence.steps.push({ label, ms: Date.now() - t }); return r; };
try {
  for (const [dir, items] of Object.entries(COPY)) for (const item of items) { const from = join(source, dir, item); if (existsSync(from)) cpSync(from, join(home, dir, item), { recursive: true, verbatimSymlinks: true }); }
  if (existsSync(join(source, '.claude.json'))) { const d = JSON.parse(readFileSync(join(source, '.claude.json'), 'utf8')); writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: d.mcpServers || {} })); }
  for (const [dir, items] of Object.entries(PLACEHOLDERS)) for (const item of items) if (existsSync(join(source, dir, item))) { const p = join(home, dir, item); mkdirSync(dirname(p), { recursive: true }); if (/\.(json|jsonl)$/.test(item)) writeFileSync(p, '{}\n'); else mkdirSync(p, { recursive: true }); }
  const links = neuterLinks(home, placeholder);
  const secrets = secretValues();
  const base = { home, kit: REPO, probe: noProbe };
  const inv = time('inspect', () => inspect(base));
  evidence.shape = { links, secretValuesTracked: secrets.length, claude: { skills: inv.providers.claude.skills.length, commands: inv.providers.claude.commands.length, subagents: inv.providers.claude.subagents.length, mcp: inv.providers.claude.mcp.length }, codex: { skills: inv.providers.codex.skills.length, prompts: inv.providers.codex.commands.length, subagents: inv.providers.codex.subagents.length, mcp: inv.providers.codex.mcp.length } };
  let p = time('plan', () => plan({ ...base, intent: 'bridge', provider: 'claude' }));
  const seedConflict = p.conflicts.includes('instructions:portable');
  if (seedConflict) p = time('plan with a seed choice', () => plan({ ...base, intent: 'bridge', provider: 'claude', instructionsFrom: 'claude' }));
  const count = key => Object.fromEntries(['shared', 'claude-only', 'codex-only', 'translated', 'unsupported'].map(d => [d, p.items.filter(i => i.disposition === d).length]));
  evidence.plan = { dispositions: count(), conflicts: p.conflicts.length, conflictKinds: [...new Set(p.conflicts.map(c => c.split(':')[0]))], operations: p.operations.length, operationKinds: Object.fromEntries([...new Set(p.operations.map(o => o.op))].map(k => [k, p.operations.filter(o => o.op === k).length])), userSteps: p.userSteps.length, seedChoiceNeeded: seedConflict };
  const applied = time('apply', () => apply({ home, planId: p.id }));
  evidence.apply = { preserved: applied.preserved.length, removed: applied.removed.length, candidates: applied.candidates.length };
  const v = verify(base);
  const bad = v.checks.filter(c => ['failed', 'blocked', 'conflicted'].includes(c.state));
  checkThat('verify is healthy after the first apply', v.healthy, bad.map(c => `${c.name}: ${c.detail}`).join(' | '));
  evidence.verifyChecks = v.checks.length;
  const again = plan({ ...base, intent: 'bridge', provider: 'claude', instructionsFrom: 'claude' });
  checkThat('a repeat plan is a no-op', again.noop, again.operations.map(o => `${o.op}:${o.name || o.provider || o.key}`).join(', '));
  const st = status(base);
  evidence.status = { shared: st.shared.length, changed: st.changed.length, conflicted: st.conflicted.length, providerSpecific: st.providerSpecific.length, unsupported: st.unsupported.length, unhealthy: st.unhealthy.length };
  const claudeFile = readFileSync(join(home, '.claude/CLAUDE.md'), 'utf8');
  const codexFile = readFileSync(join(home, '.codex/AGENTS.md'), 'utf8');
  // Leak scan across everything the bridge produced.
  const produced = [];
  const collect = p => { let st; try { st = lstatSync(p); } catch { return; } if (st.isSymbolicLink()) return; if (st.isDirectory()) for (const e of readdirSync(p)) collect(join(p, e)); else produced.push(readFileSync(p, 'utf8')); };
  collect(join(home, '.selr/bridge'));
  produced.push(JSON.stringify([inv, p, applied, v, st]), claudeFile, codexFile);
  const leaks = secrets.filter(s => produced.some(t => t.includes(s)));
  checkThat('no MCP secret value appears in any plan, receipt, core file or report', leaks.length === 0, `${leaks.length} of ${secrets.length} values found`);
  // Removal and uninstall put the provider files back.
  const originalClaude = existsSync(join(source, '.claude/CLAUDE.md')) ? readFileSync(join(source, '.claude/CLAUDE.md'), 'utf8') : '';
  const originalCodex = existsSync(join(source, '.codex/AGENTS.md')) ? readFileSync(join(source, '.codex/AGENTS.md'), 'utf8') : '';
  const rm = plan({ ...base, intent: 'remove', removeProvider: 'codex' }); time('remove codex', () => apply({ home, planId: rm.id }));
  checkThat('removing Codex leaves AGENTS.md as it was', readFileSync(join(home, '.codex/AGENTS.md'), 'utf8').trim() === originalCodex.trim(), 'differs');
  checkThat('Claude stays healthy after Codex is removed', verify(base).healthy, verify(base).summary);
  const re = plan({ ...base, intent: 'bridge', provider: 'codex' }); time('re-add codex', () => apply({ home, planId: re.id }));
  checkThat('re-adding Codex is healthy', verify(base).healthy, verify(base).summary);
  const un = plan({ ...base, intent: 'uninstall' }); time('uninstall', () => apply({ home, planId: un.id }));
  checkThat('uninstall puts CLAUDE.md back to the original text', readFileSync(join(home, '.claude/CLAUDE.md'), 'utf8').trim() === originalClaude.trim(), 'differs');
  checkThat('uninstall leaves AGENTS.md as it was', readFileSync(join(home, '.codex/AGENTS.md'), 'utf8').trim() === originalCodex.trim(), 'differs');
} catch (error) { checkThat('rehearsal ran to the end', false, error.stack || error.message); }
finally {
  checkThat('the real home is byte-identical afterwards', snapshot() === before, 'changed');
  rmSync(root, { recursive: true, force: true });
  try { evidence.sourceRevision = (await import('node:child_process')).execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  evidence.status_ = evidence.checks.every(c => c.state === 'confirmed') ? 'passed' : 'failed';
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`${evidence.status_}: ${out}`);
  process.exitCode = evidence.status_ === 'passed' ? 0 : 1;
}
