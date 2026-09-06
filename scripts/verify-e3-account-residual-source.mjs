import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const sourceRoot = process.argv[2]
assert(sourceRoot, 'Usage: node scripts/verify-e3-account-residual-source.mjs SOURCE_ROOT')
const reportPath = 'docs/migration/audit-closure/e3-bridge/result-platform/account-residual-joins.json'
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const report = readJson(reportPath)
const pin = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const git = (args) => execFileSync('git', args, { cwd: sourceRoot, maxBuffer: 32 * 1024 * 1024 })
assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), pin)
assert.equal(report.sourceRevision, pin)
const files = new Map()
const ids = new Set()
for (const e of report.sourceEvidence) {
  assert(!path.isAbsolute(e.path) && !e.path.split('/').includes('..'), e.path)
  assert(!ids.has(e.id), e.id)
  ids.add(e.id)
  if (!files.has(e.path)) {
    const bytes = fs.readFileSync(path.join(sourceRoot, e.path))
    assert.equal(sha(bytes), sha(git(['show', `${pin}:${e.path}`])), `pin:${e.path}`)
    files.set(e.path, bytes)
  }
  const bytes = files.get(e.path)
  const lines = bytes.toString().match(/[^\n]*\n|[^\n]+$/g) ?? []
  assert.equal(sha(bytes), e.sha256, e.path)
  assert(Number.isInteger(e.start) && Number.isInteger(e.end))
  assert(e.start >= 1 && e.end >= e.start && e.end <= lines.length, e.id)
  assert.equal(sha(lines.slice(e.start - 1, e.end).join('')), e.rangeSha256, e.id)
}
const pointer = (ref) => {
  const [file, fragment] = ref.split('#')
  return (fragment ?? '').split('/').filter(Boolean).reduce((v, k) => {
    assert(v !== undefined, ref)
    return v[k.replace(/~1/g, '/').replace(/~0/g, '~')]
  }, readJson(file))
}
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])])) : value
const hashedPointers = [...report.reusedEvidence, ...report.testPreservation.wholePackages,
  ...report.testPreservation.inheritedRefs]
for (const e of hashedPointers) {
  const value = pointer(e.ref)
  assert(value !== undefined, e.ref)
  if (e.fileSha256) assert.equal(sha(fs.readFileSync(e.ref.split('#')[0])), e.fileSha256, e.ref)
  assert.equal(sha(JSON.stringify(canonical(value))), e.canonicalValueSha256, e.ref)
  if (e.count !== null && e.count !== undefined) assert.equal(value.length, e.count, e.ref)
  if (e.id) assert.equal(pointer(e.ref.replace(/\/files$/, '')).id, e.id)
}
for (const [id, e] of Object.entries(report.reuseCatalog)) {
  const value = pointer(e.ref)
  assert(value !== undefined, e.ref)
  if (id.startsWith('AL-C') || id === 'C-CODEX') assert.equal(value.id, id)
}
const parent = readJson('docs/migration/audit-closure/e3-bridge/result-platform/account-launch-final.json')
assert.deepEqual(report.contracts.map((c) => c.id), Array.from({ length: 9 }, (_, i) => `AR-C0${i + 1}`))
assert.equal(report.sourceResiduals.length, 0)
for (const r of report.reconciliation) {
  assert.deepEqual(r.inheritedVerbatim, parent.sourceResiduals.find((e) => e.id === r.id))
  assert.deepEqual(r.contracts, report.contracts.filter((c) => c.residual === r.id).map((c) => c.id))
}
for (const c of [...report.contracts, ...report.originalAssertionBodiesRead]) {
  for (const id of c.sourceEvidenceRefs) assert(ids.has(id), `${c.id}:${id}`)
}
const packages = readJson('docs/migration/parity-test-work-packages.json').packages
assert.equal(packages.length, 46)
assert.equal(packages.reduce((sum, p) => sum + p.files.length, 0), 9037)
console.log(JSON.stringify({ reportPath, reportSha256: sha(fs.readFileSync(reportPath)), pin,
  sourceRanges: report.sourceEvidence.length, pinnedFiles: files.size, contracts: report.contracts.length,
  hashedPointers: hashedPointers.length, reusedContracts: Object.keys(report.reuseCatalog).length,
  originalAssertionGroups: report.originalAssertionBodiesRead.length, additiveTestObligations: report.owedTests.length,
  packages: 46, allocatedFiles: 9037, testsRun: 0, semanticAcceptance: false, wholeAreaAccepted: false }, null, 2))
