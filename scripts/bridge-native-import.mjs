// Native importer capability probe. The bridge uses a vendor importer only for
// the artefacts and directions the installed product explicitly supports, and
// only as bootstrap. What it learns here is recorded in the plan, never assumed.
//
// Documented surfaces (research date 22 September 2026, docs/research):
// - Claude Code `/import codex` (v2.1.213+): instruction files, MCP servers,
//   commands, subagents, skills. Interactive slash command; in `-p` mode it
//   reports and prints the confirmation command instead of writing.
//   Unavailable on Bedrock, Vertex/Agent Platform, Foundry and gateway hosts.
// - Codex CLI `/import` from Claude Code: interactive in a local session.
import { execFileSync } from 'node:child_process';

export const CLAUDE_IMPORT_MIN = '2.1.213';
export const CLAUDE_IMPORT_ITEMS = ['instructions', 'mcp', 'commands', 'subagents', 'skills'];
export const CODEX_IMPORT_ITEMS = ['instructions', 'settings', 'skills', 'plugins', 'mcp', 'hooks', 'commands', 'subagents', 'memories', 'sessions'];
const RESTRICTED_ENV = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL', 'ANTHROPIC_FOUNDRY_BASE_URL'];

export const compareVersions = (a, b) => { const pa = a.split('.').map(Number), pb = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); } return 0; };
const defaultExec = (bin, args) => { try { return execFileSync(bin, args, { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

// Returns { provider (destination), source, available: true|false|'unknown',
// mode: 'interactive'|'programmatic'|'unavailable', version, items, command,
// reason }. `available` is never inferred from a version alone: the version
// gate is the vendor's documented minimum and the result is still verified by
// inspecting the destination afterwards.
export function probeNativeImport({ provider, exec = defaultExec, env = process.env } = {}) {
  const source = provider === 'claude' ? 'codex' : 'claude';
  if (provider === 'claude') {
    const restricted = RESTRICTED_ENV.find(name => env[name]);
    if (restricted) return { provider, source, available: false, mode: 'unavailable', version: null, items: [], command: null, reason: `Claude Code /import is unavailable on this host (${restricted} is set).` };
    const out = exec('claude', ['--version']);
    const version = out?.match(/\d+\.\d+\.\d+/)?.[0] || null;
    if (!version) return { provider, source, available: 'unknown', mode: 'unavailable', version: null, items: [], command: null, reason: 'Claude Code command line was not found, so its /import support is unknown.' };
    if (compareVersions(version, CLAUDE_IMPORT_MIN) < 0) return { provider, source, available: false, mode: 'unavailable', version, items: [], command: null, reason: `Claude Code ${version} is older than ${CLAUDE_IMPORT_MIN}, the first version that documents /import codex.` };
    return { provider, source, available: true, mode: 'interactive', version, items: CLAUDE_IMPORT_ITEMS, command: '/import codex', reason: `Claude Code ${version} documents /import codex for ${CLAUDE_IMPORT_ITEMS.join(', ')}. It is an interactive command: you run it in a Claude Code session and the bridge verifies the result afterwards.` };
  }
  const out = exec('codex', ['--version']);
  const version = out?.match(/\d+\.\d+\.\d+/)?.[0] || null;
  if (!version) return { provider, source, available: 'unknown', mode: 'unavailable', version: null, items: [], command: null, reason: 'Codex command line was not found, so its /import support is unknown.' };
  return { provider, source, available: 'unknown', mode: 'interactive', version, items: CODEX_IMPORT_ITEMS, command: '/import', reason: `Codex ${version} was found. OpenAI documents /import from Claude Code in a local Codex session, without a stated minimum version, so support is confirmed only by trying it. It is an interactive command; the bridge verifies the result afterwards.` };
}
