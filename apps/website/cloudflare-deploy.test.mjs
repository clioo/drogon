import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

test('Cloudflare publishes only the approved static assets on drogon.work', async () => {
  const config = JSON.parse(await readFile(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'drogon-work-landing');
  assert.equal(config.assets.directory, './dist');
  assert.deepEqual(config.routes, [{ pattern: 'drogon.work', custom_domain: true }]);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.main, undefined);
  await access(new URL('./dist/index.html', import.meta.url));
});
