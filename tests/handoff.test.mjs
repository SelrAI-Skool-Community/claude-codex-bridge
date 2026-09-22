import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { B, fixtureHome } from './helpers.mjs';
import { createHandoff, listHandoffs, renderHandoff, HANDOFF_FIELDS } from '../scripts/bridge-handoff.mjs';

const input = { name: 'invoice-tool', project: 'invoice-tool', purpose: 'Ship the invoice exporter.', currentState: 'Exporter writes CSV; PDF pending.', completedWork: ['CSV export', 'Unit tests for totals'], decisions: ['Use ISO dates'], openWork: ['PDF export'], blockers: 'Waiting on the logo asset.', relevantPaths: ['src/export.mjs', 'tests/export.test.mjs'], verificationRun: 'npm test passes (12 tests).' };

test('a handoff has the full schema, source attribution and deterministic output', () => {
  const a = renderHandoff({ input, provider: 'claude', kitVersion: 'v', createdAt: '2026-09-22T00:00:00.000Z' });
  const b = renderHandoff({ input, provider: 'claude', kitVersion: 'v', createdAt: '2026-09-22T00:00:00.000Z' });
  assert.equal(a.body, b.body);
  for (const [, title] of HANDOFF_FIELDS) assert.ok(a.body.includes(`## ${title}`), title);
  assert.ok(a.body.includes('- Provider: claude') && a.body.includes('- Created: 2026-09-22T00:00:00.000Z') && a.body.includes('- Project: invoice-tool'));
  assert.ok(a.body.includes('not chat history'));
  assert.throws(() => renderHandoff({ input: { ...input, openWork: [] }, provider: 'claude', kitVersion: 'v', createdAt: 'now' }), /missing: openWork/);
  assert.throws(() => renderHandoff({ input: { ...input, name: 'Bad Name' }, provider: 'codex', kitVersion: 'v', createdAt: 'now' }), /short lower-case name/);
  assert.throws(() => renderHandoff({ input, provider: 'gemini', kitVersion: 'v', createdAt: 'now' }), /claude or codex/);
});

test('secrets block the save, portability warns, native transcript stores stay untouched, and the other provider can read it', () => {
  const fx = fixtureHome('handoff');
  try {
    fx.seed('claude', { instructions: 'Hi.\n', files: { 'projects/p/session.jsonl': '{"a":1}\n', 'history.jsonl': '{}\n' } });
    fx.seed('codex', { instructions: 'Hi.\n', files: { 'sessions/s.jsonl': '{"b":2}\n' } });
    assert.throws(() => createHandoff({ home: fx.home, input, provider: 'claude' }), /not installed/);
    B.bridge(fx);
    const leaky = createHandoff({ home: fx.home, input: { ...input, blockers: 'Set STRIPE_KEY = "sk_live_ABCDEFGHIJKLMNOP1234" first.' }, provider: 'claude', createdAt: 'now' });
    assert.equal(leaky.saved, false); assert.equal(leaky.blocked, true); assert.ok(leaky.hits.length);
    assert.ok(!JSON.stringify(leaky).includes('sk_live_ABCDEFGHIJKLMNOP1234'), 'the secret never leaves the scrubber');
    assert.equal(existsSync(fx.corePath('handoffs/invoice-tool.md')), false);
    const warned = createHandoff({ home: fx.home, input: { ...input, relevantPaths: ['/Users/marlo/projects/invoice-tool/src/export.mjs'] }, provider: 'claude', createdAt: '2026-09-22T00:00:00.000Z' });
    assert.equal(warned.saved, true); assert.equal(warned.warnings[0].ruleId, 'unix-user-path');
    assert.match(warned.summary, /portability note/);
    const body = readFileSync(warned.path, 'utf8');
    assert.ok(body.includes('- Provider: claude'));
    assert.equal(fx.manifest().core.handoffs['invoice-tool'].provider, 'claude');
    assert.equal(fx.readText(join(fx.config('claude'), 'projects/p/session.jsonl')), '{"a":1}\n');
    assert.equal(fx.readText(join(fx.config('codex'), 'sessions/s.jsonl')), '{"b":2}\n');
    assert.equal(fx.readText(join(fx.config('claude'), 'history.jsonl')), '{}\n');
    const list = listHandoffs({ home: fx.home });
    assert.deepEqual(list.map(h => [h.name, h.provider, h.edited]), [['invoice-tool', 'claude', false]]);
    writeFileSync(warned.path, body + '\nHand edit.\n');
    assert.equal(listHandoffs({ home: fx.home })[0].edited, true);
    const clash = createHandoff({ home: fx.home, input, provider: 'codex', createdAt: 'now' });
    assert.equal(clash.saved, false); assert.match(clash.summary, /edited by hand/);
    assert.ok(fx.readText(fx.instructions('codex')).includes('knowledge-contract.md'), 'Codex is pointed at the contract that tells it to read handoffs');
    assert.ok(B.inspect(fx).core.handoffs.includes('invoice-tool.md'));
    B.remove(fx, 'claude');
    assert.ok(existsSync(warned.path), 'handoffs survive provider removal');
  } finally { fx.cleanup(); }
});
