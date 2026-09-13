import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { scenarios, stages, initialState, verify, recover, approve, sessionPrompt } from './dist/story-model.mjs';
const root = new URL('./dist/', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
test('local assets and section links resolve; no image-based content', async () => {
  assert.doesNotMatch(html, /<img\b|\.(png|jpe?g|webp)\b/i);
  for (const [, value] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (value.startsWith('https:') || value === '#') continue;
    if (value.startsWith('#')) assert.ok(html.includes(`id="${value.slice(1)}"`), value);
    else await access(new URL(value, root));
  }
});
test('seven stages map to the six mandatory engineering capabilities', () => {
  assert.equal(stages.length, 7);
  assert.deepEqual(stages.slice(1).map(s => s.criterion), ['Intent + specification', 'Context engineering', 'Orchestration + parallel work', 'Harness + backpressure', 'Autonomous loops + recovery', 'Human as orchestrator']);
  assert.equal((html.match(/role="tab"/g) || []).length, 7);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
  for (const s of stages) assert.ok(html.includes(`id="scene-${s.id}"`));
});
test('signals route to defined projects and prompt only the selected session scope', () => {
  assert.equal(scenarios.ticket.project, 'Beacon API');
  assert.equal(scenarios.pr.project, 'Atlas Checkout');
  assert.match(sessionPrompt('ticket', 'tests'), /PROJECT Beacon API/);
  assert.match(sessionPrompt('ticket', 'tests'), /WRITE tests\/checkout-recovery.test.ts only/);
  assert.doesNotMatch(sessionPrompt('pr', 'implementation'), /@sentinel/);
  assert.throws(() => sessionPrompt('unknown', 'tests'));
});
test('concept adapters are explicitly distinguished from implemented PR path', () => {
  assert.equal(scenarios.pr.supported, true);
  for (const key of ['ticket', 'comment', 'mention']) assert.equal(scenarios[key].supported, false);
});
test('failed verification blocks approval; one correction closes the fixture loop', () => {
  const initial = initialState();
  assert.throws(() => approve(initial));
  const failed = verify(initial);
  assert.equal(failed.verified, false);
  assert.equal(failed.scopePassed, true);
  assert.throws(() => approve(failed));
  const corrected = recover(failed, 1);
  assert.equal(corrected.attempts, 2);
  assert.equal(corrected.verified, true);
  assert.equal(approve(corrected).approved, true);
});
test('exhausted budget escalates and incorrect project scope cannot pass', () => {
  const blocked = recover(verify(initialState()), 0);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.attempts, 3);
  assert.throws(() => approve(blocked));
  const wrong = verify({ ...initialState(), attempts: 2, project: 'Wrong Project' });
  assert.equal(wrong.verified, false);
  assert.equal(wrong.scopePassed, false);
  assert.deepEqual(recover(initialState(), 1), initialState());
});
test('source attribution and limits remain visible without compliance claims', () => {
  for (const text of ['not a stable release', 'not a substitute', 'MIT Copyright (c) 2026 Lovecast Inc.', 'not a live connection', 'no connected agents']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /100% compliant/);
});
