// Skill-level ownership operations: copy one skill directory into a skill root
// recording every owned file, and retire an owned skill leaving customisations.
//
// PORTED from claude-workshop-kit scripts/workshop-skills.mjs at revision
// 563a8746d4d1d4e0b6e0e59dfd80eb257728a47e (see docs/lineage.json). Adapted:
// the source is any skill directory (`source`) rather than `<kit>/skills/<name>`,
// so the same code copies a portable-core skill into a provider root and a
// provider skill into the portable core, and a receipt entry keeps any extra
// fields it carries (the bridge records a reconciliation baseline there). The
// ownership, staging, adoption, preservation and retirement rules are verbatim.
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { hash, safePath, save, sweepTemps, tree } from './bridge-files.mjs';

// Copy one skill into a skill root, recording every owned file in the receipt.
// Existing files that are not owned, or differ from their receipt, are kept.
export function installSkill({ source, name, skillRoot, receipt, version, persist, kept, transaction = null }) {
  const destination = join(skillRoot, name);
  try { safePath(destination); } catch { kept.push(name); return false; }
  const prior = receipt.skills[name];
  const pending = transaction?.pending || {};
  if (existsSync(destination) && !prior && !Object.keys(pending).some(p => p.startsWith(destination + sep))) { kept.push(name); return false; }
  if (transaction) for (const temp of sweepTemps(destination, { recursive: true })) transaction.recovery.actions.push(`Removed the unfinished temporary file ${temp}.`);
  const owned = { ...prior, files: { ...prior?.files }, version };
  receipt.skills[name] = owned;
  const writes = [];
  for (const file of tree(source)) {
    const target = join(destination, file);
    const body = readFileSync(join(source, file));
    try { safePath(target); } catch { kept.push(`${name}/${file}`); continue; }
    const current = existsSync(target) ? hash(readFileSync(target)) : null;
    if (current !== null && current !== owned.files[file] && current !== pending[target]) { kept.push(`${name}/${file}`); continue; }
    transaction?.adoptIfStaged(target, owned.files[file]);
    const expected = hash(body);
    const mode = lstatSync(join(source, file)).mode & 0o777;
    if (owned.files[file] === expected && current === expected && (platform() === 'win32' || (lstatSync(target).mode & 0o777) === mode)) continue;
    writes.push([target, file, body, mode]);
  }
  if (writes.length) {
    // One skill is staged before it is written, so a run that stops part-way
    // can prove every file it wrote was its own.
    transaction?.stage(writes.map(([target, , body]) => [target, body]));
    for (const [target, file, body, mode] of writes) {
      save(target, body, mode); owned.files[file] = hash(body);
      transaction?.checkpoint(`skill-file:${name}/${file}`);
      if (!transaction) persist();
    }
    transaction?.checkpoint(`skill:${name}`);
    transaction?.commit(writes.map(([target]) => target));
    persist();
  }
  return true;
}
// Remove an owned skill from a skill root. Any customised or unowned file
// keeps the whole folder in place; only unchanged owned files are ever removed.
export function retireSkill({ name, skillRoot, receipt, persist, kept, dryRun = false, transaction = null }) {
  const owned = receipt.skills[name];
  if (!owned) return { removed: [], customised: false };
  const directory = resolve(skillRoot, name);
  if (!directory.startsWith(resolve(skillRoot) + sep)) throw Error('Invalid owned skill path');
  const unchanged = [];
  // A file the user added counts as a customisation: the folder is theirs to keep.
  let customised = false;
  if (existsSync(directory)) { try { customised = tree(directory).some(file => !owned.files?.[file]); } catch { customised = true; } }
  for (const [file, expected] of Object.entries(owned.files || {})) {
    const target = resolve(directory, file);
    if (!target.startsWith(directory + sep)) throw Error('Invalid owned file path');
    try { safePath(target); } catch { customised = true; continue; }
    if (!existsSync(target)) continue;
    if (hash(readFileSync(target)) !== expected) customised = true; else unchanged.push(target);
  }
  if (customised) { kept.push(name); return { removed: [], customised: true }; }
  if (dryRun) return { removed: [], customised: false };
  transaction?.stageRemovals(unchanged);
  for (const target of unchanged) {
    rmSync(target);
    transaction?.checkpoint(`retire-skill:${name}/${target.slice(directory.length + 1)}`);
    for (let p = dirname(target); p !== resolve(skillRoot) && existsSync(p) && readdirSync(p).length === 0; p = dirname(p)) rmSync(p, { recursive: true });
  }
  // A stopped earlier run may already have removed the only file in one branch,
  // leaving empty directories that are no longer reached by the loop above.
  if (existsSync(directory) && tree(directory).length === 0) rmSync(directory, { recursive: true });
  delete receipt.skills[name];
  transaction?.commitRemovals(unchanged);
  persist();
  return { removed: unchanged, customised: false };
}
