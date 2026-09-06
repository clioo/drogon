import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanWireCalls } from './inventory-wire-call-sites.mjs'

test('includes generic, optional, double-quote, digit and constant-template forms', () => {
  const rows = scanWireCalls('client.sendRequest<Result>("api.v2"); client?.subscribe?.(`api.events`,{}); client["sendRequest"]("api.one")', 'fixture.ts')
  assert.deepEqual(rows.map(r => r.literal), ['api.v2', 'api.events', 'api.one'])
  assert.deepEqual(rows.map(r => r.member), ['sendRequest', 'subscribe', 'sendRequest'])
})

test('keeps dynamic arguments unresolved rather than inventing method names', () => {
  const rows = scanWireCalls('dispatcher.onRequest(METHOD, fn); client.subscribe(`api.${suffix}`,{}); client.sendRequest()', 'fixture.ts')
  assert(rows.every(r => r.literal === null))
  assert.deepEqual(rows.map(r => r.argumentType), ['Identifier', 'TemplateLiteral', 'absent'])
  assert.equal(rows[0].unresolvedArgument, 'METHOD')
})

test('records exact callsites and nested JSX callbacks but not comments or strings', () => {
  const rows = scanWireCalls('// x.sendRequest("fake")\nconst text="client.subscribe(hi)";\nconst el=<X run={() => client.sendRequest(\n "real")}/>;', 'fixture.tsx')
  assert.equal(rows.length, 1); assert.equal(rows[0].line, 3)
  assert.equal(rows[0].receiver, 'client'); assert.equal(rows[0].literal, 'real')
})

test('bounds callee support honestly and does not confuse property declarations with calls', () => {
  const rows = scanWireCalls('sendRequest("alias"); client[method]("dynamic"); const x={sendRequest:"not call"}; other.subscribe("candidate")', 'fixture.ts')
  assert.equal(rows.length, 1); assert.equal(rows[0].receiver, 'other')
})

test('rejects parse failures instead of publishing a partial census', () => {
  assert.throws(() => scanWireCalls('client.sendRequest(', 'broken.ts'))
})
