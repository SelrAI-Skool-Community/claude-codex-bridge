#!/usr/bin/env node
// Shared knowledge helper. Installed beside the bridge receipt as
// ~/.selr/bridge/memory.mjs; portable and independent of the kit download.
//
// PORTED from claude-workshop-kit scripts/workshop-memory.mjs at revision
// 563a8746d4d1d4e0b6e0e59dfd80eb257728a47e (see docs/lineage.json). The
// behaviour is verbatim: keyed facts, preferences, rules and decisions with
// provider provenance, timestamp and per-key revision; a lock; a stale-write
// conflict that returns both values without writing; atomic replacement.
// The only change is this header and the usage line's program name.
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const shared = dirname(fileURLToPath(import.meta.url));
const path = join(shared, 'knowledge.json');
const lock = join(shared, 'knowledge.lock');
function read() {
  if (!existsSync(path)) return { schema: 1, entries: {} };
  if (!lstatSync(path).isFile()) throw Error('Shared knowledge must be a regular file.');
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.schema !== 1 || !data.entries || Array.isArray(data.entries)) throw Error('Unrecognised shared knowledge; left unchanged.');
  return data;
}
try {
  const [action, key, revision, value, provider, category] = process.argv.slice(2);
  if (action === 'read' && process.argv.length === 3) {
    console.log(JSON.stringify(read(), null, 2));
  } else if (action === 'put' && process.argv.length === 8) {
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(key) || ['constructor', 'prototype'].includes(key)) throw Error('Use a short lower-case fact key.');
    if (!/^(0|[1-9][0-9]*)$/.test(revision) || !Number.isSafeInteger(Number(revision))) throw Error('Supply the revision you read (0 for a new fact).');
    if (!value.trim() || !['claude', 'codex'].includes(provider) || !['fact', 'preference', 'rule', 'decision'].includes(category)) throw Error('Supply a value, current provider and fact|preference|rule|decision category.');
    try { mkdirSync(lock); } catch { throw Error('Shared knowledge is busy. Read again and retry later. If a writer crashed, confirm it stopped before removing knowledge.lock.'); }
    try {
      const data = read();
      const current = data.entries[key] || null;
      if ((current?.revision || 0) !== Number(revision)) {
        console.log(JSON.stringify({ conflict: true, key, current, proposed: { value, provider, category }, message: 'Nothing overwritten. Compare both values with the user; only submit their chosen value against a fresh revision.' }, null, 2));
        process.exitCode = 2;
      } else {
        const entry = { value, provider, category, revision: Number(revision) + 1, updatedAt: new Date().toISOString() };
        data.entries[key] = entry;
        const temp = join(shared, `knowledge-${randomUUID()}.tmp`);
        try {
          writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
          renameSync(temp, path);
        } finally { rmSync(temp, { force: true }); }
        console.log(JSON.stringify({ saved: true, key, ...entry }));
      }
    } finally { rmSync(lock, { recursive: true }); }
  } else throw Error('Usage: node memory.mjs read | put <key> <read revision> <value> <claude|codex> <fact|preference|rule|decision>');
} catch (error) { console.error(error.message); process.exitCode = 1; }
