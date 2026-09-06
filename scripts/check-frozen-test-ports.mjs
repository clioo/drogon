import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const identifier = '[A-Za-z_$][\\w$]*'
const named = `\\{[\\s\\w$,]*\\}`
const binding = `(?:${identifier}(?:\\s*,\\s*(?:${named}|\\*\\s+as\\s+${identifier}))?|${named}|\\*\\s+as\\s+${identifier})`
const staticImport = new RegExp(`^import\\s+(?:(?:type\\s+)?${binding}\\s+from\\s+)?(['"])[^'"\\\\\\r\\n]+\\1[ \\t]*;?`)

// Only the leading static-import region may differ; test bodies remain exact.
export function splitTestHeader(text) {
  let rest = text
  const comments = []
  const imports = []
  while (rest.length) {
    const space = /^\s+/.exec(rest)
    if (space) { rest = rest.slice(space[0].length); continue }
    const comment = /^\/\/[^\r\n]*(?:\r?\n|$)/.exec(rest)
    if (comment) {
      const line = comment[0].trimEnd()
      if (!/^\/\/ (?:Port provenance:|Original:)/.test(line) || /@(?:vitest|jest|jsx|ts-)/.test(line)) comments.push(line)
      rest = rest.slice(comment[0].length)
      continue
    }
    const statement = staticImport.exec(rest)
    if (!statement) break
    imports.push(statement[0])
    rest = rest.slice(statement[0].length)
  }
  return { body: rest, comments, imports }
}

export function compareFrozenTest(source, candidate, expectedSha256) {
  const errors = []
  const sourceSha256 = createHash('sha256').update(source).digest('hex')
  if (sourceSha256 !== expectedSha256) errors.push('pinned source SHA256 mismatch')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const before = splitTestHeader(decoder.decode(source))
  const after = splitTestHeader(decoder.decode(candidate))
  if (!before.body.trim()) errors.push('source contains no test body')
  if (before.body !== after.body) errors.push('test body differs beyond leading static imports/provenance')
  if (JSON.stringify(before.comments) !== JSON.stringify(after.comments)) {
    errors.push('leading non-provenance comments or runner directives differ')
  }
  return {
    ok: errors.length === 0,
    sourceSha256,
    portSha256: createHash('sha256').update(candidate).digest('hex'),
    importRegionChanged: JSON.stringify(before.imports) !== JSON.stringify(after.imports),
    errors
  }
}

function scopedFile(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\') ||
      path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('expected a normalized repository-relative path')
  }
  const actual = realpathSync(resolve(root, path))
  const rel = relative(realpathSync(root), actual)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) {
    throw new Error('file resolves outside its repository root')
  }
  return actual
}

export function checkFrozenPorts(manifest, sourceRoot, candidateRoot) {
  if (manifest?.schema !== 'drogon.frozen-test-ports/1' ||
      !/^[a-f0-9]{40}$/.test(manifest.sourceRevision ?? '') ||
      !Array.isArray(manifest.suites) || !manifest.suites.length || manifest.suites.length > 20000) {
    throw new Error('invalid frozen-test manifest')
  }
  const seenSource = new Set()
  const seenPort = new Set()
  const results = manifest.suites.map(suite => {
    try {
      if (!/^[a-f0-9]{64}$/.test(suite.sourceSha256 ?? '')) throw new Error('invalid source digest')
      if (!suite.portPath?.startsWith('tests/parity/ports/')) throw new Error('port outside test-port boundary')
      if (seenSource.has(suite.sourcePath) || seenPort.has(suite.portPath)) throw new Error('duplicate source or port')
      seenSource.add(suite.sourcePath)
      seenPort.add(suite.portPath)
      const source = readFileSync(scopedFile(sourceRoot, suite.sourcePath))
      const port = readFileSync(scopedFile(candidateRoot, suite.portPath))
      return { sourcePath: suite.sourcePath, portPath: suite.portPath, ...compareFrozenTest(source, port, suite.sourceSha256) }
    } catch (error) {
      return { sourcePath: suite.sourcePath, portPath: suite.portPath, ok: false, errors: [error.message] }
    }
  })
  return {
    schema: 'drogon.frozen-test-check/1',
    ok: results.every(result => result.ok),
    scope: 'pinned source bytes and literal test-body preservation only; NOT import binding equivalence, execution, coverage or product parity',
    declaredSourceRevision: manifest.sourceRevision,
    revisionAttestation: 'file hashes checked; Git revision membership relies on the reviewed source inventory',
    suites: results.length,
    preserved: results.filter(result => result.ok).length,
    bindingReviewRequired: true,
    results
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: {
      'source-root': { type: 'string' },
      manifest: { type: 'string', default: 'tests/parity/frozen-test-ports.json' }
    } })
    if (!values['source-root']) throw new Error('--source-root is required; no implicit reference checkout')
    const candidateRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const manifest = JSON.parse(readFileSync(scopedFile(candidateRoot, values.manifest), 'utf8'))
    const result = checkFrozenPorts(manifest, resolve(values['source-root']), candidateRoot)
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
