// Provider adapters: everything the engine knows about where Claude Code and
// Codex keep their artefacts, and how to read them without reading secrets.
// Adapters only read here; every write goes through the engine's plan/apply.
//
// The instruction-file and skill-root rules follow claude-workshop-kit
// scripts/install-workshop.mjs `installProvider` at revision 563a8746 (ADR-0007):
// Claude uses its active configuration home's CLAUDE.md and `<config>/skills`;
// Codex uses AGENTS.md, or a nonempty AGENTS.override.md, and `~/.agents/skills`.
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hash, inventory, read } from './bridge-files.mjs';
import { scrubFiles } from './scrub.mjs';

export const PROVIDERS = ['claude', 'codex'];
export const BLOCK_BEGIN = '<!-- selr-bridge:begin -->';
export const BLOCK_END = '<!-- selr-bridge:end -->';
const isDir = p => { try { return lstatSync(p).isDirectory(); } catch { return false; } };
const isLink = p => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
const listDirs = dir => isDir(dir) ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => e.name).sort() : [];
const listFiles = (dir, ext) => isDir(dir) ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith(ext)).map(e => e.name).sort() : [];

export function configHome(provider, { home, providerHome, env = process.env }) {
  if (providerHome) return resolve(providerHome);
  const fromEnv = provider === 'claude' ? env.CLAUDE_CONFIG_DIR : env.CODEX_HOME;
  return resolve(fromEnv || join(home, provider === 'claude' ? '.claude' : '.codex'));
}

// The managed instruction file for a provider. A nonempty Codex override is the
// file Codex actually reads, so the managed block belongs there (ADR-0007).
export function instructionsPath(provider, config) {
  if (provider === 'claude') return join(config, 'CLAUDE.md');
  return read(join(config, 'AGENTS.override.md')).trim() ? join(config, 'AGENTS.override.md') : join(config, 'AGENTS.md');
}
export const skillRootFor = (provider, config, home) => provider === 'claude' ? join(config, 'skills') : join(home, '.agents/skills');

// Every managed block in an instruction file, plus whether the markers are
// unambiguous. Ambiguity (unpaired or repeated markers) stops any write.
export function managedBlocks(body) {
  const blocks = body.match(/<!-- selr-bridge:begin -->[\s\S]*?<!-- selr-bridge:end -->/g) || [];
  const begins = body.split(BLOCK_BEGIN).length - 1, ends = body.split(BLOCK_END).length - 1;
  return { blocks, ambiguous: begins !== blocks.length || ends !== blocks.length || blocks.length > 1 };
}
export const stripManagedBlocks = body => body.replace(/\n?<!-- selr-bridge:begin -->[\s\S]*?<!-- selr-bridge:end -->\n?/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');

// A skill directory as the engine sees it: files with hashes, links reported.
export function readSkill(dir) {
  if (isLink(dir)) return { linked: true, files: {}, links: [dir] };
  const { files, links } = inventory(dir);
  const hashes = {};
  for (const file of files) hashes[file] = hash(readFileSync(join(dir, file)));
  return { linked: false, files: hashes, links };
}
export const skillBlobs = dir => Object.keys(readSkill(dir).files).map(path => ({ path, content: readFileSync(join(dir, path), 'utf8') }));

// --- MCP: metadata in, secrets never out ------------------------------------
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|apikey|credential|cookie|auth)/i;
function mcpEntry(provider, name, raw) {
  const entry = { name, provider, transport: raw.url ? (raw.type || 'http') : 'stdio', authRequired: false, redacted: [] };
  const secretShaped = (label, value) => scrubFiles([{ path: `${name}.${label}`, content: String(value) }]).hits.length > 0;
  // A URL is kept only without user info and without a key-shaped query parameter.
  if (raw.url) { const url = String(raw.url); if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(url) || /[?&][^=&]*(token|key|secret|pass|auth|sig|credential)[^=&]*=/i.test(url) || secretShaped('url', url)) { entry.redacted.push('url'); entry.authRequired = true; } else entry.url = url; }
  if (raw.command) { const command = String(raw.command); if (secretShaped('command', command) || /\b[A-Z_]{3,}=\S+\s/.test(command)) { entry.redacted.push('command'); entry.authRequired = true; } else entry.command = command; }
  if (Array.isArray(raw.args)) {
    const scan = scrubFiles([{ path: `${name}.args`, content: raw.args.join('\n') }]);
    if (scan.hits.length) { entry.redacted.push('args'); entry.authRequired = true; } else entry.args = raw.args.map(String);
  }
  for (const key of Object.keys(raw)) {
    if (['env', 'headers', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'oauth', 'auth'].includes(key) || SECRET_KEY.test(key)) { entry.redacted.push(key); entry.authRequired = true; }
  }
  entry.redacted = [...new Set(entry.redacted)].sort();
  return entry;
}
// Minimal TOML table reader: enough for `[mcp_servers.<name>]` tables with
// simple `key = value` lines. Anything it cannot read is reported as unknown.
export function tomlTables(body) {
  const tables = {}; let current = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { current = header[1].trim().replace(/"/g, ''); tables[current] ||= {}; continue; }
    const kv = line.match(/^([A-Za-z0-9_."-]+)\s*=\s*(.*)$/);
    if (!kv || current === null) continue;
    const key = kv[1].replace(/^"|"$/g, ''); let value = kv[2].trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    else if (/^\[.*\]$/.test(value)) value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    else if (/^\{.*\}$/.test(value)) value = { inline: true };
    tables[current][key] = value;
  }
  return tables;
}
function mcpInventory(provider, config, home) {
  const servers = [];
  if (provider === 'claude') {
    for (const path of [join(config, '.claude.json'), join(home, '.claude.json')]) {
      if (!existsSync(path)) continue;
      let data; try { data = JSON.parse(read(path)); } catch { servers.push({ provider, name: '(unreadable)', source: path, unknown: true }); continue; }
      for (const [name, raw] of Object.entries(data.mcpServers || {})) servers.push({ ...mcpEntry(provider, name, raw || {}), source: path });
      break;
    }
  } else {
    const path = join(config, 'config.toml');
    if (existsSync(path)) {
      for (const [table, raw] of Object.entries(tomlTables(read(path)))) {
        const m = table.match(/^mcp_servers\.(.+)$/);
        if (!m || table.split('.').length !== 2) continue;
        servers.push({ ...mcpEntry(provider, m[1], raw), source: path });
      }
      for (const table of Object.keys(tomlTables(read(path)))) {
        const m = table.match(/^mcp_servers\.([^.]+)\.(env|http_headers|env_http_headers)$/);
        if (m) { const s = servers.find(x => x.name === m[1]); if (s) { s.authRequired = true; s.redacted = [...new Set([...s.redacted, m[2]])].sort(); } }
      }
    }
  }
  return servers;
}

// --- Discovery --------------------------------------------------------------
// The read-only picture of one provider. Private stores and credentials are
// listed by presence only; their contents are never opened.
export function discover(provider, { home, providerHome, env } = {}) {
  const config = configHome(provider, { home, providerHome, env });
  const present = isDir(config);
  const instructions = instructionsPath(provider, config);
  const body = read(instructions);
  const { blocks, ambiguous } = managedBlocks(body);
  const skillRoot = skillRootFor(provider, config, home);
  const skillRoots = provider === 'claude' ? [skillRoot] : [skillRoot, join(config, 'skills')];
  const skills = [];
  for (const root of skillRoots) for (const name of listDirs(root)) {
    const dir = join(root, name);
    if (!isLink(dir) && !existsSync(join(dir, 'SKILL.md'))) continue;
    skills.push({ name, root, dir, managedRoot: root === skillRoot, ...readSkill(dir) });
  }
  const commandsDir = provider === 'claude' ? join(config, 'commands') : join(config, 'prompts');
  const commands = listFiles(commandsDir, '.md').map(file => ({ name: file.replace(/\.md$/, ''), path: join(commandsDir, file), hash: hash(read(join(commandsDir, file))) }));
  const agentsDir = join(config, 'agents');
  const subagents = listFiles(agentsDir, provider === 'claude' ? '.md' : '.toml').map(file => ({ name: file.replace(/\.(md|toml)$/, ''), path: join(agentsDir, file) }));
  const settingsPath = provider === 'claude' ? join(config, 'settings.json') : join(config, 'config.toml');
  let hooks = { present: false };
  if (provider === 'claude' && existsSync(settingsPath)) { try { hooks = { present: Boolean(Object.keys(JSON.parse(read(settingsPath)).hooks || {}).length), source: settingsPath }; } catch { hooks = { present: 'unknown', source: settingsPath }; } }
  if (provider === 'codex') { const hooksPath = join(config, 'hooks.json'); hooks = { present: existsSync(hooksPath), source: hooksPath }; }
  const plugins = { present: isDir(join(config, 'plugins')) || (provider === 'codex' && /^\[plugins\./m.test(read(settingsPath))), source: provider === 'codex' ? settingsPath : join(config, 'plugins') };
  const privateStores = (provider === 'claude'
    ? [['transcripts', 'projects'], ['history', 'history.jsonl'], ['cache', 'cache'], ['automatic memory', 'memory'], ['todo lists', 'todos'], ['session data', 'sessions']]
    : [['sessions', 'sessions'], ['archived sessions', 'archived_sessions'], ['memories', 'memories'], ['history', 'history.jsonl'], ['cache', 'cache'], ['dictation history', 'dictation-history'], ['session imports', 'external_agent_session_imports.json']])
    .map(([kind, rel]) => ({ kind, path: join(config, rel), present: existsSync(join(config, rel)) }));
  const credentials = (provider === 'claude' ? ['.credentials.json'] : ['auth.json']).map(rel => ({ path: join(config, rel), present: existsSync(join(config, rel)) }));
  return {
    provider, present, config, home,
    instructions: { path: instructions, exists: existsSync(instructions), hash: existsSync(instructions) ? hash(body) : null, managedBlocks: blocks.length, ambiguous, userBody: stripManagedBlocks(body), bytes: body.length },
    skillRoot, skills, commands, subagents,
    settings: { path: settingsPath, present: existsSync(settingsPath) },
    hooks, plugins, mcp: mcpInventory(provider, config, home), privateStores, credentials,
  };
}

// The names a skill file uses that tie it to one provider. The check is
// textual and conservative: a match makes a skill provider-specific, never the
// reverse. Anything mentioning the other provider by tool name is reported.
const PROVIDER_MARKS = {
  claude: [/\bmcp__[A-Za-z0-9_-]+/, /\$\{?CLAUDE_PLUGIN_ROOT\}?/, /\bCLAUDE_CONFIG_DIR\b/, /\bclaude\s+(-p|--print)\b/, /\ballowed-tools:/i, /\bdisable-model-invocation:/i, /\bclaude-(opus|sonnet|haiku|fable)-[0-9]/, /\bAskUserQuestion\b|\bTodoWrite\b|\bNotebookEdit\b/],
  codex: [/\bCODEX_HOME\b/, /\bcodex\s+exec\b/, /\bgpt-[0-9](?:\.[0-9])?-[a-z]+\b/, /\bmodel_reasoning_effort\b/, /\bconfig\.toml\b/, /\bfork_turns\b/],
};
export function providerAssumptions(blobs) {
  const found = { claude: [], codex: [] };
  for (const { path, content } of blobs) {
    const lines = content.split(/\r?\n/);
    for (const [provider, rules] of Object.entries(PROVIDER_MARKS)) for (const rule of rules) {
      const at = lines.findIndex(l => rule.test(l));
      if (at >= 0) found[provider].push({ path, line: at + 1, mark: lines[at].match(rule)[0] });
    }
  }
  return found;
}
export const fileSize = p => { try { return statSync(p).size; } catch { return null; } };
