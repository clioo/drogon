import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (name) => JSON.parse(readFileSync(new URL(`../docs/migration/${name}.json`, import.meta.url)))
const review = read('parity-mobile-method-review')
const census = read('parity-wire-call-sites')
const leaf = read('parity-mobile-method-flow')
const wire = read('parity-relay-mobile-wire-contracts').g14_mobileOutgoingSurface
const sortedUnique = (names) => [...new Set(names)].sort()
const prior = sortedUnique([
  ...wire.methodsListed,
  ...wire.coordinatorConditionalResolutions.flatMap((row) => row.possibleNames)
])

test('attributes each of the 31 remaining mobile syntax sites exactly once', () => {
  const expected = census.calls.filter((row) => row.file.startsWith('mobile/') && row.literal === null && row.argumentType !== 'ConditionalExpression')
  const actual = review.candidates.flatMap((row) => (row.lines ?? [row.line]).map((line) => ({ ...row, line })))
  const key = (row) => `${row.file}:${row.line}`
  assert.equal(expected.length, 31)
  assert.equal(actual.length, 31)
  assert.equal(new Set(actual.map(key)).size, 31)
  assert.deepEqual(actual.map(key).sort(), expected.map(key).sort())
  assert.equal(actual.filter((row) => row.disposition === 'rpc-wrapper-traced').length, 19)
  assert.equal(actual.filter((row) => row.disposition === 'transport-forwarding').length, 8)
  assert.equal(actual.filter((row) => row.disposition === 'non-rpc-subscribe-lookalike').length, 4)
})

test('computes the distinct-name delta against actual prior names, not already-known prose', () => {
  const resolved = sortedUnique(review.candidates.flatMap((row) => row.resolvedMethods))
  const added = resolved.filter((method) => !prior.includes(method))
  assert.equal(prior.length, 163)
  assert.equal(resolved.length, 72)
  assert.deepEqual(added, review.newNames)
  assert.equal(added.length, 45)
  const memberNames = sortedUnique([...prior, ...added])
  assert.equal(memberNames.length, review.counts.memberCallFlowLowerBound)
  const combined = sortedUnique([...memberNames, ...review.separateBareCalls.map((row) => row.method)])
  assert.equal(combined.length, 209)
  assert.equal(combined.length, review.counts.combinedKnownLowerBound)
  assert.equal(combined.length, wire.namedSurfaceLowerBound)
})

test('preserves the leaf additions and records the omitted Git and agent methods', () => {
  const reported = sortedUnique(leaf.candidates.flatMap((row) => row.newNames))
  assert.equal(reported.length, 25)
  assert(reported.every((method) => review.newNames.includes(method)))
  const missed = review.newNames.filter((method) => !reported.includes(method))
  assert.equal(missed.length, review.counts.additionalNamesMissedByLeaf)
  assert.equal(missed.filter((method) => method.startsWith('git.')).length, 13)
  assert.equal(missed.filter((method) => method.startsWith('agentSession.')).length, 7)
  assert(review.candidates.find((row) => row.id === 18).resolvedMethods.includes('git.fastForward'))
  assert(review.candidates.find((row) => row.id === 11).resolvedMethods.includes('agentSession.respondToApproval'))
})

test('keeps fingerprints, partial read intervals and source revision explicit', () => {
  assert.equal(review.sourceRevision, census.sourceRevision)
  assert.equal(review.sourceRevision, leaf.sourceRevision)
  assert.equal(review.coordinatorReads.length, 40)
  assert.equal(new Set(review.coordinatorReads.map((row) => row.file)).size, 40)
  for (const row of review.coordinatorReads) {
    assert.match(row.sha256, /^[a-f0-9]{64}$/)
    const source = census.files.find((entry) => entry.file === row.file)
    assert(source)
    assert.equal(row.sha256, source.sha256)
    if (row.tier === 'partial-body') {
      assert(row.intervals.length > 0)
      for (const [start, end] of row.intervals) assert(start > 0 && start <= end && end <= row.lineCount)
    } else assert.equal(row.tier, 'full-body')
  }
})

test('does not turn callback handles or payload fingerprint labels into RPC names', () => {
  for (const row of review.candidates) {
    assert(row.sourcePointers.length > 0)
    if (row.disposition !== 'rpc-wrapper-traced') assert.deepEqual(row.resolvedMethods, [])
    for (const method of row.resolvedMethods) assert(!method.includes(':'))
  }
  assert.equal(review.runtimeAcceptance, 'unproven')
  assert.equal(review.separateBareCalls[0].method, 'runtime.clientCapabilities.update')
})
