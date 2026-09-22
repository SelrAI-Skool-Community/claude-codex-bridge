#!/usr/bin/env node
// Checks docs/lineage.json: every local path exists and every `unchanged`
// entry with a checksum still matches. Exit 1 on drift.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lineage = JSON.parse(readFileSync(join(repo, 'docs/lineage.json'), 'utf8'));
const problems = [];
for (const port of lineage.ports) {
  const locals = port.local.replace(/\([^)]*\)/g, '').split(',').map(x => x.trim().split(' ')[0].replace(/\/\*\*$/, '')).filter(Boolean);
  for (const local of locals) if (!existsSync(join(repo, local))) problems.push(`${local} listed in lineage but missing`);
  const local = locals[0];
  if (port.status === 'unchanged' && port.sha256) {
    const actual = createHash('sha256').update(readFileSync(join(repo, local), 'utf8').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
    if (actual !== port.sha256) problems.push(`${local} changed without a re-vendor (expected ${port.sha256.slice(0, 12)}, got ${actual.slice(0, 12)})`);
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; } else console.log(`lineage ok: ${lineage.ports.length} ports`);
