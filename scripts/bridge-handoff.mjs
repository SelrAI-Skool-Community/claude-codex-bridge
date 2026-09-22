// Handoff snapshots: portable Markdown generated from user-selected project
// context, checked for secrets (blocks) and machine-specific references (warns)
// before it is saved. Never written into a provider's transcript store.
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hash, read, safePath, save } from './bridge-files.mjs';
import { loadManifest, paths } from './bridge-engine.mjs';
import { scrubFiles } from './scrub.mjs';
import { checkPortability } from './portability.mjs';

export const HANDOFF_FIELDS = [
  ['purpose', 'Purpose', 'What this work is for.'],
  ['currentState', 'Current state', 'Where things stand right now.'],
  ['completedWork', 'Completed work', 'What has been done and verified.'],
  ['decisions', 'Decisions', 'Choices made and why.'],
  ['openWork', 'Open work', 'What remains, in order.'],
  ['blockers', 'Blockers and open questions', 'What is stopping progress or needs an answer.'],
  ['relevantPaths', 'Relevant paths', 'Files and folders the next session needs.'],
  ['verificationRun', 'Verification already run', 'Tests and checks that have passed, and how.'],
];
const listOrText = v => Array.isArray(v) ? v.map(x => `- ${String(x).trim()}`).join('\n') : String(v ?? '').trim();

// Pure: same input, provider, version and createdAt give the same bytes.
export function renderHandoff({ input, provider, kitVersion, createdAt }) {
  const name = String(input.name || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw Error('Give the handoff a short lower-case name (letters, digits and dashes).');
  if (!['claude', 'codex'].includes(provider)) throw Error('Name the provider creating the handoff: claude or codex.');
  const missing = HANDOFF_FIELDS.filter(([key]) => input[key] === undefined || input[key] === null || (Array.isArray(input[key]) ? !input[key].length : !String(input[key]).trim())).map(([key]) => key);
  if (missing.length) throw Error(`Handoff is missing: ${missing.join(', ')}. Every section is required; write "none" when a section genuinely has nothing.`);
  const sections = HANDOFF_FIELDS.map(([key, title]) => `## ${title}\n\n${listOrText(input[key])}\n`).join('\n');
  const body = `# Handoff: ${name}\n\nPortable project context created by the Claude + Codex Bridge. Read it as context for continuing the work; it is not chat history.\n\n${sections}\n## Source\n\n- Provider: ${provider}\n- Created: ${createdAt}\n- Bridge version: ${kitVersion}\n- Project: ${String(input.project || 'not stated').trim()}\n`;
  return { name, body };
}

export function createHandoff({ home, input, provider, kitVersion = 'unknown', createdAt = new Date().toISOString() }) {
  home = realpathSync(resolve(home));
  const manifest = loadManifest(home);
  if (!manifest) throw Error('The bridge is not installed here; set it up before creating a handoff.');
  const p = paths(home);
  const { name, body } = renderHandoff({ input, provider, kitVersion, createdAt });
  const scrub = scrubFiles([{ path: `${name}.md`, content: body }]);
  const portability = checkPortability([{ path: `${name}.md`, content: body }]);
  if (scrub.hits.length) return { saved: false, blocked: true, name, hits: scrub.hits.map(({ ruleId, line, label, fingerprint }) => ({ ruleId, line, label, fingerprint })), warnings: portability.warnings.map(w => ({ ruleId: w.ruleId, line: w.line, reference: w.reference, plain: w.plain })), summary: `Stopped: ${scrub.hits.length} secret-shaped value${scrub.hits.length === 1 ? '' : 's'} found (${scrub.hits.map(h => `line ${h.line} ${h.ruleId}`).join(', ')}). Nothing was saved. Remove the value and try again; treat this report itself as sensitive.` };
  const path = join(p.handoffs, `${name}.md`);
  safePath(path);
  if (existsSync(path) && manifest.core.handoffs?.[name]?.hash !== hash(read(path))) return { saved: false, blocked: true, name, path, hits: [], warnings: [], summary: `A handoff named "${name}" already exists at ${path} and was edited by hand; choose another name or remove it deliberately.` };
  save(path, body);
  manifest.core.handoffs ||= {};
  manifest.core.handoffs[name] = { path, hash: hash(body), provider, createdAt };
  save(p.manifest, JSON.stringify(manifest, null, 2) + '\n');
  return { saved: true, blocked: false, name, path, hits: [], warnings: portability.warnings.map(w => ({ ruleId: w.ruleId, line: w.line, reference: w.reference, plain: w.plain })), summary: `Saved ${path}.${portability.warnings.length ? ` ${portability.warnings.length} portability note${portability.warnings.length === 1 ? '' : 's'}: machine-specific references the reader on another computer should know about.` : ''} The other provider reads it as project context at the start of its next task.` };
}
export function listHandoffs({ home }) {
  home = realpathSync(resolve(home));
  const p = paths(home);
  const manifest = loadManifest(home);
  const files = existsSync(p.handoffs) ? readdirSync(p.handoffs).filter(f => f.endsWith('.md')).sort() : [];
  return files.map(f => { const name = f.replace(/\.md$/, ''); const rec = manifest?.core?.handoffs?.[name]; const path = join(p.handoffs, f); return { name, path, provider: rec?.provider || 'unknown', createdAt: rec?.createdAt || 'unknown', edited: rec ? rec.hash !== hash(read(path)) : 'unknown' }; });
}
