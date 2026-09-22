import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './helpers.mjs';

test('the lineage manifest names the pinned upstream revisions and every port resolves', () => {
  const lineage = JSON.parse(readFileSync(join(REPO, 'docs/lineage.json'), 'utf8'));
  assert.equal(lineage.sources['claude-workshop-kit'].revision, '563a8746d4d1d4e0b6e0e59dfd80eb257728a47e');
  assert.equal(lineage.sources['claude-sync'].revision, '5aa59e30391f7a5ff070dd9378032493760cbc4d');
  for (const port of lineage.ports) assert.ok(['unchanged', 'adapted'].includes(port.status), port.local);
  const out = spawnSync(process.execPath, [join(REPO, 'scripts/check-lineage.mjs')], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
});

test('ported modules cite their upstream revision in their header', () => {
  for (const file of ['scripts/bridge-files.mjs', 'scripts/bridge-memory.mjs', 'scripts/bridge-skills.mjs']) assert.ok(readFileSync(join(REPO, file), 'utf8').includes('563a8746d4d1d4e0b6e0e59dfd80eb257728a47e'), file);
  assert.ok(readFileSync(join(REPO, 'scripts/scrub.mjs'), 'utf8').includes('VENDORED'));
});
