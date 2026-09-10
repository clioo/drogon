import assert from 'node:assert/strict';
import test from 'node:test';
import { startSealedModelFixture, isOwnedFixtureHealth, FIXTURE_IDENTITY } from './sealed-model-fixture.mjs';
import { waitForFixtureReady, seedLocalPiProvider } from './probe-sealed-journeys.mjs';
import { startAndSeedModelFixture } from './sealed-model-fixture-lifecycle.mjs';

test('health cannot establish ownership without an exact instance', () => {
  assert.equal(isOwnedFixtureHealth({ fixture: FIXTURE_IDENTITY, instanceId: 'foreign' }), false);
});

test('expired readiness budget performs no request; exact owner is required', async () => {
  const fixture = await startSealedModelFixture();
  try {
    assert.equal(await waitForFixtureReady(0, fixture.baseUrl, fixture.instanceId), false);
    assert.equal(fixture.receipt().totalRequests, 0);
    assert.equal(await waitForFixtureReady(50, fixture.baseUrl, 'foreign'), false);
    assert.equal(await waitForFixtureReady(1000, fixture.baseUrl, fixture.instanceId), true);
  } finally { await fixture.close(); }
});

test('launcher passes owned instance to seed callback', async () => {
  let identity;
  const fixture = await startAndSeedModelFixture((_url, instanceId) => { identity = instanceId; });
  try { assert.equal(identity, fixture.instanceId); } finally { await fixture.close(); }
});

test('seed failure preserves cleanup failure too', async () => {
  await assert.rejects(startAndSeedModelFixture(() => { throw new Error('seed failed'); }, {
    startFixture: async () => ({ baseUrl: 'http://127.0.0.1:1/v1', instanceId: 'test',
      close: async () => ({ verdict: 'unverifiable', outstandingSockets: 1, outstandingStreams: 0 }),
      receipt: () => ({ totalRequests: 0, rejected: 0 }) }),
  }), error => error instanceof AggregateError && error.errors.some(e => e.message === 'seed failed'));
});

test('close reports final resources, stops admission and is idempotent', async () => {
  const fixture = await startSealedModelFixture({ streamIntervalMs: 1000 });
  const response = await fetch(`${fixture.baseUrl}/chat/completions`, { method: 'POST',
    body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'Count from 1 to 200 separated by commas. Reply with only the numbers.' }] }) });
  const reader = response.body.getReader();
  await reader.read();
  const result = await fixture.close();
  await reader.cancel().catch(() => {});
  assert.equal(result.verdict, 'stopped');
  assert.equal(result.outstandingStreams, 0);
  assert.equal(result.outstandingSockets, 0);
  assert.deepEqual(await fixture.close(), result);
  await assert.rejects(fetch(`${fixture.baseUrl}/__fixture__/health`));
});

test('seed refuses userinfo, non-HTTP and noncanonical paths before filesystem writes', async () => {
  for (const url of ['http://user:pass@127.0.0.1:1/v1', 'https://127.0.0.1:1/v1', 'http://127.0.0.1:1/other']) {
    await assert.rejects(seedLocalPiProvider('.preflight/invalid-model-seed-test', url, 'owned'), /baseUrl/);
  }
});
