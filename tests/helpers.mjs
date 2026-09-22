// Fixture homes and a thin wrapper over the public workflow. Every test asks
// the workflow to inspect or change a fixture, then reads the resulting files,
// receipts and reports; internal helpers are not separate testing seams.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, inspect, plan, status, verify } from '../scripts/bridge-engine.mjs';

export const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
export const noProbe = ({ provider }) => ({ provider, source: provider === 'claude' ? 'codex' : 'claude', available: false, mode: 'unavailable', version: null, items: [], command: null, reason: 'Native importer probing is disabled in this fixture.' });

export function fixtureHome(label = 'bridge') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `selr-${label}-`)));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const config = provider => join(home, provider === 'claude' ? '.claude' : '.codex');
  const skillRoot = provider => provider === 'claude' ? join(home, '.claude/skills') : join(home, '.agents/skills');
  const instructions = provider => join(config(provider), provider === 'claude' ? 'CLAUDE.md' : 'AGENTS.md');
  const write = (path, body) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
  const seed = (provider, { instructions: text = null, skills = {}, commands = {}, files = {} } = {}) => {
    mkdirSync(config(provider), { recursive: true });
    if (text !== null) write(instructions(provider), text);
    for (const [name, skillFiles] of Object.entries(skills)) for (const [file, body] of Object.entries(skillFiles)) write(join(skillRoot(provider), name, file), body);
    for (const [name, body] of Object.entries(commands)) write(join(config(provider), provider === 'claude' ? 'commands' : 'prompts', `${name}.md`), body);
    for (const [rel, body] of Object.entries(files)) write(join(config(provider), rel), body);
  };
  const readText = path => existsSync(path) ? readFileSync(path, 'utf8') : null;
  const manifest = () => JSON.parse(readFileSync(join(home, '.selr/bridge/manifest.json'), 'utf8'));
  const core = join(home, '.selr/bridge/core');
  return { root, home, core, config, skillRoot, instructions, write, seed, readText, manifest, skillPath: (provider, name, file = 'SKILL.md') => join(skillRoot(provider), name, file), corePath: (...parts) => join(core, ...parts), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
export const skill = (name, body = 'Do the thing.\n', extra = {}) => ({ 'SKILL.md': `---\nname: ${name}\ndescription: ${name} skill.\n---\n${body}`, ...extra });
const common = (fx, opts) => ({ home: fx.home, kit: REPO, probe: noProbe, ...opts });
export const B = {
  inspect: (fx, opts = {}) => inspect(common(fx, opts)),
  plan: (fx, opts = {}) => plan(common(fx, { intent: 'bridge', provider: 'claude', host: 'cli', ...opts })),
  apply: (fx, planId, opts = {}) => apply({ home: fx.home, planId, ...opts }),
  bridge: (fx, opts = {}) => { const p = plan(common(fx, { intent: 'bridge', provider: 'claude', host: 'cli', ...opts })); return { plan: p, result: apply({ home: fx.home, planId: p.id, ...(opts.applyOptions || {}) }) }; },
  verify: (fx, opts = {}) => verify(common(fx, opts)),
  status: (fx, opts = {}) => status(common(fx, opts)),
  remove: (fx, provider, opts = {}) => { const p = plan(common(fx, { intent: 'remove', removeProvider: provider, ...opts })); return { plan: p, result: apply({ home: fx.home, planId: p.id }) }; },
  uninstall: (fx, opts = {}) => { const p = plan(common(fx, { intent: 'uninstall', ...opts })); return { plan: p, result: apply({ home: fx.home, planId: p.id }) }; },
};
export const item = (p, id) => p.items.find(i => i.id === id);
export const ops = p => p.operations.map(o => o.op);
