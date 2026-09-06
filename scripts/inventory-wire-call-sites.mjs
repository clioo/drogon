// Syntax census only: no receiver typing or cross-module constant resolution.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, lstatSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireDesktop = createRequire(path.join(repoRoot, 'apps/desktop/package.json'))
const requireReact = createRequire(requireDesktop.resolve('@vitejs/plugin-react'))
const { parse } = requireReact('@babel/parser')
const revision = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const members = new Set(['sendRequest', 'subscribe', 'onRequest', 'onNotification'])
const ignored = new Set(['loc', 'start', 'end', 'extra', 'comments', 'tokens'])

export function scanWireCalls(code, filename) {
  const ast = parse(code, {
    sourceType: 'module', plugins: filename.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'],
    errorRecovery: false, attachComment: false
  })
  const calls = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      const callee = node.callee
      if (callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression') {
        const member = !callee.computed && callee.property.type === 'Identifier'
          ? callee.property.name : callee.property.type === 'StringLiteral' ? callee.property.value : null
        if (members.has(member)) {
          const arg = node.arguments[0]
          const literal = arg?.type === 'StringLiteral' ? arg.value
            : arg?.type === 'TemplateLiteral' && arg.expressions.length === 0 ? arg.quasis[0].value.cooked : null
          calls.push({ file: filename, line: node.loc.start.line, column: node.loc.start.column + 1,
            member, receiver: code.slice(callee.object.start, callee.object.end),
            literal, argumentType: arg?.type ?? 'absent',
            unresolvedArgument: literal === null && arg ? code.slice(arg.start, arg.end) : null })
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (ignored.has(key)) continue
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(ast)
  return calls
}

export function inventoryWireCalls(source) {
  assert.equal(realpathSync(source), path.resolve(source), 'source root must be canonical')
  const git = args => execFileSync('git', ['-C', source, ...args], { maxBuffer: 16 * 1024 * 1024 })
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), revision)
  const entries = git(['ls-tree', '-r', '-z', revision, '--', 'mobile/src', 'src/relay']).toString().split('\0').filter(Boolean)
  const files = [], calls = []
  for (const entry of entries) {
    const [metadata, file] = entry.split('\t')
    if (!/\.tsx?$/.test(file) || /(?:^|\/)(?:__tests__|__fixtures__)(?:\/)|\.(?:test|spec)\./.test(file)) continue
    assert(!file.split('/').includes('..') && !path.isAbsolute(file))
    const [mode, kind, blob] = metadata.split(' ')
    assert.equal(kind, 'blob'); assert(['100644', '100755'].includes(mode), 'no symlinks')
    let cursor = source
    for (const part of file.split('/')) { cursor = path.join(cursor, part); assert(!lstatSync(cursor).isSymbolicLink()) }
    const bytes = readFileSync(cursor)
    const gitHash = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
    assert.equal(gitHash, blob, `source drift: ${file}`)
    const rows = scanWireCalls(bytes.toString('utf8'), file)
    files.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), callCount: rows.length })
    calls.push(...rows)
  }
  return { schema: 'drogon.wire-call-sites/1', sourceRevision: revision,
    parserVersion: requireReact('@babel/parser/package.json').version,
    scope: 'All tracked non-test/non-fixture TS/TSX under mobile/src and src/relay, including support harness files; syntax candidates, not typed RPC authority. No source code executed. Destructured or computed-nonliteral callees are outside this scan; nonliteral first arguments retained unresolved. No live registration/composition completeness claim.',
    files, calls }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'expected exactly one canonical read-only source root')
  process.stdout.write(JSON.stringify(inventoryWireCalls(process.argv[2]), null, 2) + '\n')
}
