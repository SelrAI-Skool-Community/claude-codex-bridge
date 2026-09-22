#!/usr/bin/env node
// Fresh-session verification against the real Claude Code and Codex builds.
// Each provider is started in a new session pointed at a bridged home and
// asked three things it can only answer by following its bridge block: the
// shared knowledge probe value, the marker line of its own overlay, and the
// purpose of a handoff. The answers are evidence; a file copy is not.
//
//   node scripts/fresh-session-check.mjs --home <bridged home> --claude-home <dir> --codex-home <dir> [--only claude|codex] [--out <json>]
//
// The child Claude session needs sign-in for its config dir: set
// CLAUDE_CODE_OAUTH_TOKEN (on macOS this script reads the existing keychain
// token when the variable is unset). The child Codex session needs an
// auth.json in its CODEX_HOME.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';

export const PROBE = { key: 'probe-word', value: 'bridge-probe-7Q4', handoff: 'probe', purpose: 'Prove that a fresh session reads the handoff.' };
export const overlayMarker = provider => `Overlay marker: OVERLAY-${provider.toUpperCase()}-READ`;
const prompt = `Answer with exactly three lines and nothing else. Follow your global instructions first. Line 1: the value of the shared knowledge entry with key ${PROBE.key}. Line 2: the line in the overlay you read that starts with "Overlay marker:". Line 3: the text under "Purpose" in the handoff named ${PROBE.handoff}.`;

function versionOf(bin) { try { return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim(); } catch { return null; } }
function keychainToken() {
  if (platform() !== 'darwin') return null;
  try { return JSON.parse(execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8' })).claudeAiOauth?.accessToken || null; } catch { return null; }
}
export function runProvider(provider, { home, configDir, cwd, env = process.env, timeout = 240000 }) {
  const started = new Date().toISOString();
  let out;
  if (provider === 'claude') {
    const childEnv = { ...env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN || keychainToken() || '' };
    out = spawnSync('claude', ['-p', prompt, '--output-format', 'text', '--allowedTools', 'Bash(node:*)', 'Read', 'Glob'], { cwd, env: childEnv, encoding: 'utf8', timeout });
  } else {
    const last = join(mkdtempSync(join(tmpdir(), 'ccb-codex-')), 'last.txt');
    out = spawnSync('codex', ['exec', '--skip-git-repo-check', '-C', cwd, '--output-last-message', last, prompt], { cwd, env: { ...env, CODEX_HOME: configDir }, encoding: 'utf8', timeout });
    if (existsSync(last)) out.stdout = readFileSync(last, 'utf8');
  }
  const text = (out.stdout || '').trim();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const observed = { knowledge: lines.some(l => l.includes(PROBE.value)), overlay: lines.some(l => l.includes(`OVERLAY-${provider.toUpperCase()}-READ`)), otherOverlay: lines.some(l => l.includes(`OVERLAY-${(provider === 'claude' ? 'codex' : 'claude').toUpperCase()}-READ`)), handoff: lines.some(l => l.includes(PROBE.purpose.replace(/\.$/, ''))) };
  const state = out.error || out.status !== 0 ? 'failed' : observed.knowledge && observed.overlay && !observed.otherOverlay && observed.handoff ? 'confirmed' : 'failed';
  return { provider, state, started, finished: new Date().toISOString(), command: provider === 'claude' ? 'claude -p <prompt> --output-format text --allowedTools Bash(node:*) Read Glob' : 'codex exec --skip-git-repo-check -C <cwd> --output-last-message <file> <prompt>', configDir, exitStatus: out.status, observed, output: text.slice(0, 2000), stderr: (out.stderr || '').slice(-1500) };
}
export function freshSessionCheck({ home, claudeHome, codexHome, only = null, cwd = home, env = process.env }) {
  const results = [];
  for (const [provider, dir] of [['claude', claudeHome], ['codex', codexHome]]) if (dir && (!only || only === provider)) results.push(runProvider(provider, { home, configDir: dir, cwd, env }));
  return { schema: 1, at: new Date().toISOString(), os: `${platform()} ${release()}`, versions: { claude: versionOf('claude'), codex: versionOf('codex'), node: process.version }, prompt, results, healthy: results.length > 0 && results.every(r => r.state === 'confirmed') };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2); const opt = {};
  for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
  const report = freshSessionCheck({ home: opt.home, claudeHome: opt['claude-home'], codexHome: opt['codex-home'], only: opt.only || null });
  if (opt.out) writeFileSync(opt.out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.healthy ? 0 : 1;
}
