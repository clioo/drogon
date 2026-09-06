import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
assert(process.argv.length <= 3, 'usage: node check-parity-main-bridge-traces.mjs [source]')
const root = realpathSync(process.argv[2] ?? '/Users/carlos/Documents/Drogon-mentu-session')
const pin = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim()
assert.equal(git('rev-parse', 'HEAD'), pin)
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '')
const doc = name => JSON.parse(readFileSync(path.join(repo, 'docs/migration', name + '.json')))
const trace = doc('parity-bridge-main-push-resolution')
const census = doc('parity-source-bridges')
const registrations = doc('parity-bridge-main-request-send-resolution')
assert.equal(trace.source.gitHead, pin)
assert.equal(registrations.source.pinnedSha, pin)
const texts = new Map()
const allHashes = { ...trace.fileHashesSha256 }
for (const [file, record] of Object.entries(registrations.fileHashesSha256)) {
  if (allHashes[file]) assert.equal(allHashes[file], record.sha256, file)
  allHashes[file] = record.sha256
}
for (const [file, hash] of Object.entries(allHashes)) {
  assert(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), file)
  const full = realpathSync(path.join(root, file))
  assert(full.startsWith(root + path.sep), file)
  const bytes = readFileSync(full)
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file)
  texts.set(file, bytes.toString('utf8'))
}
const requireDesktop = createRequire(path.join(repo, 'apps/desktop/package.json'))
const { parse } = createRequire(requireDesktop.resolve('@vitejs/plugin-react'))('@babel/parser')
const trees = new Map()
function nodes(file) {
  assert(texts.has(file), `Unhashed source: ${file}`)
  if (!trees.has(file)) {
    const result = []
    function visit(node) {
      if (!node || typeof node !== 'object') return
      if (typeof node.type === 'string') result.push(node)
      for (const [key, value] of Object.entries(node)) {
        if (key === 'loc') continue
        if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === 'object') visit(value)
      }
    }
    visit(parse(texts.get(file), { sourceType: 'module', plugins: ['typescript', 'jsx'] }))
    trees.set(file, result)
  }
  return trees.get(file)
}
const channels = trace.rows.map(row => row.channel)
assert.equal(new Set(channels).size, 96)
assert.deepEqual([...channels].sort(), census.pushEventChannelToProducerMapping.filter(row => row.status === 'push-producer-unresolved').map(row => row.channel).sort())
const calls = [], byFactory = {}
let resolved = 0, unresolved = 0
for (const row of trace.rows) {
  byFactory[row.factory] = (byFactory[row.factory] ?? 0) + 1
  if (row.status === 'producer-not-found-in-bounded-search') {
    unresolved++
    assert.equal(row.producers.length, 0)
    for (const anchor of row.subscriberAnchors) {
      const found = nodes(anchor.file).some(node => node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'ipcRenderer' && node.callee.property.name === 'on' && node.arguments[0]?.value === row.channel && node.loc.start.line >= Math.min(...anchor.lines) && node.loc.start.line <= Math.max(...anchor.lines))
      assert(found, `Missing subscriber: ${row.channel}`)
    }
    continue
  }
  assert.equal(row.status, 'resolved')
  resolved++
  assert(row.producers.length > 0)
  for (const producer of row.producers) {
    assert(!/\.(test|spec)\./.test(producer.file), 'Tests are not producer evidence')
    const binding = row.constantBinding
    if (binding) {
      assert(nodes(binding.definitionFile).some(node => node.type === 'VariableDeclarator' && node.id.name === binding.name && node.init?.type === 'StringLiteral' && node.init.value === row.channel && node.loc.start.line === binding.definitionLine))
      assert(nodes(producer.file).some(node => node.type === 'ImportDeclaration' && path.resolve(root, path.dirname(producer.file), node.source.value + '.ts') === path.join(root, binding.definitionFile) && node.specifiers.some(spec => spec.type === 'ImportSpecifier' && spec.local.name === binding.name && spec.imported.name === binding.name)))
    }
    const found = nodes(producer.file).filter(node => ['CallExpression', 'OptionalCallExpression'].includes(node.type) && node.loc.start.line >= Math.min(...producer.lines) && node.loc.start.line <= Math.max(...producer.lines) && (binding ? node.arguments[0]?.type === 'Identifier' && node.arguments[0].name === binding.name : node.arguments[0]?.type === 'StringLiteral' && node.arguments[0].value === row.channel))
    assert(found.length > 0, `No source send: ${row.channel} ${producer.file}`)
    for (const node of found) {
      const callee = texts.get(producer.file).slice(node.callee.start, node.callee.end)
      assert(callee === 'send' || callee === 'sendToTrustedUIRenderer' || callee === 'this.sendToRenderer' || /(?:\.|\?\.)send$/.test(callee), callee)
      calls.push({ channel: row.channel, file: producer.file, line: node.loc.start.line, callee })
    }
  }
}
assert.equal(resolved, 94)
assert.equal(unresolved, 2)
assert.equal(trace.counts.total, channels.length)
assert.equal(trace.counts.resolved, resolved)
assert.equal(trace.counts.unresolved, unresolved)
assert.deepEqual(byFactory, trace.counts.byFactory)
assert.equal(trace.review.sourceTestsExecuted, 0)
assert.equal(trace.review.sourceModulesImported, 0)
const expected = [
  ...census.requestChannelToHandlerMapping.filter(row => row.status === 'request-handler-unresolved').map(row => `request-response:${row.channel}`),
  ...census.fireAndForgetChannelToListenerMapping.filter(row => row.status === 'fire-and-forget-listener-unresolved').map(row => `fire-and-forget:${row.channel}`)
]
assert.deepEqual(registrations.records.map(row => `${row.direction}:${row.channel}`).sort(), expected.sort())
const registrationCalls = [], testPointers = new Set()
for (const row of registrations.records) {
  const anchor = row.registrationAnchor.match(/^(.+\.ts):(\d+)$/)
  assert(anchor, row.registrationAnchor)
  const [, file, line] = anchor
  const candidates = nodes(file).filter(node => ['CallExpression', 'OptionalCallExpression'].includes(node.type) && (node.loc.start.line === Number(line) || node.arguments[0]?.loc.start.line === Number(line)))
  const call = candidates.find(node => ['handle', 'handleMentuIpc', 'handleMainWindowSkillIpc', 'ipcMain.handle', 'ipcMain.on', 'ipcMain.on?.'].includes(texts.get(file).slice(node.callee.start, node.callee.end)))
  assert(call, row.registrationAnchor)
  let arg = call.arguments[0]
  if (arg.type === 'Identifier') {
    const declarations = nodes(file).filter(node => node.type === 'VariableDeclarator' && node.id.name === arg.name && node.init?.type === 'StringLiteral')
    assert.equal(declarations.length, 1, row.channel)
    arg = declarations[0].init
  }
  assert.equal(arg.type, 'StringLiteral')
  assert.equal(arg.value, row.channel)
  registrationCalls.push({ channel: row.channel, file, callLine: call.loc.start.line, anchorLine: Number(line), callee: texts.get(file).slice(call.callee.start, call.callee.end) })
  for (const file of row.testPointerFiles) {
    assert(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), file)
    const full = realpathSync(path.join(root, file))
    assert(full.startsWith(root + path.sep), file)
    readFileSync(full)
    testPointers.add(file)
  }
}
const count = predicate => registrations.records.filter(predicate).length
const counts = registrations.counts
assert.equal(counts.totalRecordsThisSlice, 66)
assert.equal(counts.recordsWithAtLeastOneTestPointerFile, count(row => row.testPointerFiles.length > 0))
assert.equal(counts.recordsWithZeroTestPointerFiles, count(row => row.testPointerFiles.length === 0))
assert.equal(counts.distinctTestPointerFilesCited, testPointers.size)
assert.equal(counts.recordsWithReRegistrationGuardObserved, count(row => row.reRegistrationGuardObserved))
assert.equal(counts.recordsWithExplicitEventDrivenDisposerObserved, count(row => row.explicitEventDrivenDisposerObserved))
assert.equal(counts.recordsWithBothDisposalMechanisms, count(row => row.reRegistrationGuardObserved && row.explicitEventDrivenDisposerObserved))
assert.equal(counts.recordsWithNeitherDisposalMechanism, count(row => !row.reRegistrationGuardObserved && !row.explicitEventDrivenDisposerObserved))
console.log(JSON.stringify({ evidence: 'Frozen hashes, exact cohorts and source call syntax only; no runtime, payload or sender-liveness validation. Disposal counts check artifact arithmetic, not control flow.', push: { channels: channels.length, resolved, unresolved, hashes: Object.keys(trace.fileHashesSha256).length, sourceCalls: calls }, registrations: { channels: registrationCalls.length, hashes: Object.keys(registrations.fileHashesSha256).length, testPointers: testPointers.size, sourceCalls: registrationCalls } }, null, 2))
