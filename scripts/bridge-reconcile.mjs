// Three-way reconciliation of one shared skill: the portable baseline (the last
// reconciled content, recorded in the receipt), the current portable-core copy,
// and the current copy on each provider. Pure: file hashes in, a decision out.
//
// Decisions: unchanged | promote (one side changed) | accept-both (equal
// changes on both providers) | conflict (different changes, delete-versus-edit,
// or the core changed independently while a provider also changed).
const equal = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = o => o === null ? null : Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

// baseline/core/claude/codex are { file: hash } maps, or null for absent.
export function reconcileSkill({ name, baseline, core, claude, codex, present = { claude: true, codex: true } }) {
  const sides = {};
  for (const [side, files] of Object.entries({ core, claude, codex })) {
    if (side !== 'core' && !present[side]) { sides[side] = 'absent-provider'; continue; }
    sides[side] = files === null ? (baseline === null ? 'absent' : 'deleted') : baseline === null ? 'added' : equal(files, baseline) ? 'unchanged' : 'changed';
  }
  const providers = ['claude', 'codex'].filter(p => present[p]);
  const changedProviders = providers.filter(p => ['changed', 'deleted', 'added'].includes(sides[p]));
  const coreChanged = ['changed', 'deleted', 'added'].includes(sides.core);
  const describe = (decision, extra = {}) => ({ name, decision, sides, ...extra });
  if (!changedProviders.length && !coreChanged) return describe('unchanged');
  if (!changedProviders.length && coreChanged) return describe('promote', { from: 'core', reason: sides.core === 'deleted' ? 'The portable copy was removed; the provider copies will be retired where they are unchanged.' : 'The portable copy changed and no provider copy did.' });
  if (coreChanged) return describe('conflict', { reason: 'The portable copy changed independently of a provider copy. Nothing is written until you choose.' });
  if (changedProviders.length === 1) {
    const from = changedProviders[0];
    return describe('promote', { from, reason: sides[from] === 'deleted' ? `${from} removed this skill and the other copy is unchanged; the removal will be promoted, keeping any customised file.` : `${from} changed this skill and the other copy is unchanged.` });
  }
  if (changedProviders.every(p => sides[p] === 'deleted')) return describe('promote', { from: changedProviders[0], reason: 'Both providers removed this skill; the portable copy will be retired.' });
  if (changedProviders.some(p => sides[p] === 'deleted')) return describe('conflict', { reason: 'One provider removed this skill while the other edited it. A useful edit is never erased by a deletion; choose the result.' });
  if (equal(claude, codex)) return describe('accept-both', { reason: 'Both providers made the same change; it is accepted once into the portable copy.' });
  return describe('conflict', { reason: 'Claude and Codex made different changes. Both versions are preserved until you choose Claude, Codex, the portable version, a merged result, or keeping it provider-specific.' });
}
