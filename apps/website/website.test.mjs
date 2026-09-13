import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
test('release status, fixture caveat, and source attribution remain visible', () => {
  for (const text of ['not a stable release', 'fixture runtimes', 'MIT Copyright (c) 2026 Lovecast Inc.', 'THIRD_PARTY_NOTICES.md', 'Geist']) {
    assert.ok(text === 'Geist' ? html.includes('geist.woff2') : html.includes(text), text);
  }
});
