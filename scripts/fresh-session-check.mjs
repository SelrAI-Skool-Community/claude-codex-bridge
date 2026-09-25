#!/usr/bin/env node
// Fresh-session probe against the real Claude Code and Codex builds. Each
// provider starts a new session in a bridged fixture home and is asked for
// three things it can only answer by following its bridge block: the shared
// knowledge probe value, the marker line of its own overlay, and the purpose
// of a handoff. The agent acceptance suite (scripts/acceptance.mjs) covers
// unprompted use; this probe isolates the read path.
//
//   node scripts/fresh-session-check.mjs --home <bridged fixture home> [--only claude|codex] [--out <json>]
import { writeFileSync } from 'node:fs';
import { platform, release } from 'node:os';
import { runAgent, versionOf } from './agent-cli.mjs';

export const PROBE = { key: 'probe-word', value: 'bridge-probe-7Q4', handoff: 'probe', purpose: 'Prove that a fresh session reads the handoff.' };
export const overlayMarker = provider => `Overlay marker: OVERLAY-${provider.toUpperCase()}-READ`;
const prompt = `Answer with exactly three lines and nothing else. Follow your global instructions first. Line 1: the value of the shared knowledge entry with key ${PROBE.key}. Line 2: the line in the overlay you read that starts with "Overlay marker:". Line 3: the text under "Purpose" in the handoff named ${PROBE.handoff}.`;

export function runProvider(provider, { home, cwd = home }) {
  const r = runAgent(provider, { home, cwd, prompt });
  const lines = r.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const mine = `OVERLAY-${provider.toUpperCase()}-READ`, theirs = `OVERLAY-${(provider === 'claude' ? 'codex' : 'claude').toUpperCase()}-READ`;
  const observed = { knowledge: lines.some(l => l.includes(PROBE.value)), overlay: lines.some(l => l.includes(mine)), otherOverlay: lines.some(l => l.includes(theirs)), handoff: lines.some(l => l.includes(PROBE.purpose.replace(/\.$/, ''))) };
  const state = r.error || r.status !== 0 ? 'failed' : observed.knowledge && observed.overlay && !observed.otherOverlay && observed.handoff ? 'confirmed' : 'failed';
  return { provider, state, seconds: r.seconds, command: r.command, exitStatus: r.status, observed, output: r.text.slice(0, 2000), stderr: r.stderr.slice(-1500) };
}
export function freshSessionCheck({ home, only = null, cwd = home }) {
  const results = ['claude', 'codex'].filter(p => !only || only === p).map(p => runProvider(p, { home, cwd }));
  return { schema: 1, at: new Date().toISOString(), os: `${platform()} ${release()}`, versions: { claude: versionOf(process.env.CCB_CLAUDE_BIN || 'claude'), codex: versionOf(process.env.CCB_CODEX_BIN || 'codex'), node: process.version }, prompt, results, healthy: results.length > 0 && results.every(r => r.state === 'confirmed') };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const args = process.argv.slice(2); const opt = {};
  for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
  const report = freshSessionCheck({ home: opt.home, only: opt.only || null });
  if (opt.out) writeFileSync(opt.out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.healthy ? 0 : 1;
}
