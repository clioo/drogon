import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { checkWorkPackages } from './check-parity-work-packages.mjs'

function fixture() {
  const file = { path: 'src/a.test.ts', sha256: 'a'.repeat(64), domain: 'unit' }
  const inventory = Buffer.from(JSON.stringify({ source: { gitHead: 'b'.repeat(40) }, files: [file] }))
  const proposal = {
    status: 'proposal', dispatchable: false,
    source: { gitHead: 'b'.repeat(40), manifestSha256: createHash('sha256').update(inventory).digest('hex'), manifestEntries: 1, manifestUniquePaths: 1 },
    packages: [{ id: 'WP-A', fileCount: 1, testPortBoundary: 'tests/parity/ports/WP-A/**', files: [{ ...file }], dependencies: [] }]
  }
  return { inventory, proposal }
}

test('accepts an exact allocation without claiming coverage', () => {
  const { inventory, proposal } = fixture()
  const result = checkWorkPackages(inventory, proposal)
  assert.equal(result.ok, true)
  assert.match(result.scope, /not capability coverage/)
  assert.equal(result.maxDependencyDepthEdges, 0)
})

for (const [label, change, expected] of [
  ['stale source digest', p => { p.source.manifestSha256 = 'c'.repeat(64) }, /digest mismatch/],
  ['weakened hash', p => { p.packages[0].files[0].sha256 = 'c'.repeat(64) }, /hash mismatch/],
  ['missing file', p => { p.packages[0].files = []; p.packages[0].fileCount = 0 }, /unassigned/],
  ['duplicate file', p => { p.packages[0].files.push(p.packages[0].files[0]); p.packages[0].fileCount = 2 }, /duplicate assignment/],
  ['unknown dependency', p => { p.packages[0].dependencies = ['WP-ABSENT'] }, /unknown dependency/],
  ['cyclic dependency', p => { p.packages[0].dependencies = ['WP-A'] }, /cyclic dependency/],
  ['overlapping write root', p => { p.packages[0].testPortBoundary = 'tests/parity/**' }, /non-exclusive/],
  ['premature dispatch authorization', p => { p.dispatchable = true }, /not a dispatch authorization/],
  ['unresolved integration member', p => { p.integrationGroups = [{ id: 'INT-A', members: ['WP-B'], acceptance: 'joint proof' }] }, /unknown integration/]
]) {
  test(`rejects ${label}`, () => {
    const { inventory, proposal } = fixture()
    change(proposal)
    const result = checkWorkPackages(inventory, proposal)
    assert.equal(result.ok, false)
    assert.match(result.errors.join('\n'), expected)
  })
}

test('requires both provenance roles without assigning the physical file twice', () => {
  const { inventory, proposal } = fixture()
  const parsed = JSON.parse(inventory)
  parsed.files.push({ ...parsed.files[0], domain: 'support' })
  const bytes = Buffer.from(JSON.stringify(parsed))
  proposal.source.manifestSha256 = createHash('sha256').update(bytes).digest('hex')
  proposal.source.manifestEntries = 2
  assert.equal(checkWorkPackages(bytes, proposal).ok, false)
  proposal.packages[0].files[0].bothRoles = ['unit (source role)', 'support']
  const result = checkWorkPackages(bytes, proposal)
  assert.equal(result.ok, true)
  assert.equal(result.uniqueSourcePaths, 1)
  assert.equal(result.sourceRecords, 2)
})

test('measures a shared-prerequisite DAG and rejects reciprocal dependencies', () => {
  const { inventory, proposal } = fixture()
  for (const id of ['WP-B', 'WP-C']) {
    proposal.packages.push({ id, files: [], fileCount: 0, testPortBoundary: `tests/parity/ports/${id}/**`, dependencies: ['WP-A'] })
  }
  assert.equal(checkWorkPackages(inventory, proposal).maxDependencyDepthEdges, 1)
  proposal.packages[0].dependencies = ['WP-B']
  assert.match(checkWorkPackages(inventory, proposal).errors.join('\n'), /cyclic dependency/)
})
