// The bridge engine: one deterministic workflow, inspect → plan → apply → verify,
// used by both provider-facing skills. Inspection and planning read provider
// state and write nothing outside the bridge's own plans folder. Apply consumes
// an immutable plan id and performs only that plan's operations, recording each
// write in the receipt's `pending` section before a byte lands (ADR-0009 of the
// Workshop Kit, ported). Verify reads the resulting state and reports evidence.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, hash, read, safePath, save, sweepTemps, tree } from './bridge-files.mjs';
import { installSkill, retireSkill } from './bridge-skills.mjs';
import { BLOCK_BEGIN, BLOCK_END, PROVIDERS, discover, managedBlocks, providerAssumptions, readSkill, skillBlobs } from './bridge-adapters.mjs';
import { probeNativeImport } from './bridge-native-import.mjs';
import { reconcileSkill } from './bridge-reconcile.mjs';
import { scrubFiles } from './scrub.mjs';
import { checkPortability } from './portability.mjs';

export const OWNER = 'selr-bridge';
export const DISPOSITIONS = ['shared', 'claude-only', 'codex-only', 'translated', 'unsupported'];
const KIT_DEFAULT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const other = p => p === 'claude' ? 'codex' : 'claude';
const short = v => typeof v === 'string' ? v.slice(0, 9) : 'unknown';
const dirHash = files => hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
const skillFilesHash = dir => existsSync(dir) ? dirHash(readSkill(dir).files) : null;
// The managed block. Claude Code loads `@path` imports into context at session
// start, so its block imports the portable instructions, its overlay and the
// knowledge contract: tested live, a pointer alone was not followed unprompted.
// Codex has no import syntax and follows the pointer (tested live as well).
export const importPath = path => path.replace(/\\/g, '/');
export const adapterBlock = ({ core, kit, provider, instructions, overlay, contract }) => provider === 'claude'
  ? `${BLOCK_BEGIN}\n## Claude + Codex Bridge\n\nKit home: ${kit}\nBridge core: ${core}\nCurrent provider: claude. The portable instructions, the Claude overlay and the knowledge contract follow.\n\n@${importPath(instructions)}\n@${importPath(overlay)}\n@${importPath(contract)}\n${BLOCK_END}`
  : `${BLOCK_BEGIN}\n## Claude + Codex Bridge\n\nKit home: ${kit}\nBridge core: ${core}\nCurrent provider: ${provider}.\nAt the first message of each task, read ${instructions}, then ${overlay}, then follow ${contract}.\n${BLOCK_END}`;
const validName = name => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) && !name.includes('..');

export function kitVersion(kit) {
  try { return execFileSync('git', ['-C', kit, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* not a checkout */ }
  const version = read(join(kit, 'VERSION')).trim();
  return version ? `file:${version}` : 'unknown';
}
export const sharedRoot = home => join(home, '.selr/bridge');
export const paths = home => { const shared = sharedRoot(home); const core = join(shared, 'core'); return { shared, core, manifest: join(shared, 'manifest.json'), plans: join(shared, 'plans'), conflicts: join(shared, 'conflicts'), memory: join(core, 'memory.mjs'), contract: join(core, 'knowledge-contract.md'), instructions: join(core, 'instructions.md'), overlays: join(core, 'overlays'), skills: join(core, 'skills'), handoffs: join(core, 'handoffs'), mcp: join(core, 'mcp-inventory.json'), knowledge: join(core, 'knowledge.json') }; };

function freshManifest(home, kit) {
  return { schema: 1, owner: OWNER, createdAt: new Date().toISOString(), kit: { home: kit, version: null }, core: { root: paths(home).core, skills: {}, overlays: {}, handoffs: {} }, providers: {}, nativeImports: [] };
}
export function loadManifest(home) {
  const { manifest: path } = paths(home);
  if (!existsSync(path)) return null;
  if (lstatSync(path).isSymbolicLink()) throw Error('Bridge receipt is a link; left unchanged.');
  let data; try { data = JSON.parse(read(path)); } catch { throw Error('Bridge receipt is unreadable; left unchanged. Restore it from a backup or remove it deliberately.'); }
  if (data.schema !== 1 || data.owner !== OWNER || typeof data.providers !== 'object' || typeof data.core !== 'object') throw Error('Unrecognised bridge receipt; left unchanged.');
  return data;
}

// --- Inspect ------------------------------------------------------------------
// The read-only picture: both providers, the portable core, the receipt, locks
// and native importer capability. Nothing here writes.
export function inspect({ home = homedir(), kit = KIT_DEFAULT, providerHomes = {}, env = process.env, probe = probeNativeImport } = {}) {
  home = realpathSync(resolve(home)); kit = realpathSync(resolve(kit));
  const p = paths(home);
  const manifest = loadManifest(home);
  const providers = {};
  for (const provider of PROVIDERS) providers[provider] = discover(provider, { home, providerHome: providerHomes[provider] || manifest?.providers?.[provider]?.config, env });
  const coreSkills = {};
  if (existsSync(p.skills)) for (const name of readdirSync(p.skills).sort()) { const dir = join(p.skills, name); try { if (lstatSync(dir).isDirectory()) coreSkills[name] = readSkill(dir); } catch { /* unreadable entry */ } }
  let knowledge = { present: existsSync(p.knowledge), readable: null, entries: 0 };
  if (knowledge.present) { try { const data = JSON.parse(read(p.knowledge)); knowledge = { present: true, readable: data.schema === 1 && data.entries && !Array.isArray(data.entries), entries: Object.keys(data.entries || {}).length }; } catch { knowledge.readable = false; } }
  const handoffs = existsSync(p.handoffs) ? readdirSync(p.handoffs).filter(f => f.endsWith('.md')).sort() : [];
  const overlays = Object.fromEntries(PROVIDERS.map(x => [x, { path: join(p.overlays, `${x}.md`), exists: existsSync(join(p.overlays, `${x}.md`)), hash: existsSync(join(p.overlays, `${x}.md`)) ? hash(read(join(p.overlays, `${x}.md`))) : null }]));
  const core = { root: p.core, exists: existsSync(p.core), instructions: { path: p.instructions, exists: existsSync(p.instructions) }, contract: { path: p.contract, exists: existsSync(p.contract), hash: existsSync(p.contract) ? hash(read(p.contract)) : null }, memory: { path: p.memory, exists: existsSync(p.memory), hash: existsSync(p.memory) ? hash(read(p.memory)) : null }, overlays, skills: coreSkills, knowledge, handoffs, mcpInventory: { path: p.mcp, exists: existsSync(p.mcp) } };
  const lock = join(p.shared, 'operation.lock');
  const receipt = { path: p.manifest, exists: Boolean(manifest), pending: manifest?.pending || null, lock: existsSync(lock), kitVersion: manifest?.kit?.version || null, providers: Object.fromEntries(Object.entries(manifest?.providers || {}).map(([k, v]) => [k, { ready: v.ready, host: v.host, installedAt: v.installedAt }])) };
  const nativeImport = Object.fromEntries(PROVIDERS.map(x => [x, providers[x].present ? probe({ provider: x, env }) : { provider: x, source: other(x), available: false, mode: 'unavailable', version: null, items: [], command: null, reason: `${x} is not installed here.` }]));
  const found = PROVIDERS.filter(x => providers[x].present);
  const count = (x, key) => providers[x][key].length;
  const summary = found.length
    ? `${found.map(x => `${x === 'claude' ? 'Claude Code' : 'Codex'}: ${count(x, 'skills')} skills, ${count(x, 'commands')} ${x === 'claude' ? 'commands' : 'prompts'}, ${count(x, 'subagents')} subagents, ${count(x, 'mcp')} MCP servers, ${providers[x].privateStores.filter(s => s.present).length} private stores left alone`).join('; ')}. ${manifest ? `Bridge receipt present for ${Object.keys(manifest.providers).join(' and ') || 'no provider'}${manifest.pending ? '; an operation stopped part-way' : ''}.` : 'No bridge installed yet.'} Nothing was changed.`
    : 'Neither Claude Code nor Codex configuration was found on this computer. Nothing was changed.';
  return { schema: 1, home, kit, kitVersion: kitVersion(kit), providers, core, receipt, nativeImport, conflictsRoot: p.conflicts, summary };
}

// --- Classify -----------------------------------------------------------------
// Every discovered artefact gets one disposition, a reason, and whether the
// user must act. This is pure over the inspection result and the options.
const translatable = body => {
  const reasons = [];
  if (/\$ARGUMENTS|\$[0-9]\b/.test(body)) reasons.push('takes arguments');
  if (/^!`|(^|\n)!\S/.test(body) || /!`[^`]+`/.test(body)) reasons.push('runs shell interpolation');
  if (/(^|\s)@[A-Za-z0-9_./~-]+/.test(body)) reasons.push('references files by @path');
  if (/^allowed-tools:/m.test(body)) reasons.push('restricts tools in provider-specific frontmatter');
  return reasons;
};
const frontmatter = body => { const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/); if (!m) return { data: {}, body }; const data = {}; for (const line of m[1].split(/\r?\n/)) { const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/); if (kv) data[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, ''); } return { data, body: body.slice(m[0].length) }; };
export function translateCommandToSkill({ name, body, provider }) {
  const { data, body: text } = frontmatter(body);
  const description = (data.description || text.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#')) || `Imported ${provider} command ${name}.`).slice(0, 200);
  return { 'SKILL.md': `---\nname: ${name}\ndescription: ${description.replace(/\n/g, ' ')}\n---\n\n${text.trim()}\n\nTranslated from the ${provider} command \`${name}\` by the Claude + Codex Bridge (translator: ${provider}-command-to-skill).\n` };
}

// Selected-project instructions: AGENTS.md is the portable file (Codex reads it,
// Claude Code 2.1.277+ reads it directly, and a CLAUDE.md holding only
// `@AGENTS.md` is the documented fallback). The bridge owns that pointer only.
export const PROJECT_POINTER = '@AGENTS.md\n';
export function classifyProjects(inv, projects) {
  const items = [];
  const receipts = inv.manifest?.projects || {};
  const staged = Object.entries(inv.manifest?.pending?.files || {}).filter(([path, h]) => path.endsWith(`${sep}CLAUDE.md`) && h === hash(PROJECT_POINTER)).map(([path]) => dirname(path));
  for (const dir of [...new Set([...projects, ...Object.keys(receipts), ...staged])].sort()) {
    const agents = join(dir, 'AGENTS.md'), claude = join(dir, 'CLAUDE.md');
    const hasAgents = existsSync(agents), hasClaude = existsSync(claude);
    const owned = receipts[dir];
    const claudeBody = read(claude);
    const item = (disposition, fields) => items.push({ id: `project:${dir}`, kind: 'project', name: dir, disposition, collision: 'none', userAction: null, source: agents, destination: claude, ...fields });
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) { item('unsupported', { reason: 'This project folder was not found.' }); continue; }
    if (hasAgents && !hasClaude) item('translated', { translator: 'agents-md-pointer', reason: 'AGENTS.md is the portable project instruction file. A CLAUDE.md holding only `@AGENTS.md` makes Claude Code read it in every session, including sessions without direct AGENTS.md support.' });
    else if (hasAgents && hasClaude && claudeBody === PROJECT_POINTER) item('translated', { translator: 'agents-md-pointer', reason: owned && owned.hash === hash(claudeBody) ? 'The pointer is in place and bridge-owned.' : 'A CLAUDE.md pointer to AGENTS.md already exists; the bridge records it as owned so it can be removed with the bridge.', already: true, adopt: !owned });
    else if (hasAgents && hasClaude) item('unsupported', { collision: owned && owned.hash !== hash(claudeBody) ? 'customised' : 'both-exist', userAction: `${dir} has both AGENTS.md and a CLAUDE.md with its own content. Move the CLAUDE.md content into AGENTS.md and leave CLAUDE.md as \`@AGENTS.md\`, then plan again.`, reason: 'Two project instruction files with different content are never merged silently.' });
    else if (!hasAgents && hasClaude) item('claude-only', { source: claude, destination: null, userAction: `Rename ${claude} to AGENTS.md (Codex reads it; Claude Code reads it directly or through the pointer the bridge adds), then plan again.`, reason: 'Only Claude reads CLAUDE.md. The portable project file is AGENTS.md.' });
    else item('unsupported', { reason: 'No project instruction file was found in this folder.' });
  }
  return items;
}
export function classify(inv, { only = null, skip = [], forceShare = [], instructionsFrom = null, resolve: resolutions = {}, projects = [] } = {}) {
  const items = [...classifyProjects(inv, projects)];
  const receiptProviders = inv.receipt.providers;
  const present = Object.fromEntries(PROVIDERS.map(p => [p, inv.providers[p].present]));
  const managed = (provider, name) => Boolean(receiptProviders[provider] && inv.manifest?.providers?.[provider]?.skills?.[name]);
  // A copy consisting only of files a stopped run recorded before writing is
  // the bridge's own unfinished work: it is neither a candidate nor a twin.
  const pendingFiles = inv.manifest?.pending?.files || {};
  const stagedOnly = skill => !skill.relocatedFrom && Object.keys(skill.files).length > 0 && Object.entries(skill.files).every(([file, h]) => pendingFiles[join(skill.dir, file)] === h);
  const reconciled = name => Boolean(inv.manifest?.core?.skills?.[name]?.baseline);
  const item = (kind, name, disposition, fields) => items.push({ id: `${kind}:${name}`, kind, name, disposition, collision: 'none', userAction: null, ...fields });
  // Instructions: each provider's own file is user-owned and preserved; the
  // portable core is seeded once from a provider's unrelated content.
  const bodies = Object.fromEntries(PROVIDERS.filter(p => present[p]).map(p => [p, inv.providers[p].instructions.userBody.trim()]));
  const nonEmpty = Object.entries(bodies).filter(([, b]) => b);
  const staged = inv.manifest?.pending?.files?.[inv.core.instructions.path];
  if (inv.core.instructions.exists && !inv.manifest?.core?.instructions && staged && staged === hash(read(inv.core.instructions.path))) item('instructions', 'portable', 'shared', { source: 'stopped run', destination: inv.core.instructions.path, reason: 'The portable instructions were written by an operation that stopped before recording them; this run records them as they are.', recovered: true });
  else if (!inv.core.instructions.exists) {
    if (!nonEmpty.length) item('instructions', 'portable', 'shared', { source: 'kit default', destination: inv.core.instructions.path, reason: 'No existing global instructions were found, so the portable instructions start from the kit default.' });
    else if (nonEmpty.length === 1 || nonEmpty.every(([, b]) => b === nonEmpty[0][1]) || instructionsFrom === 'none') {
      const [from] = instructionsFrom === 'none' ? [null] : nonEmpty[0];
      item('instructions', 'portable', 'shared', { source: from ? inv.providers[from].instructions.path : 'kit default', destination: inv.core.instructions.path, reason: from ? `Your ${from} global instructions seed the portable instructions. The original file stays as it is; only a small bridge block is added to it.` : 'You chose to start the portable instructions from the kit default.' });
    } else if (instructionsFrom && present[instructionsFrom]) item('instructions', 'portable', 'shared', { source: inv.providers[instructionsFrom].instructions.path, destination: inv.core.instructions.path, reason: `You chose your ${instructionsFrom} global instructions as the portable seed.` });
    else item('instructions', 'portable', 'shared', { source: nonEmpty.map(([p]) => inv.providers[p].instructions.path).join(' | '), destination: inv.core.instructions.path, collision: 'conflict', userAction: 'Your Claude and Codex global instructions differ. Choose which one seeds the portable instructions with --instructions-from claude|codex|none.', reason: 'Both providers have global instructions and they differ; the bridge never merges them silently.' });
  }
  const seeding = items.find(i => i.kind === 'instructions' && i.id === 'instructions:portable');
  for (const provider of PROVIDERS) {
    if (!present[provider]) continue;
    const found = inv.providers[provider];
    const ownBody = bodies[provider];
    const portableBody = inv.core.instructions.exists ? read(inv.core.instructions.path).trim() : null;
    const seededFromHere = (seeding && seeding.collision !== 'conflict' && (seeding.source === found.instructions.path || (seeding.source === inv.providers[other(provider)]?.instructions.path && ownBody === bodies[other(provider)]))) || (seeding?.recovered && ownBody === portableBody);
    if (ownBody && !seededFromHere) item('instructions', provider, `${provider}-only`, { source: found.instructions.path, destination: null, reason: `The rest of ${found.instructions.path} is read by ${provider} only. Move lines that should apply in both apps into ${inv.core.instructions.path}.` });
    if (found.instructions.ambiguous) item('instruction-block', provider, 'unsupported', { source: found.instructions.path, destination: found.instructions.path, collision: 'ambiguous-markers', userAction: `Repair the bridge markers in ${found.instructions.path}: there must be one begin and one end marker, or none.`, reason: 'The bridge instruction markers in this file are ambiguous, so the file is left unchanged.' });
    else item('instruction-block', provider, `${provider}-only`, { source: 'bridge', destination: found.instructions.path, reason: `A small managed block in this file points ${provider} at the portable instructions, its own overlay and the shared knowledge contract. Everything else in the file stays yours.` });
    for (const skill of found.skills) {
      const name = skill.name;
      if (managed(provider, name) || reconciled(name)) continue; // reconciled under sync
      if (stagedOnly(skill)) continue;
      if (name === 'claude-codex-bridge') continue; // the kit's own skill is planned from the kit
      if (!validName(name)) { item('skill', `${provider}/${name}`, 'unsupported', { source: skill.dir, destination: null, reason: 'This skill folder name cannot be represented safely; it is left where it is.' }); continue; }
      if (skill.linked || skill.links.length) {
        // Both apps already loading the same folder through the user's own links
        // is sharing the bridge leaves as it is; any other link stays put.
        const real = dir => { try { return realpathSync(dir); } catch { return null; } };
        const twinLink = inv.providers[other(provider)].present ? inv.providers[other(provider)].skills.find(s => s.name === name && s.linked) : null;
        if (skill.linked && twinLink && real(skill.dir) && real(skill.dir) === real(twinLink.dir)) { if (provider === 'claude') item('skill', name, 'shared', { source: `${skill.dir} and ${twinLink.dir}`, destination: null, collision: 'linked', reason: 'Both apps already load this skill from the same folder through your own links. The bridge leaves the links as they are.' }); continue; }
        item('skill', `${provider}/${name}`, `${provider}-only`, { source: skill.dir, destination: null, reason: 'This skill is a link or contains one, so it stays where it is; the bridge copies ordinary files only.' }); continue;
      }
      if (skill.legacyDuplicate) { const same = skill.legacyDuplicate === 'identical'; item('skill', `${provider}/${name}@legacy`, same ? `${provider}-only` : 'unsupported', { source: skill.dir, destination: same ? null : null, collision: same ? 'duplicate' : 'duplicate-different', userAction: same ? null : `Codex has two different copies of "${name}": ${skill.dir} and ${join(found.skillRoot, name)}. Keep one, then plan again.`, reason: same ? `Codex already loads this skill twice: an identical copy is in ${found.skillRoot}. The copy in ${skill.root} is removed so Codex sees it once.` : 'Two different copies with one name confuse Codex; the bridge leaves both until you choose.', removeLegacy: same }); continue; }
      if (!skill.managedRoot) { item('skill', `${provider}/${name}`, `${provider}-only`, { source: skill.dir, destination: null, reason: `Found in ${provider}'s secondary skill folder ${skill.root}. The bridge manages ${found.skillRoot}; move it there to share it.` }); continue; }
      if (skip.includes(name)) { item('skill', `${provider}/${name}`, `${provider}-only`, { source: skill.dir, destination: null, reason: 'You asked to keep this skill provider-specific.' }); continue; }
      if (only && !only.includes(name)) { item('skill', `${provider}/${name}`, `${provider}-only`, { source: skill.dir, destination: null, reason: 'Not in the selection you asked to share.' }); continue; }
      let blobs; try { blobs = skillBlobs(skill.relocatedFrom || skill.dir); } catch { item('skill', `${provider}/${name}`, 'unsupported', { source: skill.dir, destination: null, reason: 'This skill could not be read completely, so it is not shared.' }); continue; }
      const scrub = scrubFiles(blobs);
      if (scrub.hits.length) { item('skill', `${provider}/${name}`, 'unsupported', { source: skill.dir, destination: null, userAction: `Remove the secret from ${scrub.hits.map(h => `${h.path}:${h.line} (${h.ruleId})`).join(', ')} before sharing.`, reason: 'A secret-shaped value was found inside this skill. Nothing containing a secret is copied.' }); continue; }
      const marks = providerAssumptions(blobs);
      const assumes = marks[provider].length ? provider : marks[other(provider)].length ? other(provider) : null;
      if (assumes && !forceShare.includes(name)) { item('skill', `${provider}/${name}`, `${assumes}-only`, { source: skill.dir, destination: null, reason: `This skill assumes ${assumes} (${marks[assumes].slice(0, 3).map(m => `${m.path}:${m.line} "${m.mark}"`).join('; ')}), so it stays provider-specific rather than falsely appearing portable. To share it anyway, plan with --force-share ${name}.` }); continue; }
      const twin = inv.providers[other(provider)].present ? inv.providers[other(provider)].skills.find(s => s.name === name && s.managedRoot && !stagedOnly(s)) : null;
      const warnings = checkPortability(blobs).warnings.map(w => `${w.path}:${w.line} ${w.ruleId}`);
      if (twin) {
        if (provider === 'codex' && !stagedOnly(inv.providers.claude.skills.find(s => s.name === name) || { files: {} })) continue; // reported once, from Claude's side
        if (dirHash(twin.files) === dirHash(skill.files)) item('skill', name, 'shared', { source: `${skill.dir} = ${twin.dir}`, destination: join(inv.core.root, 'skills', name), reason: 'The same skill exists in both providers with identical contents; it becomes a shared skill managed by the bridge.', warnings, collision: 'equal' });
        else {
          const choice = resolutions[name];
          if (['claude', 'codex'].includes(choice)) item('skill', name, 'shared', { source: choice === 'claude' ? skill.dir : twin.dir, destination: join(inv.core.root, 'skills', name), reason: `You chose the ${choice} copy. The other copy is preserved under ${join(inv.conflictsRoot, name)} before it is replaced.`, warnings, collision: 'resolved', adoptFrom: choice });
          else if (choice === 'keep-separate') item('skill', name, 'claude-only', { source: skill.dir, destination: null, reason: 'You chose to keep the two copies provider-specific.', collision: 'resolved' });
          else item('skill', name, 'shared', { source: `${skill.dir} | ${twin.dir}`, destination: join(inv.core.root, 'skills', name), collision: 'conflict', userAction: `The skill "${name}" exists in both providers with different contents. Choose with --resolve ${name}=claude|codex|keep-separate.`, reason: 'Same name, different contents, and neither copy is bridge-owned. Nothing is written until you choose.', warnings });
        }
      } else item('skill', name, 'shared', { source: skill.dir, destination: join(inv.core.root, 'skills', name), reason: `Portable: no provider-specific assumptions${warnings.length ? `; portability advice: ${warnings.join(', ')}` : ''}. It is copied into the portable core${present[other(provider)] ? ` and into ${other(provider)}` : ''}.`, warnings, from: provider });
    }
    for (const command of found.commands) {
      const body = read(command.path);
      const reasons = translatable(body);
      const skillName = command.name;
      if (reconciled(skillName) && inv.manifest?.core?.skills?.[skillName]?.origin?.startsWith(`${provider}-command-to-skill:`)) continue; // already translated
      const collides = found.skills.some(s => s.name === skillName && !stagedOnly(s)) || inv.providers[other(provider)].skills?.some(s => s.name === skillName && !stagedOnly(s)) || reconciled(skillName);
      if (!validName(skillName) || collides) item('command', `${provider}/${command.name}`, 'unsupported', { source: command.path, destination: null, reason: `A skill named "${skillName}" already exists, so this command is not translated over it.` });
      else if (reasons.length) item('command', `${provider}/${command.name}`, `${provider}-only`, { source: command.path, destination: null, reason: `This ${provider === 'claude' ? 'command' : 'prompt'} ${reasons.join(' and ')}; the ${provider}-command-to-skill translator only carries plain instruction text, so it stays ${provider}-specific.` });
      else if (scrubFiles([{ path: command.name, content: body }]).hits.length) item('command', `${provider}/${command.name}`, 'unsupported', { source: command.path, destination: null, reason: 'A secret-shaped value was found in this command; nothing containing a secret is copied.' });
      else if (only && !only.includes(skillName) || skip.includes(skillName)) item('command', `${provider}/${command.name}`, `${provider}-only`, { source: command.path, destination: null, reason: 'Not selected for sharing.' });
      else if (inv.providers[other(provider)].present && inv.providers[other(provider)].commands.some(c => c.name === command.name && read(c.path) !== body)) {
        const choice = resolutions[skillName];
        if (choice === provider) item('command', `${provider}/${command.name}`, 'translated', { source: command.path, destination: join(inv.core.root, 'skills', skillName), translator: `${provider}-command-to-skill`, reason: `You chose the ${provider} version of this command; the ${other(provider)} version stays where it is.`, from: provider, skillName, collision: 'resolved' });
        else if (choice === other(provider) || choice === 'keep-separate') item('command', `${provider}/${command.name}`, `${provider}-only`, { source: command.path, destination: null, reason: choice === 'keep-separate' ? 'You chose to keep both versions provider-specific.' : `You chose the ${other(provider)} version.`, collision: 'resolved' });
        else item('command', `${provider}/${command.name}`, 'translated', { source: command.path, destination: join(inv.core.root, 'skills', skillName), collision: 'conflict', userAction: `Both providers have a command named "${command.name}" with different text. Choose with --resolve ${skillName}=claude|codex|keep-separate.`, reason: 'Two different commands would become one skill; nothing is written until you choose.' });
      }
      else item('command', `${provider}/${command.name}`, 'translated', { source: command.path, destination: join(inv.core.root, 'skills', skillName), translator: `${provider}-command-to-skill`, reason: `Plain instruction text with no arguments, shell interpolation or file references: it becomes the portable skill "${skillName}" available in both providers. The original ${provider} file is left in place.`, from: provider, skillName });
    }
    for (const agent of found.subagents) item('subagent', `${provider}/${agent.name}`, `${provider}-only`, { source: agent.path, destination: null, reason: 'Subagent definitions have no translator with a proven behavioural equivalent yet, so this one stays where it works.' });
    if (found.hooks.present) item('hooks', provider, `${provider}-only`, { source: found.hooks.source, destination: null, reason: 'Hooks stay provider-specific; the bridge has no translator that proves equivalent behaviour on the other side.' });
    if (found.plugins.present) item('plugins', provider, `${provider}-only`, { source: found.plugins.source, destination: null, reason: 'Plugins stay provider-specific; the other provider has its own plugin system and marketplace.' });
    if (found.settings.present) item('settings', provider, `${provider}-only`, { source: found.settings.path, destination: null, reason: 'Provider settings (permissions, sandbox, models, approvals) belong to this provider and its overlay; they are never copied across.' });
    for (const server of found.mcp) {
      if (server.unknown) { item('mcp', `${provider}/${server.name}`, 'unsupported', { source: server.source, destination: null, reason: 'The MCP configuration file could not be read, so its servers are unknown.' }); continue; }
      item('mcp', `${provider}/${server.name}`, 'translated', { source: server.source, destination: inv.core.mcpInventory.path, translator: 'mcp-metadata', userAction: present[other(provider)] ? `Add the MCP server "${server.name}" in ${other(provider)} from the inventory and sign in there; ${other(provider)} needs its own interactive sign-in.` : `When you add ${other(provider)}, recreate "${server.name}" from the inventory and sign in there.`, reason: `Only non-secret metadata is recorded (${['name', 'transport', server.url ? 'url' : null, server.command ? 'command' : null, server.args ? 'args' : null].filter(Boolean).join(', ')})${server.redacted.length ? `; ${server.redacted.join(', ')} withheld` : ''}. Credentials are never copied.`, metadata: server });
    }
    for (const store of found.privateStores) if (store.present) item('private', `${provider}/${store.kind}`, 'unsupported', { source: store.path, destination: null, reason: `Provider-private ${store.kind} are never read or copied by the bridge.` });
    for (const cred of found.credentials) if (cred.present) item('credentials', provider, 'unsupported', { source: cred.path, destination: null, reason: 'Authentication state is never read or copied. The other provider needs its own sign-in.' });
    const probe = inv.nativeImport[provider];
    if (present[other(provider)] && probe.available !== false && probe.mode !== 'unavailable' && !receiptProviders[provider]) item('native-import', `${other(provider)}->${provider}`, 'translated', { source: other(provider), destination: provider, translator: `native:${provider}`, mode: probe.mode, command: probe.command, items: probe.items, userAction: probe.mode === 'interactive' ? `Optional bootstrap: in a ${provider} session run ${probe.command} to bring across what the vendor importer covers (${probe.items.join(', ')}). The bridge reports this as your step and verifies the result afterwards; it never claims to have run it.` : null, reason: probe.reason });
    else if (present[other(provider)] && !receiptProviders[provider]) item('native-import', `${other(provider)}->${provider}`, 'unsupported', { source: other(provider), destination: provider, reason: probe.reason });
  }
  return items;
}

// --- Plan ---------------------------------------------------------------------
function coreSourceFiles(kit) {
  return { memory: join(kit, 'scripts/bridge-memory.mjs'), contract: join(kit, 'core/knowledge-contract.md'), defaultInstructions: join(kit, 'core/instructions-default.md'), overlay: p => join(kit, 'core/overlays', `${p}.md`) };
}
export function plan(options = {}) {
  const { intent = 'bridge', provider: current = null, host = 'cli', removeProvider = null, skip = [] } = options;
  const inv = inspect(options);
  const manifest = loadManifest(inv.home);
  inv.manifest = manifest;
  const p = paths(inv.home);
  const src = coreSourceFiles(inv.kit);
  for (const [k, v] of Object.entries({ memory: src.memory, contract: src.contract, defaultInstructions: src.defaultInstructions })) if (!read(v)) throw Error(`Incomplete kit download (${k} missing); fetch the kit again.`);
  const present = PROVIDERS.filter(x => inv.providers[x].present);
  const ops = [], preconditions = {}, summary = [], userSteps = [], conflicts = [];
  const pre = (path, value) => { preconditions[path] = value; };
  let items = [];
  if (intent === 'remove' || intent === 'uninstall') {
    if (!manifest) throw Error('No bridge is installed here; nothing to remove.');
    const targets = intent === 'remove' ? [removeProvider] : Object.keys(manifest.providers);
    if (intent === 'remove' && !manifest.providers[removeProvider]) throw Error(`${removeProvider || 'That provider'} has no bridge receipt; nothing removed.`);
    for (const target of targets) {
      const receipt = manifest.providers[target];
      for (const name of Object.keys(receipt.skills || {}).sort()) ops.push({ op: 'retire-provider-skill', provider: target, name });
      ops.push({ op: 'remove-block', provider: target });
      ops.push({ op: 'forget-provider', provider: target });
      items.push({ id: `remove:${target}`, kind: 'remove', name: target, disposition: `${target}-only`, source: receipt.instructions, destination: null, collision: 'none', userAction: null, reason: `Removes ${target}'s bridge block and its unchanged bridge-owned skill copies. Customised or user-added files, ${other(target)}, the portable core, shared knowledge and handoffs remain.` });
      summary.push(`Remove ${target} from the bridge, keeping everything you changed.`);
    }
    if (intent === 'uninstall') { ops.push({ op: 'uninstall-core' }); summary.push('Remove the bridge-owned files in the portable core that are unchanged. Your portable instructions, shared knowledge, handoffs and any customised file stay.'); }
  } else {
    if (!present.length) throw Error('Neither Claude Code nor Codex configuration was found on this computer. Install and open one of them first; the bridge does not install either product.');
    // Codex also loads skills from its own skills folder. A skill there is moved
    // into the shared skills folder when it is shared, so Codex never loads two
    // copies; an identical copy already in the shared folder retires the old one.
    const relocations = {};
    if (inv.providers.codex.present) {
      const codex = inv.providers.codex;
      const pendingFiles = manifest?.pending?.files || {};
      const staged = sk => Object.keys(sk.files).length > 0 && Object.entries(sk.files).every(([f, h]) => pendingFiles[join(sk.dir, f)] === h);
      const primary = name => codex.skills.find(sk => sk.managedRoot && sk.name === name);
      const next = [];
      for (const sk of codex.skills) {
        if (sk.managedRoot) { const legacy = codex.skills.find(x => !x.managedRoot && x.name === sk.name); if (legacy && staged(sk)) continue; next.push(sk); continue; }
        if (sk.linked || sk.links.length) { next.push(sk); continue; }
        const twin = primary(sk.name);
        if (twin && !staged(twin)) { next.push({ ...sk, legacyDuplicate: dirHash(twin.files) === dirHash(sk.files) ? 'identical' : 'different' }); continue; }
        relocations[sk.name] = { from: sk.dir, to: join(codex.skillRoot, sk.name), hash: dirHash(sk.files) };
        next.push({ ...sk, relocatedFrom: sk.dir, dir: join(codex.skillRoot, sk.name), root: codex.skillRoot, managedRoot: true });
      }
      codex.skills = next;
    }
    items = classify(inv, options);
    const seed = items.find(i => i.id === 'instructions:portable');
    // Core files the bridge owns: written when absent or unchanged; kept when customised.
    const coreFile = (key, path, source, checkpoint) => {
      const body = read(source); const committed = manifest?.core?.[key]?.hash ?? manifest?.core?.[`${key}Hash`];
      const currentHash = existsSync(path) ? hash(read(path)) : null;
      const staged = manifest?.pending?.files?.[path];
      if (currentHash === hash(body) && committed === currentHash) return;
      if (currentHash !== null && currentHash !== committed && currentHash !== staged) { items.push({ id: `core:${key}`, kind: 'core', name: key, disposition: 'shared', source, destination: path, collision: 'customised', userAction: null, reason: `${path} was customised, so this update leaves it as it is.` }); return; }
      ops.push({ op: 'write-core-file', key, path, source, hash: hash(body), checkpoint });
    };
    coreFile('memory', p.memory, src.memory, 'core:memory');
    coreFile('contract', p.contract, src.contract, 'core:contract');
    for (const x of present) coreFile(`overlay:${x}`, join(p.overlays, `${x}.md`), src.overlay(x), `overlay:${x}`);
    if (seed && seed.collision !== 'conflict') {
      const from = PROVIDERS.find(x => present.includes(x) && seed.source === inv.providers[x].instructions.path) || null;
      const source = seed.recovered ? p.instructions : from ? inv.providers[from].instructions.path : src.defaultInstructions;
      const sourceKind = seed.recovered ? 'core' : from ? 'provider' : 'kit';
      const body = sourceKind === 'provider' ? discoverBody(source) : read(source);
      const hits = scrubFiles([{ path: 'instructions', content: body }]).hits;
      if (hits.length) { Object.assign(seed, { collision: 'conflict', userAction: `Remove the secret-shaped value at ${hits.map(h => `line ${h.line} (${h.ruleId})`).join(', ')} of ${source} before it seeds the portable instructions, or choose --instructions-from none.`, reason: 'A secret-shaped value was found in the global instructions; nothing containing a secret is copied into the portable core.' }); conflicts.push(seed); }
      else {
        if (sourceKind === 'provider') pre(`${source}#user-body`, hash(body));
        ops.push({ op: 'seed-instructions', path: p.instructions, from, source, sourceKind, hash: hash(body), checkpoint: 'core:instructions' });
        // The seeded text moves: both apps then read one copy, so an edit in one
        // place can never contradict a stale copy in the other. Removing the
        // bridge puts the current portable text back.
        if (sourceKind !== 'kit' && !options.keepProviderInstructions) for (const x of present) {
          const own = inv.providers[x].instructions;
          if (own.ambiguous || discoverBody(own.path) !== body) continue;
          pre(`${own.path}#user-body`, hash(body));
          ops.push({ op: 'move-instructions', provider: x, path: own.path, hash: hash(body) });
          items.push({ id: `move-instructions:${x}`, kind: 'instructions', name: x, disposition: 'shared', source: own.path, destination: p.instructions, collision: 'none', userAction: null, reason: `Your ${x} global instructions move into the portable instructions so both apps read one copy. ${own.path} keeps only the bridge block; removing the bridge puts the text back.` });
        }
      }
    }
    if (seed?.collision === 'conflict' && !conflicts.includes(seed)) conflicts.push(seed);
    // Skills and translated commands: into the core, then into every present provider.
    for (const it of items.filter(i => (i.kind === 'skill' || i.kind === 'command') && i.disposition !== 'unsupported' && i.collision !== 'linked')) {
      if (it.collision === 'conflict') { conflicts.push(it); continue; }
      if (it.kind === 'skill' && it.disposition === 'shared') {
        const name = it.name;
        const from = it.adoptFrom || it.from || 'claude';
        const sourceDir = join(inv.providers[from].skillRoot, name);
        pre(sourceDir, skillFilesHash(sourceDir));
        if (it.adoptFrom) { const loser = other(from); ops.push({ op: 'preserve-candidate', name, provider: loser, dir: join(inv.providers[loser].skillRoot, name) }); ops.push({ op: 'replace-unowned-skill', name, provider: loser, dir: join(inv.providers[loser].skillRoot, name) }); }
        const adopt = it.collision === 'equal' ? present.filter(x => x !== from) : [];
        for (const x of adopt) pre(join(inv.providers[x].skillRoot, name), skillFilesHash(join(inv.providers[x].skillRoot, name)));
        ops.push({ op: 'share-skill', name, sourceDir, from, providers: present, origin: from, adopt });
      } else if (it.kind === 'command' && it.disposition === 'translated') {
        pre(it.source, hash(read(it.source)));
        ops.push({ op: 'translate-command', name: it.skillName, from: it.from, source: it.source, files: translateCommandToSkill({ name: it.skillName, body: read(it.source), provider: it.from }), providers: present, translator: it.translator });
      }
    }
    // Reconcile every skill the bridge already manages.
    const baselineSkills = manifest?.core?.skills || {};
    // A copy that matches its own receipt, or an intent recorded by a stopped
    // run, is the bridge's own work rather than a user change: for reconciliation
    // it counts as the baseline, so an interrupted promotion resumes from the
    // side that still differs. Only content the user changed is a change.
    const pendingFiles = manifest?.pending?.files || {}, pendingRemovals = manifest?.pending?.removals || {};
    const masked = (files, dir, baseline, receipt = {}) => {
      if (!baseline || !files) return files;
      const out = { ...files };
      const bridgeWrote = (file, h) => pendingFiles[join(dir, file)] === h || receipt[file] === h;
      for (const [file, h] of Object.entries(baseline)) {
        if (file in out && out[file] !== h && bridgeWrote(file, out[file])) out[file] = h;
        if (!(file in out) && (join(dir, file) in pendingRemovals || !(file in receipt))) out[file] = h;
      }
      for (const [file, h] of Object.entries(out)) if (!(file in baseline) && bridgeWrote(file, h)) delete out[file];
      return out;
    };
    // The kit's own skill rides the same path as any shared skill, and follows a
    // kit update only while every copy still matches the baseline.
    const kitSkill = join(inv.kit, 'skills/claude-codex-bridge');
    if (existsSync(kitSkill)) {
      const name = 'claude-codex-bridge';
      const entry = manifest?.core?.skills?.[name];
      const kitFiles = readSkill(kitSkill).files;
      const unowned = present.filter(x => !manifest?.providers?.[x]?.skills?.[name] && existsSync(join(inv.providers[x].skillRoot, name)));
      if (!entry?.baseline) {
        if (unowned.length) { const c = { id: `skill:${name}`, kind: 'skill', name, disposition: 'shared', source: kitSkill, destination: join(p.skills, name), collision: 'conflict', userAction: `${unowned.join(' and ')} already ha${unowned.length === 1 ? 's' : 've'} an unmanaged skill named "${name}". Remove it, or choose --resolve ${name}=core to replace it (the existing copy is preserved first).`, reason: 'The bridge skill would collide with a copy it does not own.' }; if (options.resolve?.[name] === 'core') { for (const x of unowned) { ops.push({ op: 'preserve-candidate', name, provider: x, dir: join(inv.providers[x].skillRoot, name) }); ops.push({ op: 'replace-unowned-skill', name, provider: x, dir: join(inv.providers[x].skillRoot, name) }); } items.push({ ...c, collision: 'resolved', userAction: null }); pre(kitSkill, dirHash(kitFiles)); ops.push({ op: 'share-skill', name, sourceDir: kitSkill, from: 'kit', providers: present, origin: 'kit' }); } else { items.push(c); conflicts.push(c); } }
        else { pre(kitSkill, dirHash(kitFiles)); ops.push({ op: 'share-skill', name, sourceDir: kitSkill, from: 'kit', providers: present, origin: 'kit' }); items.push({ id: `skill:${name}`, kind: 'skill', name, disposition: 'shared', source: kitSkill, destination: join(p.skills, name), collision: 'none', userAction: null, reason: 'The bridge skill itself is installed in both providers so either app can run the bridge.' }); }
      } else if (dirHash(kitFiles) !== dirHash(entry.baseline)) {
        const sidesUnchanged = [[join(p.skills, name), entry.files], ...present.filter(x => manifest.providers[x]).map(x => [join(inv.providers[x].skillRoot, name), manifest.providers[x].skills?.[name]?.files])].every(([dir, receipt]) => !existsSync(dir) || dirHash(masked(readSkill(dir).files, dir, entry.baseline, receipt || {})) === dirHash(entry.baseline));
        if (sidesUnchanged) { pre(kitSkill, dirHash(kitFiles)); ops.push({ op: 'promote-skill', name, from: 'kit', sourceDir: kitSkill, providers: present.filter(x => manifest.providers[x]), force: false }); items.push({ id: `skill:${name}`, kind: 'skill', name, disposition: 'shared', source: kitSkill, destination: join(p.skills, name), collision: 'none', userAction: null, reason: 'A newer bridge skill from the kit replaces the unchanged copies.' }); }
        else items.push({ id: `skill:${name}`, kind: 'skill', name, disposition: 'shared', source: kitSkill, destination: join(p.skills, name), collision: 'customised', userAction: null, reason: 'The kit has a newer bridge skill, but a copy was customised; it is left as it is.' });
      }
    }
    for (const name of Object.keys(baselineSkills).sort()) {
      if (!baselineSkills[name].baseline) continue; // an initial share that stopped part-way is re-proposed above
      if (name === 'claude-codex-bridge' && ops.some(o => o.name === name)) continue;
      const baseline = baselineSkills[name].baseline;
      const coreDir = join(p.skills, name);
      const sides = Object.fromEntries(PROVIDERS.map(x => [x, present.includes(x) && manifest.providers[x] ? (existsSync(join(inv.providers[x].skillRoot, name)) ? masked(readSkill(join(inv.providers[x].skillRoot, name)).files, join(inv.providers[x].skillRoot, name), baseline, manifest.providers[x].skills?.[name]?.files) : null) : null]));
      const presentSides = Object.fromEntries(PROVIDERS.map(x => [x, present.includes(x) && Boolean(manifest.providers[x])]));
      const result = reconcileSkill({ name, baseline, core: existsSync(coreDir) ? masked(readSkill(coreDir).files, coreDir, baseline, baselineSkills[name].files) : null, claude: sides.claude, codex: sides.codex, present: presentSides });
      // A provider joining the bridge (or missing an owned copy) receives the portable copy.
      const joiners = present.filter(x => !manifest.providers[x]?.skills?.[name] && existsSync(coreDir));
      for (const x of joiners) {
        const dir = join(inv.providers[x].skillRoot, name);
        if (existsSync(dir)) { const c = { id: `join:${x}/${name}`, kind: 'sync', name, disposition: 'shared', source: coreDir, destination: dir, collision: 'conflict', userAction: `${x} already has an unmanaged skill named "${name}". Rename or remove it, or choose --resolve ${name}=core to replace it (the existing copy is preserved first).`, reason: 'Same name as a shared skill, but this copy is not bridge-owned. Nothing is written until you choose.' }; if (options.resolve?.[name] === 'core') { ops.push({ op: 'preserve-candidate', name, provider: x, dir }); ops.push({ op: 'replace-unowned-skill', name, provider: x, dir }); ops.push({ op: 'install-core-skill', name, sourceDir: coreDir, providers: [x] }); items.push({ ...c, collision: 'resolved', userAction: null }); } else { items.push(c); conflicts.push(c); } }
        else { ops.push({ op: 'install-core-skill', name, sourceDir: coreDir, providers: [x] }); items.push({ id: `join:${x}/${name}`, kind: 'sync', name, disposition: 'shared', source: coreDir, destination: dir, collision: 'none', userAction: null, reason: `${x} receives the shared skill "${name}" from the portable core.` }); }
      }
      if (joiners.length) continue; // reconciled on the next plan, once every provider owns a copy
      const choice = options.resolve?.[name];
      let decision = result.decision, from = result.from;
      if (decision === 'conflict' && choice) {
        if (['claude', 'codex', 'core'].includes(choice)) { decision = 'promote'; from = choice; }
        else if (choice === 'keep-separate') { ops.push({ op: 'unshare-skill', name }); items.push({ id: `sync:${name}`, kind: 'sync', name, disposition: 'claude-only', source: coreDir, destination: null, collision: 'resolved', userAction: null, reason: 'You chose to keep this skill provider-specific. Each provider keeps its own copy and the bridge stops managing it.' }); continue; }
      }
      if (decision === 'unchanged') continue;
      if (decision === 'accept-both') from = present.find(x => presentSides[x] && sides[x]);
      if (decision === 'conflict') { const c = { id: `sync:${name}`, kind: 'sync', name, disposition: 'shared', source: coreDir, destination: null, collision: 'conflict', sides: result.sides, userAction: `Choose the result for "${name}" with --resolve ${name}=claude|codex|core|keep-separate (edit one copy first for a merged result).`, reason: result.reason }; items.push(c); conflicts.push(c); continue; }
      const fromDir = from === 'core' ? coreDir : join(inv.providers[from].skillRoot, name);
      const deleted = !existsSync(fromDir);
      if (from !== 'core') pre(fromDir, skillFilesHash(fromDir));
      const forProviders = present.filter(x => manifest.providers[x]);
      if (decision === 'promote' && result.sides[from] === 'deleted' || deleted) ops.push({ op: 'retire-shared-skill', name, providers: forProviders });
      else {
        for (const x of PROVIDERS) if (choice && x !== from && presentSides[x] && sides[x]) ops.push({ op: 'preserve-candidate', name, provider: x, dir: join(inv.providers[x].skillRoot, name) });
        if (choice && from !== 'core') ops.push({ op: 'preserve-candidate', name, provider: 'core', dir: coreDir });
        ops.push({ op: decision === 'accept-both' ? 'accept-both' : 'promote-skill', name, from, sourceDir: fromDir, providers: forProviders, force: Boolean(choice) });
      }
      items.push({ id: `sync:${name}`, kind: 'sync', name, disposition: 'shared', source: fromDir, destination: coreDir, collision: choice ? 'resolved' : 'none', userAction: null, reason: choice ? `You chose the ${from} copy. Every other candidate is preserved under ${join(p.conflicts, name)}.` : result.reason, decision, from });
    }
    for (const it of items.filter(i => i.removeLegacy && !skip.includes(i.name.split('/')[1].replace(/@legacy$/, '')))) {
      pre(it.source, skillFilesHash(it.source));
      ops.unshift({ op: 'remove-legacy-duplicate', name: it.name.split('/')[1].replace(/@legacy$/, ''), dir: it.source });
    }
    for (const [name, r] of Object.entries(relocations)) {
      const used = ops.some(o => o.name === name && (o.sourceDir === r.to || o.dir === r.to || (o.adopt || []).includes('codex')));
      if (used) { pre(r.from, r.hash); ops.unshift({ op: 'relocate-skill', name, from: r.from, to: r.to, hash: r.hash }); items.push({ id: `relocate:${name}`, kind: 'relocate', name, disposition: 'codex-only', source: r.from, destination: r.to, collision: 'none', userAction: null, reason: `Moved from Codex's own skills folder into ${dirname(r.to)}, which Codex also reads, so the bridge can manage one copy.` }); }
      else for (const it of items) if (typeof it.source === 'string' && it.source.includes(r.to)) it.source = it.source.replace(r.to, r.from);
    }
    for (const it of items.filter(i => i.kind === 'project' && i.disposition === 'translated')) {
      const rec = manifest?.projects?.[it.name];
      if (it.already && rec?.hash === hash(PROJECT_POINTER)) continue;
      ops.push({ op: 'project-pointer', dir: it.name, path: it.destination, body: PROJECT_POINTER, adopt: Boolean(it.already) });
    }
    const mcpItems = items.filter(i => i.kind === 'mcp' && i.disposition === 'translated');
    const inventoryBody = JSON.stringify({ schema: 1, note: 'Non-secret MCP metadata inventoried by the Claude + Codex Bridge. Recreate a server in the other provider from this and sign in there; credentials are never copied.', servers: mcpItems.map(i => i.metadata) }, null, 2) + '\n';
    if (mcpItems.length && (!existsSync(p.mcp) || read(p.mcp) !== inventoryBody)) ops.push({ op: 'write-core-file', key: 'mcpInventory', path: p.mcp, body: inventoryBody, hash: hash(inventoryBody), checkpoint: 'mcp-inventory' });
    for (const x of present) {
      const block = items.find(i => i.kind === 'instruction-block' && i.name === x);
      if (block.disposition === 'unsupported') { conflicts.push(block); continue; }
      const expected = adapterBlock({ core: p.core, kit: inv.kit, provider: x, instructions: p.instructions, overlay: join(p.overlays, `${x}.md`), contract: p.contract });
      const { blocks } = managedBlocks(read(inv.providers[x].instructions.path));
      const rec = manifest?.providers?.[x];
      if (rec?.ready && rec.instructions === inv.providers[x].instructions.path && rec.skillRoot === inv.providers[x].skillRoot && blocks.length === 1 && blocks[0] === expected && rec.adapterHash === hash(expected)) continue;
      ops.push({ op: 'adapter', provider: x, host: current === x ? host : rec?.host || host, config: inv.providers[x].config, instructions: inv.providers[x].instructions.path, skillRoot: inv.providers[x].skillRoot });
    }
    for (const it of items.filter(i => i.kind === 'native-import' && i.disposition === 'translated')) {
      if (it.mode === 'programmatic') ops.push({ op: 'native-import', provider: it.destination, source: it.source, items: it.items, translator: it.translator });
      else userSteps.push(it.userAction);
    }
    for (const it of items) if (it.userAction && it.kind !== 'native-import') userSteps.push(it.userAction);
    const counts = Object.fromEntries(DISPOSITIONS.map(d => [d, items.filter(i => i.disposition === d).length]));
    const managedCount = Object.keys(baselineSkills).length;
    summary.push(`${present.length === 2 ? 'Claude Code and Codex' : present[0] === 'claude' ? 'Claude Code only' : 'Codex only'} found. ${counts.shared} to share${managedCount ? ` (${managedCount} already shared)` : ''}, ${counts['claude-only']} Claude-specific, ${counts['codex-only']} Codex-specific, ${counts.translated} translated, ${counts.unsupported} unsupported.`);
    if (conflicts.length) summary.push(`${conflicts.length} item${conflicts.length === 1 ? '' : 's'} need${conflicts.length === 1 ? 's' : ''} your choice before ${conflicts.length === 1 ? 'it is' : 'they are'} written; everything else can be applied now.`);
    if (!ops.length) summary.push('Nothing to change: your setup already matches the plan.');
  }
  const body = { schema: 1, intent, home: inv.home, kit: inv.kit, kitVersion: inv.kitVersion, provider: current, host, createdAt: null, items, operations: ops, preconditions, conflicts: conflicts.map(c => c.id), userSteps, summary, noop: !ops.length };
  const id = hash(JSON.stringify({ ...body, createdAt: undefined })).slice(0, 16);
  const record = { ...body, id, createdAt: new Date().toISOString() };
  mkdirSync(p.plans, { recursive: true });
  save(join(p.plans, `${id}.json`), JSON.stringify(record, null, 2) + '\n');
  return record;
}

// --- Apply --------------------------------------------------------------------
// `checkpoint(name)` is called after each external write and before the receipt
// commits it: the pre-agreed seam where tests stop the process to prove recovery.
export function apply({ home = homedir(), planId, checkpoint = () => {}, nativeImportRunner = null } = {}) {
  home = realpathSync(resolve(home));
  const p = paths(home);
  const planPath = join(p.plans, `${planId}.json`);
  if (!planId || !existsSync(planPath)) throw Error('Unknown plan id. Run plan first and apply the id it prints.');
  const record = JSON.parse(read(planPath));
  if (record.home !== home) throw Error('This plan was made for a different home folder; make a new plan.');
  safePath(p.shared);
  mkdirSync(p.shared, { recursive: true });
  const held = acquireLock(p.shared, `${record.intent} (plan ${planId})`);
  const recovery = { actions: [], adopted: [] };
  if (held.recovered) recovery.actions.push(`Removed ${held.recovered}.`);
  checkpoint('lock');
  try {
    const manifest = loadManifest(home) || freshManifest(home, record.kit);
    for (const temp of sweepTemps(p.shared)) recovery.actions.push(`Removed the unfinished temporary file ${temp}.`);
    for (const temp of sweepTemps(p.core, { recursive: true })) recovery.actions.push(`Removed the unfinished temporary file ${temp}.`);
    const interrupted = manifest.pending || null;
    if (interrupted) recovery.actions.push(`Continued the ${interrupted.intent} started ${interrupted.startedAt} (plan ${interrupted.planId}) that did not finish.`);
    manifest.pending = { startedAt: new Date().toISOString(), intent: record.intent, planId, version: record.kitVersion, files: { ...interrupted?.files }, removals: { ...interrupted?.removals } };
    const pending = manifest.pending.files;
    const persist = () => save(p.manifest, JSON.stringify(manifest, null, 2) + '\n');
    const current = path => existsSync(path) ? hash(readFileSync(path)) : null;
    const ours = (path, committed) => { const h = current(path); return h === null || h === committed || h === pending[path]; };
    const adoptIfStaged = (path, committed) => { const h = current(path); if (h !== null && h !== committed && h === pending[path]) recovery.adopted.push(path); };
    const stage = entries => { for (const [path, body] of entries) pending[path] = hash(body); persist(); };
    const commit = paths => { for (const path of paths) delete pending[path]; };
    const stageRemovals = paths => { for (const path of paths) if (!(path in manifest.pending.removals)) manifest.pending.removals[path] = current(path); persist(); };
    const commitRemovals = paths => { for (const path of paths) delete manifest.pending.removals[path]; };
    const kept = [];
    const transaction = prefix => ({ pending, ours, adoptIfStaged, stage, commit, stageRemovals, commitRemovals, current, recovery, checkpoint: name => checkpoint(`${prefix}:${name}`) });
    // Preconditions: every source the plan read must be unchanged, except a
    // source this same interrupted plan already staged (its hash is recorded).
    for (const [key, expected] of Object.entries(record.preconditions)) {
      const [path, part] = key.split('#');
      const actual = part === 'user-body' ? hash(discoverBody(path)) : existsSync(path) ? (lstatSync(path).isDirectory() ? skillFilesHash(path) : hash(readFileSync(path))) : null;
      if (actual !== expected && !(interrupted?.planId === planId)) throw Error(`The plan is stale: ${path} changed after it was made. Run plan again and apply the new id.`);
    }
    manifest.kit = { home: record.kit, version: record.kitVersion };
    const skillReceipt = provider => {
      if (!manifest.providers[provider]) {
        const adapter = record.operations.find(o => o.op === 'adapter' && o.provider === provider);
        manifest.providers[provider] = { ready: false, host: adapter?.host || record.host, os: platform(), config: adapter?.config || null, instructions: adapter?.instructions || null, skillRoot: adapter?.skillRoot || null, installedAt: new Date().toISOString(), skills: {} };
      }
      return manifest.providers[provider];
    };
    const coreSkillRoot = p.skills;
    const coreReceipt = () => { manifest.core.skills ||= {}; return { skills: manifest.core.skills }; };
    const providerSkillRoot = provider => manifest.providers[provider]?.skillRoot || record.operations.find(o => o.op === 'adapter' && o.provider === provider)?.skillRoot;
    const writeSkillEverywhere = ({ name, sourceDir, providers, origin, files = null, adopt = [], keepBaseline = false }) => {
      let source = sourceDir;
      let staging = null;
      if (files) { staging = join(p.shared, 'staging', name); rmSync(staging, { recursive: true, force: true }); for (const [file, body] of Object.entries(files)) save(join(staging, file), body); source = staging; }
      try {
        // Core copy first, then each provider; every copy is owned by its own
        // receipt. The source copy's receipt is refreshed last, after every
        // other copy is written, so a run that stops part-way still shows the
        // source as the side to promote from.
        const coreRec = coreReceipt();
        const sourceIsCore = resolve(source) === resolve(coreSkillRoot, name);
        const beforeCore = coreRec.skills[name];
        if (!sourceIsCore) {
          installSkill({ source, name, skillRoot: coreSkillRoot, receipt: coreRec, version: record.kitVersion, persist, kept, transaction: transaction('core') });
          if (coreRec.skills[name]) coreRec.skills[name] = { ...coreRec.skills[name], origin: beforeCore?.origin || origin };
          persist();
        }
        let sourceProvider = null;
        for (const provider of providers) {
          const root = providerSkillRoot(provider);
          if (!root) continue;
          const rec = skillReceipt(provider); rec.skillRoot ||= root;
          if (resolve(root, name) === resolve(source)) { sourceProvider = provider; continue; }
          // A copy the plan found byte-equal is adopted through a recorded intent
          // for every file, the same proof an interrupted write would carry.
          if (adopt.includes(provider) && !rec.skills[name]) stage(tree(source).map(file => [join(root, name, file), readFileSync(join(source, file))]));
          installSkill({ source, name, skillRoot: root, receipt: rec, version: record.kitVersion, persist, kept, transaction: transaction(provider) });
        }
        // Every copy is written: the source's receipt and the baseline (the last
        // reconciled content) are recorded together, last.
        const reconciled = readSkill(source).files;
        if (keepBaseline) { persist(); return; } // a joining provider receives the copy; the baseline is untouched
        if (sourceIsCore) coreRec.skills[name] = { ...coreRec.skills[name], files: reconciled, version: record.kitVersion, origin: beforeCore?.origin || origin };
        if (sourceProvider) skillReceipt(sourceProvider).skills[name] = { files: reconciled, version: record.kitVersion };
        if (coreRec.skills[name]) coreRec.skills[name].baseline = reconciled;
        persist();
      } finally { if (staging) rmSync(staging, { recursive: true, force: true }); }
    };
    const preserveCandidate = (name, label, dir) => {
      if (!existsSync(dir)) return;
      const target = join(p.conflicts, name, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      safePath(target); mkdirSync(dirname(target), { recursive: true });
      cpSync(dir, target, { recursive: true, verbatimSymlinks: true });
      checkpoint(`preserve:${name}/${label}`);
      recovery.actions.length; // no-op marker for readability
      return target;
    };
    const results = { preserved: kept, candidates: [], nativeImports: [], removed: [], userSteps: [...record.userSteps] };
    for (const op of record.operations) {
      switch (op.op) {
        case 'write-core-file': {
          const body = op.body ?? read(op.source);
          const committed = manifest.core[op.key]?.hash;
          if (!ours(op.path, committed)) { kept.push(op.path); break; }
          adoptIfStaged(op.path, committed);
          stage([[op.path, body]]);
          save(op.path, body); checkpoint(op.checkpoint);
          manifest.core[op.key] = { path: op.path, hash: hash(body), version: record.kitVersion };
          commit([op.path]); persist();
          break;
        }
        case 'seed-instructions': {
          const body = op.sourceKind === 'provider' ? discoverBody(op.source) : read(op.source);
          if (hash(body) !== op.hash) throw Error(`The plan is stale: ${op.source} changed after it was made. Run plan again and apply the new id.`);
          if (existsSync(op.path) && current(op.path) !== pending[op.path] && current(op.path) !== op.hash) { kept.push(op.path); break; }
          adoptIfStaged(op.path, null);
          stage([[op.path, body]]);
          save(op.path, body); checkpoint(op.checkpoint);
          manifest.core.instructions = { path: op.path, seededFrom: op.from, seededAt: new Date().toISOString() };
          commit([op.path]); persist();
          break;
        }
        case 'relocate-skill': {
          safePath(op.to); safePath(op.from);
          if (!existsSync(op.from)) { recovery.actions.push(`${op.name} was already moved by a stopped run.`); break; }
          if (dirHash(readSkill(op.from).files) !== op.hash) throw Error(`The plan is stale: ${op.from} changed after it was made. Run plan again and apply the new id.`);
          const files = tree(op.from).map(f => [join(op.to, f), readFileSync(join(op.from, f)), lstatSync(join(op.from, f)).mode & 0o777]);
          for (const [target, body] of files) if (existsSync(target) && current(target) !== hash(body) && current(target) !== pending[target]) throw Error(`${target} already exists with other content; ${op.name} was left in place. Run plan again.`);
          stage(files.map(([t, b]) => [t, b]));
          for (const [target, body, mode] of files) if (current(target) !== hash(body)) save(target, body, mode);
          checkpoint(`relocate-copy:${op.name}`);
          commit(files.map(([t]) => t)); persist();
          const old = tree(op.from).map(f => join(op.from, f));
          stageRemovals(old);
          rmSync(op.from, { recursive: true, force: true });
          checkpoint(`relocate:${op.name}`);
          commitRemovals(old); persist();
          break;
        }
        case 'remove-legacy-duplicate': {
          safePath(op.dir);
          if (!existsSync(op.dir)) break;
          const old = tree(op.dir).map(f => join(op.dir, f));
          stageRemovals(old);
          rmSync(op.dir, { recursive: true, force: true });
          checkpoint(`legacy-duplicate:${op.name}`);
          commitRemovals(old); persist(); results.removed.push(op.dir);
          break;
        }
        case 'move-instructions': {
          const rec = skillReceipt(op.provider);
          const userBody = discoverBody(op.path);
          if (!userBody.trim()) { rec.movedInstructions ||= { hash: op.hash, from: op.path, at: new Date().toISOString() }; persist(); break; }
          if (hash(userBody) !== op.hash) { kept.push(op.path); break; }
          rec.movedInstructions = { hash: op.hash, from: op.path, at: new Date().toISOString() }; persist();
          const { blocks } = managedBlocks(read(op.path));
          const next = blocks.length ? blocks[0] + '\n' : '';
          pending[op.path] = hash(next); persist();
          save(op.path, next);
          checkpoint(`move-instructions:${op.provider}`);
          delete pending[op.path]; persist();
          break;
        }
        case 'project-pointer': {
          manifest.projects ||= {};
          const committed = manifest.projects[op.dir]?.hash;
          safePath(op.path);
          if (op.adopt && current(op.path) === hash(op.body)) { manifest.projects[op.dir] = { pointer: op.path, hash: hash(op.body), adoptedAt: new Date().toISOString() }; persist(); break; }
          if (!ours(op.path, committed)) { kept.push(op.path); break; }
          adoptIfStaged(op.path, committed);
          stage([[op.path, op.body]]);
          save(op.path, op.body, 0o644); checkpoint(`project:${basename(op.dir)}`);
          manifest.projects[op.dir] = { pointer: op.path, hash: hash(op.body), version: record.kitVersion };
          commit([op.path]); persist();
          break;
        }
        case 'preserve-candidate': { const saved = preserveCandidate(op.name, op.provider, op.dir); if (saved) results.candidates.push(saved); break; }
        case 'replace-unowned-skill': {
          // Only after its candidate copy was preserved: the losing unowned copy is
          // recorded as a removal intent, removed, and the winner written in its place.
          safePath(op.dir);
          const files = existsSync(op.dir) ? tree(op.dir).map(f => join(op.dir, f)) : [];
          stageRemovals(files);
          rmSync(op.dir, { recursive: true, force: true }); checkpoint(`replace:${op.provider}/${op.name}`);
          commitRemovals(files); persist();
          break;
        }
        case 'install-core-skill': writeSkillEverywhere({ name: op.name, sourceDir: op.sourceDir, providers: op.providers, origin: 'core', keepBaseline: true }); break;
        case 'share-skill': writeSkillEverywhere({ name: op.name, sourceDir: op.sourceDir, providers: op.providers, origin: op.origin, adopt: op.adopt || [] }); break;
        case 'translate-command': writeSkillEverywhere({ name: op.name, files: op.files, providers: op.providers, origin: `${op.translator}:${op.source}` }); break;
        case 'promote-skill': case 'accept-both': {
          // The source side is the truth: its files are written to the core and the
          // other provider. Files the other side customised beyond the baseline are
          // kept only in a forced (chosen) resolution's candidate snapshot.
          const rec = coreReceipt();
          // A chosen resolution lets the promoted files replace the other copies'
          // versions of the same files. A file only the losing copy has was never
          // the bridge's: it stays on disk and out of the receipt.
          const promotedFiles = readSkill(op.sourceDir).files;
          const onlyPromoted = files => Object.fromEntries(Object.entries(files).filter(([f]) => f in promotedFiles));
          if (op.force) { for (const provider of op.providers) { const root = providerSkillRoot(provider); if (root && resolve(root, op.name) !== resolve(op.sourceDir)) { const r = skillReceipt(provider); if (existsSync(join(root, op.name))) r.skills[op.name] = { files: onlyPromoted(readSkill(join(root, op.name)).files), version: record.kitVersion }; else delete r.skills[op.name]; } } if (resolve(coreSkillRoot, op.name) !== resolve(op.sourceDir) && existsSync(join(coreSkillRoot, op.name))) rec.skills[op.name] = { ...rec.skills[op.name], files: onlyPromoted(readSkill(join(coreSkillRoot, op.name)).files) }; persist(); }
          // A copy already byte-identical to the promoted content (an equal
          // two-sided change, or the source itself) is accepted into its receipt
          // rather than reported as customised; it is what is about to be written.
          const promoted = promotedFiles;
          for (const [root, r] of [[coreSkillRoot, rec], ...op.providers.map(x => [providerSkillRoot(x), skillReceipt(x)])]) {
            if (!root || !r.skills[op.name] || !existsSync(join(root, op.name)) || resolve(root, op.name) === resolve(op.sourceDir)) continue;
            const files = readSkill(join(root, op.name)).files;
            if (dirHash(files) === dirHash(promoted)) r.skills[op.name] = { ...r.skills[op.name], files };
          }
          persist();
          const droppedFiles = Object.keys(rec.skills[op.name]?.files || {}).filter(f => !existsSync(join(op.sourceDir, f)));
          writeSkillEverywhere({ name: op.name, sourceDir: op.sourceDir, providers: op.providers, origin: op.from });
          // A file removed on the source side is retired from the other copies when unchanged there.
          for (const file of droppedFiles) for (const [root, r] of [[coreSkillRoot, rec], ...op.providers.map(x => [providerSkillRoot(x), skillReceipt(x)])]) {
            const target = join(root, op.name, file); const owned = r.skills[op.name]?.files?.[file];
            if (!owned || !existsSync(target) || resolve(root, op.name) === resolve(op.sourceDir)) { if (r.skills[op.name]?.files) delete r.skills[op.name].files[file]; continue; }
            if (current(target) !== owned) { kept.push(`${op.name}/${file}`); continue; }
            stageRemovals([target]); rmSync(target); checkpoint(`drop:${op.name}/${file}`); delete r.skills[op.name].files[file]; commitRemovals([target]); persist();
          }
          break;
        }
        case 'retire-shared-skill': {
          for (const provider of op.providers) retireSkill({ name: op.name, skillRoot: providerSkillRoot(provider), receipt: skillReceipt(provider), persist, kept, transaction: transaction(provider) });
          retireSkill({ name: op.name, skillRoot: coreSkillRoot, receipt: coreReceipt(), persist, kept, transaction: transaction('core') });
          results.removed.push(op.name);
          break;
        }
        case 'unshare-skill': { delete manifest.core.skills[op.name]; for (const x of PROVIDERS) delete manifest.providers[x]?.skills?.[op.name]; persist(); break; }
        case 'adapter': {
          const rec = skillReceipt(op.provider);
          if (rec.instructions && (rec.instructions !== op.instructions || rec.skillRoot !== op.skillRoot)) throw Error(`${op.provider} was bridged in another profile (${rec.instructions}). Keep that profile, or remove ${op.provider} from the bridge first.`);
          for (const x of [op.config, op.skillRoot, op.instructions]) safePath(x);
          if (rec.ready) { rec.ready = false; persist(); }
          const global = read(op.instructions);
          const { blocks, ambiguous } = managedBlocks(global);
          if (ambiguous) throw Error(`Ambiguous bridge markers in ${op.instructions}; left unchanged.`);
          const blockKey = `${op.instructions}#selr-bridge-block`;
          if (blocks.length && hash(blocks[0]) !== rec.adapterHash && hash(blocks[0]) !== pending[blockKey]) throw Error(`The bridge block in ${op.instructions} was customised or has no ownership receipt; left unchanged.`);
          if (blocks.length && hash(blocks[0]) !== rec.adapterHash) recovery.adopted.push(blockKey);
          for (const temp of sweepTemps(op.config)) recovery.actions.push(`Removed the unfinished temporary file ${temp}.`);
          const block = adapterBlock({ core: p.core, kit: record.kit, provider: op.provider, instructions: p.instructions, overlay: join(p.overlays, `${op.provider}.md`), contract: p.contract });
          Object.assign(rec, { ready: false, host: op.host, os: platform(), config: op.config, instructions: op.instructions, skillRoot: op.skillRoot, overlay: join(p.overlays, `${op.provider}.md`) });
          if (blocks.length === 1 && blocks[0] === block) { rec.ready = true; rec.adapterHash = hash(block); persist(); break; }
          const inserted = (global.endsWith('\n') || !global ? '' : '\n') + (global ? '\n' : '') + block + '\n';
          pending[blockKey] = hash(block); rec.adapterInsert = blocks.length ? rec.adapterInsert || null : inserted; persist();
          save(op.instructions, blocks.length ? global.replace(blocks[0], () => block) : global + inserted);
          checkpoint(`adapter:${op.provider}`);
          rec.adapterHash = hash(block); rec.ready = true;
          commit([blockKey]); persist();
          break;
        }
        case 'native-import': {
          const entry = { provider: op.provider, source: op.source, translator: op.translator, requested: op.items, at: new Date().toISOString() };
          if (!nativeImportRunner) { entry.status = 'blocked'; entry.reason = 'No programmatic runner was available in this session; run the vendor importer yourself and re-run verify.'; }
          else { try { const out = nativeImportRunner(op); entry.status = out.failed?.length ? (out.imported?.length ? 'partial' : 'failed') : 'completed'; entry.imported = out.imported || []; entry.failed = out.failed || []; } catch (error) { entry.status = 'failed'; entry.reason = error.message; } }
          manifest.nativeImports.push(entry); results.nativeImports.push(entry); persist();
          break;
        }
        case 'retire-provider-skill': {
          const rec = manifest.providers[op.provider];
          const out = retireSkill({ name: op.name, skillRoot: rec.skillRoot, receipt: rec, persist, kept, transaction: transaction(op.provider) });
          results.removed.push(...out.removed);
          break;
        }
        case 'remove-block': {
          const rec = manifest.providers[op.provider];
          const global = read(rec.instructions);
          const { blocks, ambiguous } = managedBlocks(global);
          const markers = (global.match(/<!-- selr-bridge:(?:begin|end) -->/g) || []).length;
          if (!blocks.length && !markers) {
            recovery.actions.push(`The bridge block in ${rec.instructions} was already removed; finishing that removal.`);
            if (rec.movedInstructions && !global.trim() && read(p.instructions).trim()) save(rec.instructions, read(p.instructions));
            break;
          }
          const stagedBlock = pending[`${rec.instructions}#selr-bridge-block`];
          if (ambiguous || (hash(blocks[0]) !== rec.adapterHash && hash(blocks[0]) !== stagedBlock)) throw Error(`The bridge block in ${rec.instructions} is ambiguous or customised; left unchanged.`);
          // Exactly the text the bridge inserted comes out; the user's bytes around it stay as they were.
          const inserted = rec.adapterInsert && global.includes(rec.adapterInsert) ? rec.adapterInsert : null;
          let stripped;
          if (inserted) stripped = global.replace(inserted, () => '');
          else { const at = global.indexOf(blocks[0]); stripped = global.slice(0, at).replace(/\n+$/, '\n') + global.slice(at + blocks[0].length).replace(/^\n+/, ''); }
          if (rec.movedInstructions && !stripped.trim()) {
            const portable = read(p.instructions);
            if (portable.trim()) { stripped = portable; recovery.actions.push(`Put the portable instructions back into ${rec.instructions}, where they came from.`); }
          }
          save(rec.instructions, stripped === '\n' ? '' : stripped);
          delete pending[`${rec.instructions}#selr-bridge-block`];
          checkpoint(`remove-block:${op.provider}`);
          break;
        }
        case 'forget-provider': delete manifest.providers[op.provider]; persist(); break;
        case 'uninstall-core': {
          const bridgeOwned = [['memory', p.memory], ['contract', p.contract], ['mcpInventory', p.mcp], ...PROVIDERS.map(x => [`overlay:${x}`, join(p.overlays, `${x}.md`)])];
          for (const [key, path] of bridgeOwned) {
            const committed = manifest.core[key]?.hash;
            if (!existsSync(path)) continue;
            if (committed && current(path) === committed) { stageRemovals([path]); rmSync(path); checkpoint(`uninstall:${key}`); commitRemovals([path]); results.removed.push(path); }
            else kept.push(path);
          }
          for (const name of Object.keys(manifest.core.skills || {})) retireSkill({ name, skillRoot: coreSkillRoot, receipt: coreReceipt(), persist, kept, transaction: transaction('core') });
          for (const [dir, rec] of Object.entries(manifest.projects || {})) {
            if (!existsSync(rec.pointer)) { delete manifest.projects[dir]; continue; }
            if (current(rec.pointer) === rec.hash) { stageRemovals([rec.pointer]); rmSync(rec.pointer); checkpoint(`uninstall:project:${basename(dir)}`); commitRemovals([rec.pointer]); results.removed.push(rec.pointer); delete manifest.projects[dir]; }
            else kept.push(rec.pointer);
          }
          persist();
          break;
        }
        default: throw Error(`Unknown plan operation ${op.op}; nothing further applied.`);
      }
    }
    // Finish removals a stopped run recorded, and adopt files it wrote that
    // this plan no longer visits: a recorded intent proves they are the bridge's.
    for (const [path, expected] of Object.entries(manifest.pending.removals)) {
      if (!existsSync(path) || lstatSync(path).isSymbolicLink()) { delete manifest.pending.removals[path]; continue; }
      try { safePath(path); } catch { recovery.actions.push(`Preserved ${path}: it is now behind a link.`); delete manifest.pending.removals[path]; continue; }
      if (expected && !lstatSync(path).isDirectory() && hash(readFileSync(path)) === expected) { rmSync(path); recovery.actions.push(`Finished removing ${path}, which a stopped run had started to remove.`); }
      else recovery.actions.push(`Preserved ${path} because it changed after the stopped run recorded its removal.`);
      delete manifest.pending.removals[path];
    }
    for (const [path, expected] of Object.entries(pending)) {
      if (path.includes('#') || !existsSync(path) || lstatSync(path).isSymbolicLink() || hash(readFileSync(path)) !== expected) continue;
      if (path.startsWith(p.handoffs + sep)) { const name = relative(p.handoffs, path).replace(/\.md$/, ''); (manifest.core.handoffs ||= {})[name] ||= { path, hash: expected, provider: 'unknown', createdAt: interrupted?.startedAt || null }; recovery.adopted.push(path); recovery.actions.push(`Recorded the handoff ${path}, written by the stopped run.`); continue; }
      for (const [label, rec] of [['core', { skillRoot: coreSkillRoot, skills: manifest.core.skills }], ...Object.entries(manifest.providers)]) {
        if (!rec.skillRoot || !path.startsWith(resolve(rec.skillRoot) + sep)) continue;
        const [name, ...rest] = relative(rec.skillRoot, path).split(sep);
        (rec.skills[name] ||= { files: {}, version: record.kitVersion }).files[rest.join('/')] = expected;
        recovery.adopted.push(path); recovery.actions.push(`Recorded ${label} ownership of ${path}, written by the stopped run.`);
      }
    }
    if (record.intent === 'uninstall') {
      delete manifest.pending;
      persist();
      const remaining = Object.keys(manifest.providers).length;
      if (!remaining) { rmSync(p.plans, { recursive: true, force: true }); rmSync(p.manifest, { force: true }); }
      return { applied: true, planId, intent: record.intent, ...results, recovery: recovery.actions.length || recovery.adopted.length ? recovery : null, summary: 'The bridge is uninstalled. Your portable instructions, shared knowledge, handoffs and every customised file remain in place.' };
    }
    delete manifest.pending;
    manifest.lastPlan = { id: planId, intent: record.intent, appliedAt: new Date().toISOString() };
    persist();
    const recovered = recovery.actions.length || recovery.adopted.length ? recovery : null;
    if (recovered) recovered.summary = summariseRecovery(recovery);
    return { applied: true, planId, intent: record.intent, noop: record.noop, ...results, recovery: recovered, providers: Object.fromEntries(Object.entries(manifest.providers).map(([k, v]) => [k, { ready: v.ready, instructions: v.instructions, skillRoot: v.skillRoot }])), summary: (recovered ? 'An earlier operation did not finish; this run continued it from its saved progress. ' : '') + (record.noop ? 'Nothing needed changing.' : `Applied plan ${planId}. ${results.userSteps.length ? `${results.userSteps.length} step${results.userSteps.length === 1 ? '' : 's'} remain for you; run verify afterwards.` : 'Run verify to confirm both providers read the portable core.'}`) };
  } finally { held.release(); }
}
function discoverBody(instructionsPath) {
  const body = read(instructionsPath);
  const { blocks } = managedBlocks(body);
  let user = body; for (const b of blocks) user = user.replace(b, '');
  return user.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trim() + '\n';
}
function summariseRecovery({ actions, adopted }) {
  const parts = [];
  if (actions.some(a => /did not finish/.test(a))) parts.push('an earlier operation stopped part-way and this run continued it from the progress saved in the receipt');
  if (adopted.length) parts.push(`${adopted.length} file${adopted.length === 1 ? '' : 's'} the earlier run had already written ${adopted.length === 1 ? 'was' : 'were'} kept as the bridge's own rather than treated as customised`);
  if (actions.some(a => /operation lock/.test(a))) parts.push('the lock left by the stopped run was removed');
  if (actions.some(a => /temporary file/.test(a))) parts.push('unfinished temporary files were cleaned up');
  if (actions.some(a => /Finished removing/.test(a))) parts.push('a removal the earlier run had started was finished');
  return `Recovery: ${parts.join('; ')}. Nothing was installed twice and nothing you changed was overwritten.`;
}

// --- Verify -------------------------------------------------------------------
// Reads the resulting state and reports evidence. Every check has one state:
// confirmed | unknown | unsupported | blocked | conflicted | failed. An unread
// value is reported as unknown, never as absent.
export function verify(options = {}) {
  const inv = inspect(options);
  const manifest = loadManifest(inv.home);
  const p = paths(inv.home);
  const checks = [];
  const check = (name, state, detail) => checks.push({ name, state, detail });
  if (!manifest) { check('receipt', 'failed', 'No bridge receipt exists; the bridge is not installed here.'); return { checks, healthy: false, summary: 'The bridge is not installed on this computer.' }; }
  if (manifest.pending) check('receipt', 'blocked', `An operation (plan ${manifest.pending.planId}) stopped part-way; run plan and apply again to continue it.`);
  else check('receipt', 'confirmed', `Receipt at ${p.manifest}, kit ${short(manifest.kit?.version)}.`);
  if (inv.receipt.lock) check('lock', 'blocked', 'An operation lock is present; another bridge operation is running or stopped. It is reclaimed automatically when its owner has stopped.');
  for (const [key, path] of [['memory', p.memory], ['contract', p.contract]]) {
    if (!existsSync(path)) check(`core:${key}`, 'failed', `${path} is missing.`);
    else if (manifest.core[key]?.hash === hash(read(path))) check(`core:${key}`, 'confirmed', `${path} matches its receipt.`);
    else check(`core:${key}`, 'blocked', `${path} differs from its receipt (customised); updates leave it alone.`);
  }
  check('core:instructions', existsSync(p.instructions) ? 'confirmed' : 'failed', existsSync(p.instructions) ? `${p.instructions} present (${read(p.instructions).length} bytes).` : `${p.instructions} is missing.`);
  if (inv.core.knowledge.present) check('core:knowledge', inv.core.knowledge.readable ? 'confirmed' : 'failed', inv.core.knowledge.readable ? `${inv.core.knowledge.entries} shared knowledge entries readable.` : 'knowledge.json exists but is not readable; it is left unchanged.');
  else check('core:knowledge', 'confirmed', 'No shared knowledge recorded yet (the store is created on first save).');
  for (const [provider, rec] of Object.entries(manifest.providers)) {
    const found = inv.providers[provider];
    const global = read(rec.instructions);
    const { blocks, ambiguous } = managedBlocks(global);
    if (ambiguous) check(`${provider}:block`, 'conflicted', `${rec.instructions} has ambiguous bridge markers.`);
    else if (blocks.length !== 1) check(`${provider}:block`, 'failed', `${rec.instructions} has ${blocks.length} bridge blocks; expected one.`);
    else if (hash(blocks[0]) !== rec.adapterHash) check(`${provider}:block`, 'blocked', `The bridge block in ${rec.instructions} was edited; it is left unchanged.`);
    else if (![p.instructions, importPath(p.instructions)].some(x => blocks[0].includes(x)) || ![join(p.overlays, `${provider}.md`), importPath(join(p.overlays, `${provider}.md`))].some(x => blocks[0].includes(x)) || [join(p.overlays, `${other(provider)}.md`), importPath(join(p.overlays, `${other(provider)}.md`))].some(x => blocks[0].includes(x))) check(`${provider}:block`, 'failed', 'The bridge block points at the wrong overlay or instructions.');
    else check(`${provider}:block`, 'confirmed', `${provider} reads ${p.instructions} and only its own overlay ${join(p.overlays, `${provider}.md`)}.`);
    check(`${provider}:ready`, rec.ready ? 'confirmed' : 'blocked', rec.ready ? `${provider} receipt is ready.` : `${provider} receipt is not ready; the last operation did not complete.`);
    const overlay = join(p.overlays, `${provider}.md`);
    check(`${provider}:overlay`, existsSync(overlay) ? 'confirmed' : 'failed', existsSync(overlay) ? `${overlay} present.` : `${overlay} missing.`);
    for (const [name, owned] of Object.entries(rec.skills || {})) {
      const dir = join(rec.skillRoot, name);
      if (!existsSync(dir)) { check(`${provider}:skill:${name}`, 'failed', `${dir} is missing.`); continue; }
      const files = readSkill(dir).files;
      const changed = Object.entries(owned.files || {}).filter(([f, h]) => files[f] !== h).map(([f]) => f);
      const added = Object.keys(files).filter(f => !owned.files?.[f]);
      if (!changed.length && !added.length) check(`${provider}:skill:${name}`, 'confirmed', `${name} matches its receipt.`);
      else check(`${provider}:skill:${name}`, 'blocked', `${name} differs from its receipt (${[...changed.map(f => `changed ${f}`), ...added.map(f => `added ${f}`)].join(', ')}); run sync to reconcile.`);
    }
    if (!found.present) check(`${provider}:config`, 'unknown', `${provider}'s configuration folder ${found.config} was not found; its state cannot be read.`);
  }
  for (const [name, baseline] of Object.entries(manifest.core.skills || {})) {
    const sides = Object.fromEntries(PROVIDERS.filter(x => manifest.providers[x]?.skillRoot).map(x => [x, existsSync(join(manifest.providers[x].skillRoot, name)) ? readSkill(join(manifest.providers[x].skillRoot, name)).files : null]));
    const result = reconcileSkill({ name, baseline: baseline.baseline || baseline.files, core: existsSync(join(p.skills, name)) ? readSkill(join(p.skills, name)).files : null, claude: sides.claude ?? null, codex: sides.codex ?? null, present: { claude: 'claude' in sides, codex: 'codex' in sides } });
    if (result.decision === 'conflict') check(`shared:${name}`, 'conflicted', result.reason);
    else if (result.decision !== 'unchanged') check(`shared:${name}`, 'blocked', `${name}: ${result.reason} Run sync to reconcile.`);
    else check(`shared:${name}`, 'confirmed', `${name} is identical in the portable core${Object.keys(sides).length ? ` and ${Object.keys(sides).join(' and ')}` : ''}.`);
  }
  for (const [dir, rec] of Object.entries(manifest.projects || {})) {
    if (!existsSync(rec.pointer)) check(`project:${dir}`, 'failed', `${rec.pointer} is missing.`);
    else if (hash(read(rec.pointer)) !== rec.hash) check(`project:${dir}`, 'blocked', `${rec.pointer} was edited; it is left unchanged.`);
    else if (!existsSync(join(dir, 'AGENTS.md'))) check(`project:${dir}`, 'failed', `${join(dir, 'AGENTS.md')} is missing, so the pointer has nothing to read.`);
    else check(`project:${dir}`, 'confirmed', `${dir}: both providers read AGENTS.md (Claude through the CLAUDE.md pointer).`);
  }
  for (const entry of manifest.nativeImports || []) {
    // What the importer claims is checked against the destination itself.
    const dest = inv.providers[entry.provider];
    const seen = { instructions: dest.instructions.exists, skills: dest.skills.length > 0, commands: dest.commands.length > 0, subagents: dest.subagents.length > 0, mcp: dest.mcp.length > 0, settings: dest.settings.present, hooks: dest.hooks.present === true, plugins: dest.plugins.present === true };
    const claimed = entry.imported || [];
    const unseen = claimed.filter(item => item in seen && !seen[item]);
    const unverifiable = claimed.filter(item => !(item in seen));
    const state = entry.status === 'failed' ? 'failed' : unseen.length ? 'failed' : entry.status === 'partial' ? 'blocked' : entry.status === 'completed' ? 'confirmed' : 'unknown';
    check(`native-import:${entry.source}->${entry.provider}`, state, `${entry.translator}: importer reported ${entry.status}${entry.reason ? ` (${entry.reason})` : ''}${entry.failed?.length ? `; failed: ${entry.failed.join(', ')}` : ''}. Destination inspected: ${claimed.length ? claimed.map(item => `${item} ${seen[item] === undefined ? 'not checkable here' : seen[item] ? 'present' : 'absent'}`).join(', ') : 'nothing claimed'}${unseen.length ? `. Claimed but absent: ${unseen.join(', ')}` : ''}${unverifiable.length ? `. Unknown for: ${unverifiable.join(', ')}` : ''}.`);
  }
  const conflictsDir = p.conflicts;
  if (existsSync(conflictsDir)) for (const name of readdirSync(conflictsDir).sort()) check(`candidates:${name}`, 'unknown', `Preserved candidate copies for "${name}" remain under ${join(conflictsDir, name)}; delete them when you are sure of the result.`);
  const bad = checks.filter(c => ['failed', 'conflicted', 'blocked'].includes(c.state));
  const bridged = Object.keys(manifest.providers);
  return { checks, healthy: !bad.length, summary: bad.length ? `${bad.length} check${bad.length === 1 ? '' : 's'} need attention: ${bad.map(c => c.name).join(', ')}.` : `All ${checks.length} checks confirmed. ${bridged.length === 2 ? 'Both providers read the same portable core and only their own overlay.' : bridged.length === 1 ? `${bridged[0]} reads the portable core and only its own overlay.` : 'No provider is bridged; the portable core is intact.'}` };
}

// --- Status -------------------------------------------------------------------
export function status(options = {}) {
  const inv = inspect(options);
  const manifest = loadManifest(inv.home);
  const p = paths(inv.home);
  const report = { installed: Boolean(manifest), providers: {}, shared: [], changed: [], conflicted: [], providerSpecific: [], unsupported: [], unhealthy: [], pending: manifest?.pending ? { planId: manifest.pending.planId, intent: manifest.pending.intent } : null, lock: inv.receipt.lock, handoffs: inv.core.handoffs, knowledgeEntries: inv.core.knowledge.entries };
  if (!manifest) return { ...report, summary: 'The bridge is not installed on this computer.' };
  for (const [provider, rec] of Object.entries(manifest.providers)) report.providers[provider] = { ready: rec.ready, instructions: rec.instructions, skillRoot: rec.skillRoot, overlay: join(p.overlays, `${provider}.md`), present: inv.providers[provider].present };
  for (const [name, baseline] of Object.entries(manifest.core.skills || {})) {
    const sides = Object.fromEntries(PROVIDERS.filter(x => manifest.providers[x]?.skillRoot).map(x => [x, existsSync(join(manifest.providers[x].skillRoot, name)) ? readSkill(join(manifest.providers[x].skillRoot, name)).files : null]));
    const r = reconcileSkill({ name, baseline: baseline.baseline || baseline.files, core: existsSync(join(p.skills, name)) ? readSkill(join(p.skills, name)).files : null, claude: sides.claude ?? null, codex: sides.codex ?? null, present: { claude: 'claude' in sides, codex: 'codex' in sides } });
    if (r.decision === 'unchanged') report.shared.push(name);
    else if (r.decision === 'conflict') report.conflicted.push({ name, reason: r.reason, sides: r.sides });
    else report.changed.push({ name, decision: r.decision, from: r.from, reason: r.reason });
  }
  inv.manifest = manifest;
  const inventoried = existsSync(p.mcp) ? (() => { try { return JSON.parse(read(p.mcp)).servers || []; } catch { return []; } })() : [];
  report.mcpInventoried = inventoried.length;
  for (const it of classify(inv)) {
    if (it.kind === 'mcp' && it.disposition === 'translated' && inventoried.some(s => s.provider === it.metadata.provider && s.name === it.metadata.name)) continue;
    if (it.collision === 'linked') { report.shared.push(it.name); continue; }
    if (it.kind === 'instruction-block' || it.id === 'instructions:portable' || it.id.startsWith('move-instructions:') || it.kind === 'native-import' || it.kind === 'relocate') continue;
    if (it.disposition === 'unsupported') report.unsupported.push({ name: it.name, kind: it.kind, reason: it.reason });
    else if (it.disposition.endsWith('-only')) report.providerSpecific.push({ name: it.name, kind: it.kind, provider: it.disposition.replace('-only', ''), reason: it.reason });
    else if (it.collision === 'conflict') report.conflicted.push({ name: it.name, reason: it.reason });
    else report.changed.push({ name: it.name, decision: 'share', kind: it.kind, reason: it.reason });
  }
  const v = verify(options);
  report.unhealthy = v.checks.filter(c => ['failed', 'blocked', 'conflicted'].includes(c.state));
  const parts = [`${report.shared.length} shared skill${report.shared.length === 1 ? '' : 's'} in step`];
  if (report.changed.length) parts.push(`${report.changed.length} change${report.changed.length === 1 ? '' : 's'} waiting for sync`);
  if (report.conflicted.length) parts.push(`${report.conflicted.length} conflict${report.conflicted.length === 1 ? '' : 's'} needing your choice`);
  parts.push(`${report.providerSpecific.length} provider-specific item${report.providerSpecific.length === 1 ? '' : 's'}`, `${report.unsupported.length} unsupported`);
  if (report.unhealthy.length) parts.push(`${report.unhealthy.length} health check${report.unhealthy.length === 1 ? '' : 's'} needing attention`);
  if (report.pending) parts.push('an unfinished operation to resume');
  return { ...report, summary: `Bridge installed for ${Object.keys(manifest.providers).join(' and ') || 'no provider'}: ${parts.join(', ')}.` };
}
