// File helpers shared by every bridge mutation: safe paths, atomic replacement,
// stale temporary files, tree listing and the owner-bearing operation lock.
//
// PORTED from claude-workshop-kit scripts/workshop-files.mjs at revision
// 563a8746d4d1d4e0b6e0e59dfd80eb257728a47e (see docs/lineage.json). Changes:
// the lock directory is `operation.lock` rather than `install.lock`, and the
// Workshop-only `isKit` download test is dropped. Every other rule is verbatim.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';

export const hash = body => createHash('sha256').update(body).digest('hex');
export const read = path => existsSync(path) ? readFileSync(path, 'utf8') : '';
export function safePath(path) {
  // Never write through somebody else's symlink/junction, including parent folders.
  for (let p = resolve(path); p !== parse(p).root; p = dirname(p)) {
    try { if (lstatSync(p).isSymbolicLink()) throw Error(`Linked path left unchanged: ${p}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
// Atomic replacement. The temporary name is unique per attempt, so a name left
// by a killed process can never block a later write, and a failed attempt
// leaves nothing behind. Only a completed rename is committed content.
export function save(path, body, mode = 0o600) {
  safePath(path);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.selr-${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, body, { flag: 'wx', mode });
    renameSync(temp, path);
  } finally { rmSync(temp, { force: true }); }
}
// A temporary file this kit's writer left behind (either naming era) is never
// content; it is what a write that never completed looks like.
export const isStaleTemp = name => /\.selr-\d+(?:-[0-9a-f]+)?\.tmp$/.test(name);
export function sweepTemps(dir, { recursive = false } = {}) {
  const removed = [];
  let entries;
  try { if (lstatSync(dir).isSymbolicLink()) return removed; entries = readdirSync(dir, { withFileTypes: true }); } catch { return removed; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { if (recursive) removed.push(...sweepTemps(p, { recursive })); }
    else if (e.isFile() && isStaleTemp(e.name)) { rmSync(p, { force: true }); removed.push(p); }
  }
  return removed;
}
export function tree(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
    const name = prefix + e.name;
    if (e.isSymbolicLink()) throw Error(`Source contains a link: ${name}`);
    return e.isDirectory() ? tree(join(dir, e.name), `${name}/`) : [name];
  });
}
// Same shape as an installed tree, but links are reported instead of thrown.
export function inventory(dir, prefix = '') {
  const files = [], links = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + e.name;
    if (e.isSymbolicLink()) links.push(name);
    else if (e.isDirectory()) { const inner = inventory(join(dir, e.name), `${name}/`); files.push(...inner.files); links.push(...inner.links); }
    else files.push(name);
  }
  return { files, links };
}
export const realOrNull = path => { try { return existsSync(path) ? path : null; } catch { return null; } };

// One operation at a time. The lock names its owner so a lock left by a
// process that stopped is reclaimed and reported, while a live owner, a claim
// still being recorded, or a lock from another computer is never overridden.
const processAlive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
function staleLock(lock, ownerPath) {
  let owner = null;
  try { owner = JSON.parse(readFileSync(ownerPath, 'utf8')); } catch { /* no record yet, or a record cut short */ }
  if (!owner || !Number.isInteger(owner.pid)) {
    const minutes = (Date.now() - lstatSync(lock).mtimeMs) / 60000;
    if (minutes < 1) return { stale: false, reason: 'Another bridge operation is starting right now. Wait a minute for it to finish, then retry.' };
    return { stale: true, description: `the operation lock with no owner record left ${Math.round(minutes)} minutes ago` };
  }
  const what = owner.reason || 'operation';
  if (owner.host && owner.host !== hostname()) return { stale: false, reason: `A ${what} started on another computer (${owner.host}) at ${owner.startedAt} still holds the operation lock at ${lock}. Finish or stop it there, then retry; remove the lock only once it has stopped.` };
  if (processAlive(owner.pid)) return { stale: false, reason: `Another ${what} (process ${owner.pid}, started ${owner.startedAt}) is still running. Wait for it to finish, then retry.` };
  return { stale: true, description: `the operation lock left by a ${what} that stopped (process ${owner.pid}, started ${owner.startedAt})` };
}
export function acquireLock(shared, reason = 'operation') {
  const lock = join(shared, 'operation.lock');
  const ownerPath = join(lock, 'owner.json');
  const claim = () => { mkdirSync(lock); writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, host: hostname(), reason, startedAt: new Date().toISOString() }) + '\n', { mode: 0o600 }); };
  let recovered = null;
  try { claim(); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const state = staleLock(lock, ownerPath);
    if (!state.stale) throw Error(state.reason);
    rmSync(lock, { recursive: true, force: true });
    try { claim(); } catch { throw Error('Another bridge operation started at the same moment. Wait for it to finish, then retry.'); }
    recovered = state.description;
  }
  return { lock, recovered, release: () => rmSync(lock, { recursive: true, force: true }) };
}
