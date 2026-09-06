import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const sourceRoot = process.argv[2]
assert(sourceRoot, 'Usage: node scripts/verify-e3-provider-runtime-source.mjs SOURCE_ROOT')
const reportPath = 'docs/migration/audit-closure/e3-bridge/result-platform/provider-runtime-joins.json'
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const report = json(reportPath)
const pin = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const git = (args) => execFileSync('git', args, { cwd: sourceRoot, maxBuffer: 32 * 1024 * 1024 })
assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), pin)
assert.equal(report.sourceRevision, pin)
let rangeCount = 0
const files = new Set()
for (const e of report.sourceEvidence) {
  assert(!path.isAbsolute(e.path) && !e.path.split('/').includes('..'))
  assert(!files.has(e.path), e.path)
  files.add(e.path)
  const bytes = fs.readFileSync(path.join(sourceRoot, e.path))
  assert.equal(sha(bytes), sha(git(['show', `${pin}:${e.path}`])), `pin:${e.path}`)
  assert.equal(sha(bytes), e.sha256, e.path)
  const lines = bytes.toString().match(/[^\n]*\n|[^\n]+$/g) ?? []
  if (e.bytes !== undefined) assert.equal(bytes.length, e.bytes)
  if (e.lines !== undefined) assert.equal(lines.length, e.lines)
  for (const r of e.ranges ?? [{ first: e.start, last: e.end, sha256: e.rangeSha256 }]) {
    assert(Number.isInteger(r.first) && Number.isInteger(r.last))
    assert(r.first >= 1 && r.last >= r.first && r.last <= lines.length)
    assert.equal(sha(lines.slice(r.first - 1, r.last).join('')), r.sha256, e.path)
    rangeCount++
  }
}
for (const e of report.inputs) assert.equal(sha(fs.readFileSync(e.path)), e.sha256, e.path)
const pointer = (ref) => {
  const [file, fragment] = ref.split('#')
  return (fragment ?? '').split('/').filter(Boolean).reduce((v, k) =>
    v[k.replace(/~1/g, '/').replace(/~0/g, '~')], json(file))
}
for (const e of report.acceptedReuse) {
  const target = pointer(e.ref)
  assert(target !== undefined, e.ref)
  if (e.contract) assert.deepEqual(target, e.contract, e.id)
}
const allocation = report.originalTestAllocation
for (const e of allocation.packages) {
  assert.equal(pointer(e.filesRef).length, e.fileCount)
  assert.equal(pointer(e.filesRef.replace(/\/files$/, '')).id, e.id)
}
assert.equal(pointer(allocation.wholeOriginalQueueRef).length, 33)
assert.equal(pointer(allocation.inheritedExecutionQueueRef).length, 70)
const parent = json('docs/migration/audit-closure/e3-bridge/result-platform/provider-inputs-final.json')
assert.deepEqual(report.inheritedGates, parent.inheritedGates)
assert.deepEqual(report.inheritedExecutionObligations, parent.inheritedExecutionObligations)
assert.equal(report.contracts.length, 8)
assert.equal(new Set(report.contracts.map((c) => c.id)).size, 8)
for (const c of report.contracts) {
  for (const f of c.sources) assert(files.has(f), `${c.id}:${f}`)
  for (const t of c.execution) assert(report.executionObligations.some((e) => e.id === t))
}
assert.equal(report.sourceResiduals.length, 0)
const packages = json('docs/migration/parity-test-work-packages.json').packages
assert.equal(packages.length, 46)
assert.equal(packages.reduce((s, p) => s + p.files.length, 0), 9037)
console.log(JSON.stringify({ reportPath, reportSha256: sha(fs.readFileSync(reportPath)), pin,
  pinnedFiles: files.size, ranges: rangeCount, inputHashes: report.inputs.length,
  contracts: 8, reusedPointers: report.acceptedReuse.length, gates: report.inheritedGates.length,
  allocationPointers: allocation.packages.length, packages: 46, fileAllocations: 9037,
  testsRun: 0, semanticAcceptance: false, wholeAreaAccepted: false }, null, 2))
