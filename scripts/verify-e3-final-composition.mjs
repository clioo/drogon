import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const sourceRoot = process.argv[2]
assert(sourceRoot, 'Usage: node scripts/verify-e3-final-composition.mjs SOURCE_ROOT')
const pin = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const base = 'docs/migration/audit-closure/e3-bridge/'
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex')
const git = (args) => execFileSync('git', args, { cwd: sourceRoot, maxBuffer: 32 * 1024 * 1024 })
assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), pin)
const partition = read('docs/migration/e3-result-audit-partition.json')
const domain = read(partition.input.path)
assert.equal(sha(fs.readFileSync(partition.input.path)), partition.input.sha256)
const receiver = read(base + 'followup-final-boundaries.json')
const reports = Object.fromEntries(['runtime', 'integrations', 'platform'].map((name) =>
  [name, read(base + `result-${name}/contracts.json`)]))
const rows = []
for (const a of partition.assignments) {
  const report = reports[a.id]
  assert.equal(report.sourceRevision, pin)
  const expected = a.contracts.flatMap((c) => c.methods.map((method) => `${c.id}::${method}`))
  const actual = report.methods.map((m) => `${m.groupId ?? m.group ?? m.id}::${m.method}`)
  assert.deepEqual([...actual].sort(), [...expected].sort(), a.id)
  assert.equal(new Set(actual).size, actual.length)
  for (const c of a.contracts) {
    const parent = domain.rpcOwnershipContracts.find((p) => p.id === c.id)
    assert.deepEqual(c.methods, parent.methods)
    rows.push({ group: c.id, owner: a.id, methods: c.methods.length })
  }
}
const mentu = domain.rpcOwnershipContracts.find((c) => c.id === 'DR-MENTU_METHODS')
assert.equal(mentu.methods.length, 14)
const allMethods = [...Object.values(reports).flatMap((r) => r.methods.map((m) => m.method)), ...mentu.methods]
assert.equal(allMethods.length, 615)
assert.equal(new Set(allMethods).size, 615)
assert.deepEqual([...allMethods].sort(), receiver.rpcRows.map((r) => r.name).sort())
assert.equal(rows.length, 47)
assert.equal(domain.rpcOwnershipContracts.length, 48)
assert.deepEqual(reports.runtime.inheritedRemainingAcceptance, domain.remainingAcceptance)
assert.deepEqual(reports.runtime.inheritedExecutionQueue, domain.inheritedExecutionQueue)
assert.deepEqual(reports.runtime.originalTestQueue, domain.originalTestQueue)
assert.equal(domain.inheritedExecutionQueue.length, 70)
assert.equal(domain.originalTestQueue.length, 33)
assert.deepEqual(reports.platform.inheritedGates.map((g) => g.id), domain.remainingAcceptance.map((g) => g.id))
const packages = read('docs/migration/parity-test-work-packages.json').packages
assert.equal(packages.length, 46)
assert.equal(packages.reduce((n, p) => n + p.files.length, 0), 9037)

const sourceFiles = new Map()
function source(file) {
  assert(!path.isAbsolute(file) && !file.split('/').includes('..'), file)
  if (!sourceFiles.has(file)) {
    const bytes = fs.readFileSync(path.join(sourceRoot, file))
    assert.equal(sha(git(['show', `${pin}:${file}`])), sha(bytes), file)
    sourceFiles.set(file, { bytes, lines: bytes.toString().match(/[^\n]*\n|[^\n]+$/g) ?? [] })
  }
  return sourceFiles.get(file)
}
let ranges = 0
function checkRange(file, start, end, fileSha, rangeSha) {
  const s = source(file)
  assert(Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= s.lines.length, file)
  if (fileSha) assert.equal(sha(s.bytes), fileSha, file)
  if (rangeSha) assert.equal(sha(s.lines.slice(start - 1, end).join('')), rangeSha, `${file}:${start}-${end}`)
  ranges++
}
const platform = reports.platform
const botsMentu = read(base + 'followup-bots-mentu.json')
assert.equal(botsMentu.callbacks.length, 21)
assert.equal(botsMentu.callbacks.filter((c) => c.channel.startsWith('mentu:')).length, 14)
for (const e of botsMentu.sourceFiles) assert.equal(sha(source(e.path).bytes), e.sha256, e.path)
for (const e of [...platform.sourceEvidence, ...platform.leafReportedSourceEvidence, ...platform.methods.map((m) => m.receiverEvidence)]) {
  checkRange(e.file, e.startLine, e.endLine, e.wholeFileSha256, e.rangeSha256)
}
for (const rule of platform.reusedSkills.rules) {
  for (const ref of rule.source) {
    const match = ref.match(/^(.*):(\d+)-(\d+)$/)
    assert(match, ref)
    checkRange(match[1], Number(match[2]), Number(match[3]))
  }
}
const local = read(base + 'result-platform/final-local.json')
assert.deepEqual(local.residualReconciliation.map((r) => r.id).sort(), platform.sourceResiduals.map((r) => r.id).sort())
const remainingIntegrationMethods = reports.integrations.methods.filter((m) => m.sourceResiduals.length).map((m) => m.method)
assert.deepEqual(remainingIntegrationMethods, ['git.generateCommitMessage', 'git.discoverCommitMessageModels'])
const account = read('docs/migration/e3-account-residual-root-review.json')
const provider = read('docs/migration/e3-provider-runtime-root-review.json')
assert.equal(account.sourceRevision, pin)
assert.equal(provider.sourceRevision, pin)
const compositionPath = 'docs/migration/e3-final-composition.json'
if (fs.existsSync(compositionPath)) {
  const composition = read(compositionPath)
  assert.equal(composition.sourceRevision, pin)
  assert.deepEqual(composition.groups, rows)
  for (const input of composition.inputs) assert.equal(sha(fs.readFileSync(input.path)), input.sha256, input.path)
  for (const e of composition.independentSourceReads) checkRange(e.path, e.start, e.end, e.fileSha256, e.rangeSha256)
  assert.deepEqual(composition.platformResidualDispositions.map((r) => r.id).sort(), platform.sourceResiduals.map((r) => r.id).sort())
  assert.deepEqual(composition.domainResidualDispositions.map((r) => r.id).sort(), domain.sourceResiduals.map((r) => r.id).sort())
  assert.equal(composition.fullAuditAccepted, false)
  assert.equal(composition.productParity, false)
}
console.log(JSON.stringify({ pin, groups: rows, assignedMethods: 601, reusedMentuMethods: 14,
  completeRpcNames: 615, checkedSourceFiles: sourceFiles.size, checkedRanges: ranges,
  originalPackages: 46, originalFiles: 9037, preservedAcceptanceGates: domain.remainingAcceptance.length,
  preservedExecutionRecords: domain.inheritedExecutionQueue.length, preservedOriginalTestRecords: domain.originalTestQueue.length,
  testsRun: 0, semanticAcceptance: false, implementationParity: false }, null, 2))
