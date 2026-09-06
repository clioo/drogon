import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const sourceRoot = process.argv[2]
assert(sourceRoot, 'Usage: node scripts/verify-e3-integrations-source.mjs SOURCE_ROOT')
const reportPath = 'docs/migration/audit-closure/e3-bridge/result-integrations/contracts.json'
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const report = readJson(reportPath)
const partition = readJson('docs/migration/e3-result-audit-partition.json')
const parent = readJson(partition.input.path)
const receiver = readJson('docs/migration/audit-closure/e3-bridge/followup-final-boundaries.json')
const pin = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const git = (args) => execFileSync('git', args, { cwd: sourceRoot, maxBuffer: 32 * 1024 * 1024 })
assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), pin)
assert.equal(report.sourceRevision, pin)
assert.equal(partition.sourceRevision, pin)
assert.equal(sha(fs.readFileSync(partition.input.path)), partition.input.sha256)
const assignment = partition.assignments.find((a) => a.id === 'integrations')
assert.deepEqual(report.assignment, assignment)
const expected = assignment.contracts.flatMap((c) => c.methods.map((method) => `${c.id}::${method}`))
assert.equal(expected.length, 264)
assert.equal(new Set(expected).size, 264)
assert.deepEqual(report.methods.map((m) => m.id).sort(), [...expected].sort())
const sourceFiles = new Map()
function source(file) {
  assert(!path.isAbsolute(file) && !file.split('/').includes('..'), file)
  if (!sourceFiles.has(file)) {
    const bytes = fs.readFileSync(path.join(sourceRoot, file))
    assert.equal(sha(git(['show', `${pin}:${file}`])), sha(bytes), `pin:${file}`)
    sourceFiles.set(file, { bytes, lines: bytes.toString().match(/[^\n]*\n|[^\n]+$/g) ?? [] })
  }
  return sourceFiles.get(file)
}
function rangeCheck(e) {
  const { bytes, lines } = source(e.path)
  assert.equal(sha(bytes), e.fileSha256, e.path)
  assert(Number.isInteger(e.start) && Number.isInteger(e.end))
  assert(e.start >= 1 && e.end >= e.start && e.end <= lines.length, `${e.path}:${e.start}-${e.end}`)
  assert.equal(sha(lines.slice(e.start - 1, e.end).join('')), e.sha256, e.path)
}
const ranges = Object.values(report.sourceEvidence)
for (const e of ranges) rangeCheck(e)
const docs = new Map()
function pointer(ref) {
  const [file, fragment] = ref.split('#')
  if (!docs.has(file)) docs.set(file, readJson(file))
  return (fragment ?? '').split('/').filter(Boolean).reduce((v, k) => v[k.replace(/~1/g, '/').replace(/~0/g, '~')], docs.get(file))
}
for (const e of report.reusedEvidenceReviewed) assert.deepEqual(pointer(e.ref), e.contract, e.ref)
for (const e of report.inheritedContracts) {
  const { receiverRefs, ...inherited } = parent.rpcOwnershipContracts.find((c) => c.id === e.id)
  assert.deepEqual(e, inherited, e.id)
  assert.deepEqual(receiverRefs.map((ref) => pointer(ref).name).sort(), [...e.methods].sort())
  for (const c of e.owningContracts) assert.equal(pointer(c.ref).id, c.id)
}
for (const snapshot of Object.values(report.reviewedConcurrentReuseSnapshots)) {
  assert.equal(sha(fs.readFileSync(snapshot.documentPath)), snapshot.documentSha256)
  for (const e of snapshot.entries) assert.deepEqual(pointer(snapshot.documentPath + e.pointer), e.body)
}
let leafRanges = 0
const correctedRangeHashes = []
const allocationRefs = new Set()
for (const method of report.methods) {
  assert.equal(method.id, `${method.groupId}::${method.method}`)
  assert.equal(method.execution, 'not-run')
  assert(method.resultContract.length > 0)
  const row = receiver.rpcRows[method.rpcBoundary.index]
  assert.equal(row.name, method.method)
  assert.deepEqual(method.rpcBoundary.definition, row.definition)
  for (const key of ['file', 'line', 'endLine']) assert.equal(method.rpcBoundary.handler[key], row.handler[key])
  for (const e of method.leafSourceEvidence) {
    if (e.sha256 === null) {
      const correction = report.leafAnchorCorrections.find((c) => c.method === method.method && c.path === e.path)
      assert(correction, `${method.method}: unexpected null range hash`)
      assert.deepEqual([e.start, e.end], correction.corrected)
      const ledger = ranges.find((r) => r.path === e.path && r.start === e.start && r.end === e.end)
      assert(ledger, e.path)
      rangeCheck({ ...e, sha256: ledger.sha256 })
      correctedRangeHashes.push({ method: method.method, path: e.path, start: e.start, end: e.end, sha256: ledger.sha256 })
    } else rangeCheck(e)
    leafRanges++
  }
  for (const allocation of method.originalSourceTestAllocation) {
    const entries = pointer(allocation.ref)
    assert(Array.isArray(entries) && entries.length > 0)
    assert.equal(pointer(allocation.ref.replace(/\/files$/, '')).id, allocation.id)
    allocationRefs.add(allocation.ref)
  }
  for (const gate of ['F-RPC-SCHEMA', 'F-RPC-ROUTE', 'F-RPC-HOST', 'F-RPC-RESULT', 'F-EXTERNAL']) {
    assert(method.remainingExecutionTests.includes(gate), `${method.method}:${gate}`)
  }
}
const leaf = readJson('docs/migration/audit-closure/e3-bridge/result-integrations/leaf/contracts.json')
assert.equal(leaf.methods.length, 95)
let correctedAnchors = 0
for (const method of leaf.methods) {
  const reviewed = report.methods.find((m) => m.method === method.method)
  assert(reviewed, method.method)
  assert.equal(reviewed.leafSourceEvidence.length, method.sourceEvidence.length)
  for (const [i, original] of method.sourceEvidence.entries()) {
    const correction = report.leafAnchorCorrections.find((c) => c.method === method.method && c.path === original.path)
    const e = { ...original }
    if (correction) {
      assert.deepEqual([e.start, e.end], correction.original)
      e.originalLeafRange = { start: e.start, end: e.end, sha256: e.sha256 }
      ;[e.start, e.end] = correction.corrected
      e.sha256 = null
      correctedAnchors++
    }
    assert.deepEqual(reviewed.leafSourceEvidence[i], e)
  }
}
assert.equal(correctedAnchors, 2)
const packages = readJson('docs/migration/parity-test-work-packages.json').packages
assert.equal(packages.length, 46)
assert.equal(packages.reduce((sum, p) => sum + p.files.length, 0), 9037)
console.log(JSON.stringify({ reportPath, reportSha256: sha(fs.readFileSync(reportPath)), pin,
  assignedGroups: 10, methods: 264, sourceRanges: ranges.length, pinnedFiles: sourceFiles.size,
  leafMethods: 95, leafRanges, correctedAnchors, correctedRangeHashes, reusedContracts: report.reusedEvidenceReviewed.length,
  inheritedContracts: 10, concurrentSnapshots: Object.keys(report.reviewedConcurrentReuseSnapshots).length,
  allocationRefs: allocationRefs.size, packages: 46, allocatedFiles: 9037,
  testsRun: 0, semanticAcceptance: false, sourceComplete: false }, null, 2))
