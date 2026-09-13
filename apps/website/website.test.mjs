import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { workflowSteps, monitorEvent, worktrees } from './dist/demo-model.mjs';
const root = new URL('./dist/', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
test('all local assets and section links resolve', async () => {
  for (const [, value] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (value.startsWith('https:') || value === '#') continue;
    if (value.startsWith('#')) assert.ok(html.includes(`id="${value.slice(1)}"`), value);
    else await access(fileURLToPath(new URL(value, root)));
  }
});
test('every tab controls its named panel and only one starts selected', () => {
  const tabs = [...html.matchAll(/<button role="tab" id="([^"]+)" aria-controls="([^"]+)" aria-selected="([^"]+)"/g)];
  assert.equal(tabs.length, 3);
  assert.equal(tabs.filter(t => t[3] === 'true').length, 1);
  for (const [, id, panel] of tabs) assert.ok(html.includes(`id="${panel}" role="tabpanel" aria-labelledby="${id}"`));
});
test('release status, simulation caveat, and attribution remain visible', () => {
  for (const text of ['not a stable release', 'Sample runs are simulated', 'MIT Copyright (c) 2026 Lovecast Inc.', 'THIRD_PARTY_NOTICES.md', '© 2017 HBO', 'Geist']) {
    assert.ok(text === 'Geist' ? html.includes('geist.woff2') : html.includes(text), text);
  }
});
test('failure recovers only within the configured iteration bound', () => {
  const recovery = workflowSteps({ failure: true, limit: 2 });
  assert.equal(recovery.at(-1).terminal, 'review');
  assert.deepEqual(recovery.filter(s => ['FAIL', 'RECOVER', 'VERIFY'].includes(s.kind)).map(s => s.kind), ['FAIL', 'RECOVER', 'VERIFY']);
  const blocked = workflowSteps({ failure: true, limit: 1 });
  assert.equal(blocked.at(-1).terminal, 'blocked');
  assert.equal(blocked.some(s => s.kind === 'RECOVER'), false);
  assert.equal(workflowSteps({ failure: false, limit: 1 }).at(-1).terminal, 'review');
  assert.throws(() => workflowSteps({ limit: 0 }));
});
test('monitor approval and deduplication gate sample work', () => {
  assert.equal(monitorEvent({ approved: false, handled: false }).work, false);
  assert.equal(monitorEvent({ approved: true, handled: false }).state, 'Review queued');
  assert.equal(monitorEvent({ approved: true, handled: true }).state, 'Already handled');
  assert.equal(monitorEvent({ approved: false, handled: true }).handled, true);
});
test('sample worktrees have distinct branches, changes and harnesses', () => {
  assert.equal(new Set(Object.values(worktrees).map(t => t.branch)).size, 3);
  assert.equal(new Set(Object.values(worktrees).map(t => t.file)).size, 3);
  assert.equal(new Set(Object.values(worktrees).map(t => t.harness)).size, 3);
  assert.ok(Object.values(worktrees).every(t => t.lines.length > 0));
});
test('product panels contain functional controls, not screenshots', () => {
  assert.ok(!/assets\/(workspace|orchestrator|bots)\.webp/.test(html));
  for (const id of ['run-demo', 'reset-demo', 'approve-demo', 'simulate-event', 'approve-monitor']) assert.ok(html.includes(`id="${id}"`));
});
