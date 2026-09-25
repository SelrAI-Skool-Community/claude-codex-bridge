#!/usr/bin/env node
// Command line for the Claude + Codex Bridge engine. Every command prints one
// JSON document; the skill relays its `summary` in plain language.
//
//   inspect                     read-only inventory of both providers and the core
//   plan [options]              read-only proposal; prints a plan id
//   apply --plan <id>           perform exactly that plan's operations
//   verify                      read the resulting state and report evidence
//   status                      shared / changed / conflicted / provider-specific / unsupported / unhealthy
//   sync                        alias of plan (the same reconciliation, previewed)
//   remove --remove-provider <claude|codex>   plan a provider removal
//   uninstall                   plan removal of every provider and unchanged bridge files
//   handoff create --input <json> --provider <claude|codex> | handoff list | handoff show --name <name>
//
// Options: --home <dir> --kit <dir> --provider <claude|codex> --host <desktop|cli>
//   --claude-home <dir> --codex-home <dir> --only a,b --skip a,b
//   --instructions-from <claude|codex|none> --resolve <name>=<choice> (repeatable)
//   --project <dir> (repeatable: share that project's AGENTS.md with both providers)
//   --keep-provider-instructions (copy seeded instructions instead of moving them)
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { apply, inspect, kitVersion, plan, status, verify } from './bridge-engine.mjs';
import { createHandoff, listHandoffs } from './bridge-handoff.mjs';
import { read } from './bridge-files.mjs';
import { paths } from './bridge-engine.mjs';
import { join, resolve } from 'node:path';

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { resolve: {}, skip: [], only: null, providerHomes: {}, projects: [] };
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i], value = rest[i + 1];
    const take = () => { if (value === undefined || value.startsWith('--')) throw Error(`${name} needs a value.`); i++; return value; };
    switch (name) {
      case 'create': case 'list': case 'show': options.sub = name; break;
      case '--home': options.home = take(); break;
      case '--kit': options.kit = take(); break;
      case '--provider': options.provider = take(); break;
      case '--host': options.host = take(); break;
      case '--claude-home': options.providerHomes.claude = take(); break;
      case '--codex-home': options.providerHomes.codex = take(); break;
      case '--only': options.only = take().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--skip': options.skip.push(...take().split(',').map(s => s.trim()).filter(Boolean)); break;
      case '--instructions-from': options.instructionsFrom = take(); break;
      case '--resolve': { const [k, v] = take().split('='); if (!k || !v) throw Error('--resolve takes <name>=<claude|codex|core|keep-separate>'); options.resolve[k] = v; break; }
      case '--remove-provider': options.removeProvider = take(); break;
      case '--project': options.projects.push(resolve(take())); break;
      case '--keep-provider-instructions': options.keepProviderInstructions = true; break;
      case '--plan': options.planId = take(); break;
      case '--input': options.input = take(); break;
      case '--name': options.name = take(); break;
      default: throw Error(`Unknown option ${name}. See the usage at the top of scripts/bridge.mjs.`);
    }
  }
  if (options.provider && !['claude', 'codex'].includes(options.provider)) throw Error('--provider must be claude or codex.');
  if (options.host && !['desktop', 'cli'].includes(options.host)) throw Error('--host must be desktop or cli.');
  if (options.instructionsFrom && !['claude', 'codex', 'none'].includes(options.instructionsFrom)) throw Error('--instructions-from must be claude, codex or none.');
  for (const [k, v] of Object.entries(options.resolve)) if (!['claude', 'codex', 'core', 'keep-separate'].includes(v)) throw Error(`--resolve ${k}: choose claude, codex, core or keep-separate.`);
  return { command, options };
}

export function run(argv, env = process.env) {
  const { command, options } = parseArgs(argv);
  // An explicit --home is a complete fixture: the shell's CLAUDE_CONFIG_DIR and
  // CODEX_HOME must not reach into it unless a provider home is named too.
  const isolated = options.home ? Object.fromEntries(Object.entries(env).filter(([k]) => !['CLAUDE_CONFIG_DIR', 'CODEX_HOME'].includes(k))) : env;
  const common = { home: options.home || homedir(), kit: options.kit, providerHomes: { claude: options.providerHomes.claude, codex: options.providerHomes.codex }, env: isolated };
  switch (command) {
    case 'inspect': return inspect(common);
    case 'plan': case 'sync': return plan({ ...common, intent: 'bridge', provider: options.provider, host: options.host || 'cli', only: options.only, skip: options.skip, instructionsFrom: options.instructionsFrom, resolve: options.resolve, projects: options.projects, keepProviderInstructions: options.keepProviderInstructions });
    case 'remove': if (!['claude', 'codex'].includes(options.removeProvider)) throw Error('Say which provider to remove: --remove-provider claude|codex.'); return plan({ ...common, intent: 'remove', removeProvider: options.removeProvider, provider: options.provider, host: options.host || 'cli' });
    case 'uninstall': return plan({ ...common, intent: 'uninstall', provider: options.provider, host: options.host || 'cli' });
    case 'apply': return apply({ home: common.home, planId: options.planId });
    case 'verify': return verify(common);
    case 'status': return status(common);
    case 'handoff': {
      if (options.sub === 'create') { if (!options.input) throw Error('handoff create needs --input <json file>.'); return createHandoff({ home: common.home, input: JSON.parse(read(options.input) || 'null'), provider: options.provider, kitVersion: kitVersion(options.kit || join(fileURLToPath(import.meta.url), '../..')) }); }
      if (options.sub === 'list') return { handoffs: listHandoffs({ home: common.home }) };
      if (options.sub === 'show') { if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.name || '')) throw Error('handoff show needs --name <short lower-case name>.'); const path = join(paths(common.home).handoffs, `${options.name}.md`); const body = read(path); if (!body) throw Error(`No handoff named "${options.name}".`); return { name: options.name, path, body }; }
      throw Error('handoff takes create, list or show.');
    }
    default: throw Error('Commands: inspect, plan, apply, verify, status, sync, remove, uninstall, handoff. See scripts/bridge.mjs for options.');
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(run(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
