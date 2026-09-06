import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
assert(process.argv.length <= 3, 'usage: node check-parity-skills-bridge-traces.mjs [source]')
const root = realpathSync(process.argv[2] ?? '/Users/carlos/Documents/Drogon-mentu-session')
const pin = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim()
assert.equal(git('rev-parse', 'HEAD'), pin)
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '')
const read = file => {
  assert(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), file)
  const full = realpathSync(path.join(root, file))
  assert(full.startsWith(root + path.sep), file)
  return readFileSync(full)
}
const doc = name => JSON.parse(readFileSync(path.join(repo, 'docs/migration', name + '.json')))
const checkHash = (file, hash) => {
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(createHash('sha256').update(read(file)).digest('hex'), hash, file)
}
const skills = doc('parity-cli-skills-contracts')
assert.equal(skills.source.gitHead, pin)
assert.deepEqual(skills.rows.map(row => row.command).sort(), ['get', 'install', 'installed', 'list', 'share', 'update'])
assert.equal(skills.counts.canonicalCommands, skills.rows.length)
for (const [file, hash] of Object.entries(skills.hashes)) checkHash(file, hash)
const requireDesktop = createRequire(path.join(repo, 'apps/desktop/package.json'))
const { parse } = createRequire(requireDesktop.resolve('@vitejs/plugin-react'))('@babel/parser')
let direct = 0, tables = 0, cases = 0
for (const [file, record] of Object.entries(skills.testDeclarations)) {
  const rows = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'it') {
      assert.equal(node.arguments[0].type, 'StringLiteral')
      rows.push({ line: node.loc.start.line, title: node.arguments[0].value, cases: 1 })
      direct++
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'CallExpression' && node.callee.callee?.type === 'MemberExpression' && node.callee.callee.object?.name === 'it' && node.callee.callee.property?.name === 'each') {
      const table = node.callee.arguments[0]
      assert.equal(table.type, 'ArrayExpression')
      assert(table.elements.every(entry => entry?.type === 'ArrayExpression'))
      assert.equal(node.arguments[0].type, 'StringLiteral')
      rows.push({ line: node.loc.start.line, title: node.arguments[0].value, cases: table.elements.length })
      tables++
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(parse(read(file).toString('utf8'), { sourceType: 'module', plugins: ['typescript'] }))
  assert.deepEqual(record.rows, rows, file)
  assert.equal(record.declarations, rows.length)
  assert.equal(record.direct, rows.filter(row => row.cases === 1).length)
  assert.equal(record.expandedCases, rows.reduce((sum, row) => sum + row.cases, 0))
  assert.equal(record.executed, false)
  cases += record.expandedCases
}
assert.deepEqual(skills.counts.sourceTests, { directDeclarations: direct, parameterizedDeclarations: tables, expandedStaticCases: cases, executed: 0 })
const bridge = doc('parity-bridge-delegated-resolution')
const census = doc('parity-source-bridges')
assert.equal(bridge.source.pinnedSha, pin)
const expected = []
for (const [b, entry] of census.bridges.entries()) for (const [e, exported] of entry.exported.entries()) for (const [m, method] of exported.methods.entries()) {
  if (method.resolution === 'delegated-unresolved' || method.disposerPairing?.status === 'unresolved-disposer-pairing' || method.ipcCalls.some(call => call.channel.kind === 'unresolved-identifier-ref')) expected.push(`${b}:${e}:${m}`)
}
const keys = [], files = new Set()
for (const row of bridge.records) {
  const ref = row.censusRecord
  keys.push(`${ref.bridgeIndex}:${ref.exportedIndex}:${ref.methodIndex}`)
  const method = census.bridges[ref.bridgeIndex].exported[ref.exportedIndex].methods[ref.methodIndex]
  assert.equal(ref.methodName, method.name)
  assert.equal(ref.originFile, method.originFile)
  assert.equal(ref.originAnchor, method.originAnchor)
  assert(read(ref.originFile).toString('utf8').split('\n')[ref.originAnchor - 1].includes(ref.methodName))
  for (const source of row.sourceHashes) { checkHash(source.path, source.sha256); files.add(source.path) }
}
assert.deepEqual(keys.sort(), expected.sort())
assert.equal(new Set(keys).size, 12)
assert.equal(bridge.counts.totalRecordsInThisSlice, keys.length)
assert.equal(bridge.counts.recordsResolvedToRealProjectFunction + bridge.counts.recordsResolvedToBuiltinApi + bridge.counts.recordsResolvedInline, keys.length)
console.log(JSON.stringify({ evidence: 'Static hashes, exact census selectors and AST declaration counts only; no source tests executed.', skills: { commands: skills.rows.length, hashes: Object.keys(skills.hashes).length, direct, tables, cases }, bridge: { records: keys.length, hashes: files.size } }, null, 2))
