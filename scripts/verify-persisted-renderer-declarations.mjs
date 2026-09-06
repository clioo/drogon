#!/usr/bin/env node
// Compare extracted declarations with the pinned source; never execute source modules.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = '/Users/carlos/Documents/Drogon-mentu-session'
const pin = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const directory = resolve(root, 'apps/desktop/src/shared/persistence-contracts')
const desktopRequire = createRequire(resolve(root, 'apps/desktop/package.json'))
const parserRequire = createRequire(desktopRequire.resolve('@vitejs/plugin-react'))
const parser = parserRequire('@babel/parser')
const ignored = new Set([
  'loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments'
])

function declarationBody(value) {
  if (Array.isArray(value)) return value.map(declarationBody)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !ignored.has(key))
    .map(([key, entry]) => [key, declarationBody(entry)]))
}

function declarations(text) {
  const parsed = parser.parse(text, { sourceType: 'module', plugins: ['typescript'] })
  const result = new Map()
  for (const statement of parsed.program.body) {
    const node = statement.declaration ?? statement
    const entries = node.type === 'VariableDeclaration' ? node.declarations
      : ['TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'TSEnumDeclaration'].includes(node.type)
        ? [node] : []
    for (const entry of entries) {
      assert.equal(entry.id.type, 'Identifier', 'Unsupported declaration identity')
      assert(!result.has(entry.id.name), `Duplicate declaration: ${entry.id.name}`)
      result.set(entry.id.name, entry)
    }
  }
  return result
}

const hash = text => createHash('sha256').update(text).digest('hex')
const files = readdirSync(directory).filter(file => file.endsWith('.ts')).sort()
assert(process.argv.slice(2).every(arg => arg === '--details'), 'Supported option: --details')
assert(files.length > 0 && files.length <= 128, 'Unexpected extraction scope')
const comparisons = []
const sourceCache = new Map()
for (const file of files) {
  if (file === 'checkpoint-staging-envelope.ts') continue // New generic binding, not a source extraction.
  const candidate = readFileSync(resolve(directory, file), 'utf8')
  const sourcePath = candidate.match(/src\/(?:shared|renderer|main)\/[a-zA-Z0-9_./-]+\.ts/)?.[0]
  assert(sourcePath && !sourcePath.split('/').includes('..'), `Missing safe provenance: ${file}`)
  if (!sourceCache.has(sourcePath)) {
    sourceCache.set(sourcePath, execFileSync('git', ['-C', sourceRoot, 'show', `${pin}:${sourcePath}`], {
      cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024
    }))
  }
  const source = sourceCache.get(sourcePath)
  const original = declarations(source)
  const extracted = declarations(candidate)
  assert(extracted.size > 0, `Empty extraction: ${file}`)
  const entries = [...extracted].map(([name, node]) => ({
    name,
    matches: original.has(name) && JSON.stringify(declarationBody(node)) ===
      JSON.stringify(declarationBody(original.get(name)))
  }))
  comparisons.push({ file, sourcePath, sourceSha256: hash(source), candidateSha256: hash(candidate), entries })
}
const entries = comparisons.flatMap(file => file.entries)
const mismatches = comparisons.flatMap(file => file.entries.filter(entry => !entry.matches)
  .map(entry => ({ file: file.file, name: entry.name })))
console.log(JSON.stringify({
  schema: 'drogon.persisted-renderer-declaration-comparison.v1', pin,
  runtime: process.version, parserVersion: parserRequire('@babel/parser/package.json').version,
  writes: false, sourceModulesExecuted: false,
  scope: 'Extracted declaration bodies and constant initializers only; not import resolution, runtime admission, durable persistence, or proof all source declarations were selected.',
  compared: entries.length, matched: entries.length - mismatches.length, mismatches,
  ...(process.argv.includes('--details') ? { comparisons } : {})
}, null, 2))
if (mismatches.length) process.exitCode = 1
