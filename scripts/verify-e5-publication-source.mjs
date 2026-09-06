import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const sourceRoot = process.argv[2]
assert(sourceRoot, 'Usage: node scripts/verify-e5-publication-source.mjs SOURCE_ROOT')
const reportPath = 'docs/migration/audit-closure/e5-platform/publication-boundaries-final.json'
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const physicalLines = (bytes) => bytes.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) ?? []
const pin = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
assert.equal(report.sourceRevision, pin)
const git = (args) => execFileSync('git', args, { cwd: sourceRoot, maxBuffer: 32 * 1024 * 1024 })
assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), pin)
const pinned = new Set()
const localDeclarations = new Set()
function sourceBytes(file) {
  assert(!path.isAbsolute(file) && !file.split('/').includes('..'), file)
  const bytes = fs.readFileSync(path.join(sourceRoot, file))
  if (file.startsWith('node_modules/')) localDeclarations.add(file)
  else if (!pinned.has(file)) {
    assert.equal(sha(git(['show', `${pin}:${file}`])), sha(bytes), `source pin: ${file}`)
    pinned.add(file)
  }
  return bytes
}
let ranges = 0
assert.equal(report.sourceEvidence.length, 66)
const evidenceIds = new Set(report.sourceEvidence.map((e) => e.id))
assert.equal(evidenceIds.size, 66)
for (const entry of report.sourceEvidence) {
  const bytes = sourceBytes(entry.path)
  assert.equal(sha(bytes), entry.sha256, entry.path)
  assert.equal(bytes.length, entry.bytes, entry.path)
  const lines = physicalLines(bytes)
  assert.equal(lines.length, entry.lineCount, entry.path)
  for (const range of entry.ranges) {
    assert(Number.isInteger(range.start) && Number.isInteger(range.end))
    assert(range.start >= 1 && range.end >= range.start && range.end <= lines.length)
    const selected = Buffer.from(lines.slice(range.start - 1, range.end).join(''))
    assert.equal(sha(selected), range.sha256, `${entry.id}:${range.start}-${range.end}`)
    assert.equal(selected.length, range.bytes)
    ranges++
  }
}
for (const doc of report.documents) {
  const bytes = fs.readFileSync(doc.path)
  assert.equal(sha(bytes), doc.sha256, doc.path)
  assert.equal(bytes.length, doc.bytes)
  assert.equal(physicalLines(bytes).length, doc.lineCount)
}
const parent = JSON.parse(fs.readFileSync(report.manifest.sourceDocument, 'utf8'))
for (const contract of report.acceptedClientContracts.contracts) {
  assert.deepEqual(contract, parent.contracts.find((c) => c.id === contract.id), contract.id)
}
assert.equal(parent.assetManifest.length, 135)
assert.equal(report.manifest.entries.length, 135)
const familyCounts = {}
for (const [index, entry] of report.manifest.entries.entries()) {
  assert.equal(entry.manifestIndex, index)
  for (const key of ['path', 'bytes', 'sha256', 'contractId']) {
    assert.equal(entry[key], parent.assetManifest[index][key], `${index}:${key}`)
  }
  const bytes = sourceBytes(entry.path)
  assert.equal(sha(bytes), entry.sha256, entry.path)
  assert.equal(bytes.length, entry.bytes)
  assert.equal(entry.publicationRightsApproved, false)
  for (const id of entry.sourceEvidenceIds) assert(evidenceIds.has(id), id)
  familyCounts[entry.contractId] = (familyCounts[entry.contractId] ?? 0) + 1
}
assert.deepEqual(familyCounts, {
  'ASSET-08': 38, 'ASSET-02': 4, 'ASSET-03': 24, 'ASSET-04': 40,
  'ASSET-07': 9, 'ASSET-06': 17, 'ASSET-05': 3
})
const parents = [...new Set(report.manifest.entries.map((e) => path.posix.dirname(e.path)))].sort()
assert.deepEqual(report.adjacentNotices.checks.map((e) => e.directory).sort(), parents)
const noticeName = /^(readme|licen[cs]e|copying|copyright|notice|credits|attribution)([._-]|$)|-OFL/i
for (const check of report.adjacentNotices.checks) {
  const names = fs.readdirSync(path.join(sourceRoot, check.directory)).filter((name) => noticeName.test(name)).sort()
  assert.deepEqual(names, [...check.matchedNoticeNames].sort(), check.directory)
}
assert.equal(localDeclarations.size, 5)
for (const file of report.backendSourceBoundary.exactAbsentPaths) {
  assert(!fs.existsSync(path.join(sourceRoot, file)), `claimed absent: ${file}`)
  assert.equal(git(['ls-tree', pin, '--', file]).length, 0, `present at pin: ${file}`)
}
assert.equal(report.recordings.tiles.length, 12)
for (const [index, tile] of report.recordings.tiles.entries()) {
  assert.equal(tile.id, `tile-${String(index + 1).padStart(2, '0')}`)
  const bytes = sourceBytes(tile.metadataPath)
  assert.equal(sha(bytes), tile.metadataSha256)
  const meta = JSON.parse(bytes)
  assert.equal(meta.sourceGif, tile.sourceGif)
  assert.equal(meta.sourcePoster, tile.sourcePoster)
  assert.equal(tile.rightsApproved, false)
}
for (const [original, copied] of [
  ['docs/assets/feature-wall/parallel-worktrees.gif', 'resources/onboarding/feature-wall/tile-01.gif'],
  ['docs/assets/feature-wall/parallel-worktrees.jpg', 'resources/onboarding/feature-wall/tile-01.poster.jpg'],
  ['docs/site/src/assets/fonts/Geist-Variable.woff2', 'src/renderer/src/assets/fonts/Geist-Variable.woff2']
]) assert.equal(sha(sourceBytes(original)), sha(sourceBytes(copied)))
const packages = JSON.parse(fs.readFileSync('docs/migration/parity-test-work-packages.json', 'utf8')).packages
assert.equal(packages.length, 46)
assert.equal(packages.reduce((sum, p) => sum + p.files.length, 0), 9037)
assert.equal(report.retainedAllocation.packagePointers.length, 46)
for (const [index, entry] of report.retainedAllocation.packagePointers.entries()) {
  assert.equal(entry.pointer, `/packages/${index}/files`)
  assert.equal(entry.id, packages[index].id)
  assert.equal(entry.fileCount, packages[index].files.length)
}
assert.equal(report.originalAssertions.associations.length, 14)
for (const entry of report.originalAssertions.associations) {
  assert.equal(sha(sourceBytes(entry.path)), entry.sha256, entry.path)
  const original = parent.testAssociations.find((a) => a.path === entry.path)
  assert(original, entry.path)
  for (const key of ['sha256', 'bodyRead', 'assertionSummary', 'allocatedPackage']) assert.deepEqual(entry[key], original[key])
}
assert.equal(report.independentServiceProposal.interfaces.length, 6)
for (const proposal of report.independentServiceProposal.interfaces) assert.equal(proposal.proposalOnly, true)
assert.equal(report.acceptanceCases.reduce((sum, group) => sum + group.cases.length, 0), 26)
for (const key of ['fullE5Closure', 'rootAcceptance', 'implementationParity', 'publicationApproved']) assert.equal(report[key], false)
console.log(JSON.stringify({ reportPath, reportSha256: sha(fs.readFileSync(reportPath)), pin,
  pinnedFiles: pinned.size, localDeclarations: [...localDeclarations], sourceRecords: 66, ranges,
  documents: report.documents.length, manifestEntries: 135, familyCounts, recordingRoles: 12,
  originalAssertionAssociations: 14, packages: 46, originalAllocatedFiles: 9037,
  proposedServiceInterfaces: 6, proposedUnrunCases: 26,
  testExecution: 'none; source identity and finite joins only', publicationApproved: false }, null, 2))
