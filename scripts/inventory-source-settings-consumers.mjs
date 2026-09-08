#!/usr/bin/env node
// Bounded, read-only AST census of DIRECT settings-property READ/WRITE
// accesses against the canonical 214-field GlobalSettings shape, across the
// frozen legacy checkout's original src/ (never out/ or node_modules/).
//
// Canonical input: docs/migration/parity-settings-properties.json's
// `fields[].name` list (214 declared field names) — this script never
// invents or hand-authors a field list; it loads that JSON at run time and
// fails loudly if the count/shape looks wrong.
//
// Scope (deliberately bounded — see docs/migration/parity-settings-consumers.md
// "Scan scope" and "Unsupported forms" sections for the full list):
//   - Only files whose tracked source text contains the literal token
//     "GlobalSettings" (found via `git grep -lI`) are parsed at all. A file
//     that touches settings fields with zero textual occurrence of that type
//     name (e.g. solely through a totally untyped `any` cast) falls outside
//     this pass's scan surface entirely — not enumerated, not even as an
//     unresolved candidate. This is a named limitation, not a completeness
//     claim.
//   - Receiver identity is only trusted where source makes it EXPLICIT:
//       * a parameter/variable whose own type annotation resolves (through
//         bounded same-module type-alias/interface hops, and the TS
//         utility types Partial/Readonly/Required/Pick/Omit) to
//         GlobalSettings or a subset of its fields;
//       * a destructured field pulled directly off such a receiver;
//       * a value obtained by calling a same-module function/arrow (or a
//         same-scope/module-level "getter" parameter) whose OWN declared
//         return type resolves the same way. Cross-module call-target
//         resolution is NOT performed (documented limitation).
//   - Aliases (`const s = settings` with no annotation of its own), computed
//     non-literal keys, and `...rest` destructures are NEVER silently
//     attributed to a field — each is recorded in its own unresolved bucket.
//   - An object-literal is treated as a settings WRITE site only when it is
//     the direct initializer of a settings-typed variable, or the direct
//     `return` value of a settings-typed-returning function/arrow.
//
// Parses the read-only legacy checkout with @babel/parser; never imports,
// requires, or executes any legacy module. Output is deterministic (no
// wall-clock fields) and emitted only to stdout.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Source-read-only, stdout-only: this script never writes a file anywhere,
// under any flag. `docs/migration/parity-settings-consumers.json` and `.md`
// are authored artifacts (via apply_patch), not generated-and-written by
// this script — run it and capture stdout, or pass --verify-json/--verify-md
// to read-only-compare its fresh output against those already-authored
// files. There is no `--allow-sha-mismatch` escape: a HEAD that does not
// match the pinned baseline is always a hard failure.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = realpathSync(path.resolve(SCRIPT_DIR, '..'))
// No implicit reference checkout: pass --source explicitly or set
// $DROGON_SOURCE_ROOT (check-frozen-test-ports precedent).
const DEFAULT_SOURCE = process.env.DROGON_SOURCE_ROOT ?? null
const PINNED_SOURCE_SHA = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const CANONICAL_FIELDS_PATH = path.join(REPO_ROOT, 'docs/migration/parity-settings-properties.json')
const SCHEMA = 'drogon.inventory.settings-consumers.v1'
const MAX_TYPE_DEPTH = 6
const UTILITY_TYPE_NAMES = new Set(['Partial', 'Readonly', 'Required', 'NonNullable'])
const FUNCTION_LIKE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
])
const AST_IGNORED_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'extra',
  'tokens',
  'comments',
])

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------
function parseArgv(argv) {
  const out = {
    source: DEFAULT_SOURCE,
    format: 'json',
    verifyJsonPath: null,
    verifyMdPath: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--source') {
      out.source = argv[++i]
      assert.ok(out.source, '--source requires a path')
    } else if (arg === '--format') {
      out.format = argv[++i]
      assert.ok(out.format === 'json' || out.format === 'md', '--format must be "json" or "md"')
    } else if (arg === '--verify-json') {
      out.verifyJsonPath = argv[++i]
      assert.ok(out.verifyJsonPath, '--verify-json requires a path')
    } else if (arg === '--verify-md') {
      out.verifyMdPath = argv[++i]
      assert.ok(out.verifyMdPath, '--verify-md requires a path')
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'usage: node scripts/inventory-source-settings-consumers.mjs',
          '  [--source <legacy-checkout>] [--format json|md]',
          '  [--verify-json <path>] [--verify-md <path>]',
          '',
          '  Bounded AST census of direct GlobalSettings field READ/WRITE',
          '  accesses. Prints the deterministic result to stdout; NEVER writes',
          '  a file. --verify-json/--verify-md read (never write) an already-',
          '  authored artifact and report whether it matches a fresh in-memory',
          '  regeneration byte-for-byte.',
        ].join('\n') + '\n',
      )
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Read-only confinement guards (adapted from the reviewed
// inventory-source-contracts.mjs pattern: lstat-first, never follow a
// symlink). This script has no write path at all, so only the read-side
// guards remain.
// ---------------------------------------------------------------------------
function fail(message) {
  throw new Error(message)
}

function assertNoSymlinkAncestors(root, relPath, label) {
  const parts = relPath.split(path.sep).filter(Boolean)
  let cursor = root
  for (const part of parts) {
    cursor = path.join(cursor, part)
    let st
    try {
      st = lstatSync(cursor)
    } catch (error) {
      if (error.code === 'ENOENT') return
      fail(`read failure guarding ${label}: ${error.message}`)
    }
    if (st.isSymbolicLink()) fail(`refusing symlinked path component (${label}): ${cursor}`)
  }
}

function assertWithinRoot(root, relPath, label) {
  const resolvedRoot = path.resolve(root)
  const resolvedFull = path.resolve(root, relPath)
  if (resolvedFull !== resolvedRoot && !resolvedFull.startsWith(resolvedRoot + path.sep)) {
    fail(`${label} escapes root (path traversal): ${relPath}`)
  }
  return resolvedFull
}

// ---------------------------------------------------------------------------
// Git provenance (fail loudly, never swallow errors)
// ---------------------------------------------------------------------------
function gitOutput(sourceRoot, args) {
  return execFileSync('git', ['-C', sourceRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  })
}

function sourceGitMeta(sourceRoot) {
  const headSha = gitOutput(sourceRoot, ['rev-parse', 'HEAD']).trim()
  assert.ok(/^[0-9a-f]{40}$/.test(headSha), `unexpected HEAD sha: ${headSha}`)
  const porcelain = gitOutput(sourceRoot, ['status', '--porcelain', '--', 'src'])
  const trackedDirty = []
  for (const line of porcelain.split('\n')) {
    if (line.length === 0) continue
    const status = line.slice(0, 2)
    const entry = line.slice(3).trim()
    if (status !== '??') trackedDirty.push(`${status} ${entry}`)
  }
  trackedDirty.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (trackedDirty.length > 0) {
    fail(`legacy source has tracked dirty changes under src/, refusing a canonical census: ${trackedDirty.join('; ')}`)
  }
  return { headSha, trackedDirty }
}

function listCandidateFiles(sourceRoot) {
  // git grep only ever searches tracked files, so this is already scoped to
  // the frozen checkout's committed content (never node_modules/out, which
  // are untracked/ignored in this checkout).
  let raw
  try {
    raw = execFileSync('git', ['-C', sourceRoot, 'grep', '-lI', '--', 'GlobalSettings', 'src'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch (error) {
    // exit code 1 with empty stdout means "no matches" — treat as empty, not
    // a failure; any other failure (bad revision, git missing) is fatal.
    if (error.status === 1 && !error.stdout) return []
    fail(`git grep failed: ${error.message}`)
  }
  const files = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx)$/.test(f))
  return [...new Set(files)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

// ---------------------------------------------------------------------------
// Babel parser loading (reuse the installed @vitejs/plugin-react dependency;
// no new deps).
// ---------------------------------------------------------------------------
function loadBabelParser() {
  const desktopPkg = path.join(REPO_ROOT, 'apps/desktop/package.json')
  const requireFromDesktop = createRequire(desktopPkg)
  const pluginReactPath = requireFromDesktop.resolve('@vitejs/plugin-react')
  const requireFromPlugin = createRequire(pluginReactPath)
  const parserPath = requireFromPlugin.resolve('@babel/parser')
  const parser = requireFromPlugin(parserPath)
  assert.equal(typeof parser.parse, 'function', '@babel/parser has no parse()')
  const parserVersion = requireFromPlugin('@babel/parser/package.json').version ?? 'unknown'
  return { parse: parser.parse, parserVersion }
}

function parseSource(babelParse, code, relPosix) {
  const plugins = ['typescript']
  if (relPosix.endsWith('.tsx')) plugins.push('jsx')
  return babelParse(code, { sourceType: 'module', plugins, errorRecovery: false, attachComment: false })
}

// ---------------------------------------------------------------------------
// Generic AST helpers
// ---------------------------------------------------------------------------
function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex')
}

function lineOf(node) {
  return node?.loc?.start?.line ?? 0
}

function walkNode(node, visit, seen) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (seen.has(node)) return
  seen.add(node)
  if (typeof node.type === 'string') visit(node)
  for (const key of Object.keys(node)) {
    if (AST_IGNORED_KEYS.has(key)) continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) walkNode(child, visit, seen)
    } else if (value !== null && typeof value === 'object') {
      walkNode(value, visit, seen)
    }
  }
}

function walkFullModule(ast, visit) {
  walkNode(ast, visit, new Set())
}

// Scope-bounded walk: visits every descendant of `root` but never descends
// past a nested function-like node's own params/body — those are separate
// scopes, visited independently via their own top-level entry in the caller.
function walkOwnScope(root, visit) {
  const seen = new Set()
  const recurse = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (typeof node.type === 'string') {
      visit(node)
      if (FUNCTION_LIKE_TYPES.has(node.type)) return
    }
    for (const key of Object.keys(node)) {
      if (AST_IGNORED_KEYS.has(key)) continue
      const value = node[key]
      if (Array.isArray(value)) {
        for (const child of value) recurse(child)
      } else if (value !== null && typeof value === 'object') {
        recurse(value)
      }
    }
  }
  recurse(root)
}

function buildParentMap(ast) {
  const parents = new WeakMap()
  const seen = new Set()
  const recurse = (node, parent) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (parent) parents.set(node, parent)
    for (const key of Object.keys(node)) {
      if (AST_IGNORED_KEYS.has(key)) continue
      const value = node[key]
      if (Array.isArray(value)) {
        for (const child of value) recurse(child, node)
      } else if (value !== null && typeof value === 'object') {
        recurse(value, node)
      }
    }
  }
  recurse(ast, null)
  return parents
}

function objectKeyName(keyNode) {
  if (!keyNode) return null
  if (keyNode.type === 'Identifier') return keyNode.name
  if (keyNode.type === 'StringLiteral') return keyNode.value
  return null
}

function stringLiteralUnion(node) {
  if (!node) return null
  if (node.type === 'TSLiteralType' && node.literal?.type === 'StringLiteral') return [node.literal.value]
  if (node.type === 'TSUnionType') {
    const out = []
    for (const member of node.types) {
      const sub = stringLiteralUnion(member)
      if (sub === null) return null
      out.push(...sub)
    }
    return out
  }
  return null
}

// ---------------------------------------------------------------------------
// Per-module type analysis context
// ---------------------------------------------------------------------------
// The only module that is ALLOWED to declare `GlobalSettings` itself — any
// other module's use of that bare spelling must be traced back to an import
// (or re-export) whose declared source resolves to this exact module before
// it is trusted as the canonical type, never matched by name alone.
const CANONICAL_MODULE_REL = 'src/shared/global-settings-types.ts'
function importsFromCanonicalModule(relPosix, sourceValue) {
  if (typeof sourceValue !== 'string' || !sourceValue.startsWith('.')) return false
  const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(relPosix), sourceValue))
  return normalized.replace(/\.(ts|tsx|js|jsx)$/, '') === CANONICAL_MODULE_REL.replace(/\.ts$/, '')
}

function buildModuleContext(relPosix, code, ast, canonicalFieldSet, allFieldNames) {
  const ctx = {
    rel: relPosix,
    code,
    ast,
    canonicalFieldSet,
    allFieldNames,
    // Names linked by an exact relative import from the canonical module,
    // or by being the canonical module's own declaration site) to refer to
    // the actual GlobalSettings type — never seeded with the bare spelling
    // "GlobalSettings" itself, since an unrelated local declaration or an
    // import of a same-named type from a DIFFERENT module must NOT be
    // confirmed. See issue (1): name matching is not type identity.
    globalSettingsLocalNames: new Set(),
    typeAliases: new Map(), // name -> typeNode (absent if the name is ambiguous — see below)
    interfaceMembers: new Map(), // name -> members[] (absent if the name is ambiguous)
    shadowedTypeNames: new Set(),
  }
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration' && importsFromCanonicalModule(relPosix, node.source?.value)) {
      for (const spec of node.specifiers) {
        if (spec.type === 'ImportSpecifier' && spec.imported?.type === 'Identifier' && spec.imported.name === 'GlobalSettings') {
          ctx.globalSettingsLocalNames.add(spec.local.name)
        }
      }
    }
  }
  if (relPosix === CANONICAL_MODULE_REL) ctx.globalSettingsLocalNames.add('GlobalSettings')

  // Type alias / interface member collection is module-global by name (not
  // properly block-scoped), and a name declared MORE THAN ONCE anywhere in
  // the module (as an alias, an interface, or both) is inherently ambiguous
  // under this pass's bounded resolution — rather than silently picking
  // whichever declaration was visited last, such a name is excluded from
  // BOTH maps entirely, so any lookup against it conservatively misses
  // (falls to unresolved) instead of guessing. See issue (3).
  const seenTypeNames = new Set()
  const ambiguousTypeNames = new Set()
  const rawAliasNodes = new Map()
  const rawInterfaceMembers = new Map()
  walkFullModule(ast, (node) => {
    if (node.type === 'TSTypeParameter') ctx.shadowedTypeNames.add(node.name)
    if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) {
        if (!ctx.globalSettingsLocalNames.has(spec.local.name)) ctx.shadowedTypeNames.add(spec.local.name)
      }
    }
    let name = null
    if (node.type === 'TSTypeAliasDeclaration' && node.id?.type === 'Identifier') name = node.id.name
    else if (node.type === 'TSInterfaceDeclaration' && node.id?.type === 'Identifier') name = node.id.name
    if (name === null) return
    if (relPosix !== CANONICAL_MODULE_REL || name !== 'GlobalSettings') ctx.shadowedTypeNames.add(name)
    if (seenTypeNames.has(name)) {
      ambiguousTypeNames.add(name)
      return
    }
    seenTypeNames.add(name)
    if (node.type === 'TSTypeAliasDeclaration') rawAliasNodes.set(name, node.typeAnnotation)
    else rawInterfaceMembers.set(name, node.body?.body ?? [])
  })
  for (const [name, typeNode] of rawAliasNodes) {
    if (!ambiguousTypeNames.has(name)) ctx.typeAliases.set(name, typeNode)
  }
  for (const [name, members] of rawInterfaceMembers) {
    if (!ambiguousTypeNames.has(name)) ctx.interfaceMembers.set(name, members)
  }
  for (const name of ctx.shadowedTypeNames) ctx.globalSettingsLocalNames.delete(name)
  return ctx
}

// Mode (a): does `typeNode` itself resolve to (a subset of) GlobalSettings?
function matchSettingsShape(ctx, typeNode, depth = 0) {
  if (!typeNode || depth > MAX_TYPE_DEPTH) return null
  if (typeNode.type === 'TSUnionType') {
    const nonNullMembers = typeNode.types.filter((t) => t.type !== 'TSNullKeyword' && t.type !== 'TSUndefinedKeyword')
    if (nonNullMembers.length === 0) return null
    if (nonNullMembers.length === 1) return matchSettingsShape(ctx, nonNullMembers[0], depth + 1)
    // More than one non-null alternative: a receiver typed as this union is
    // only provably settings-ish if EVERY alternative independently resolves
    // that way (no ambiguity about which shape the runtime value actually
    // has). `GlobalSettings | SomeUnrelatedShape` must stay unresolved — see
    // issue (2); it is not enough for the FIRST recognizable member to
    // match. When every alternative does resolve, only fields guaranteed on
    // ALL alternatives (the intersection) are attributed.
    const matches = nonNullMembers.map((m) => matchSettingsShape(ctx, m, depth + 1))
    if (matches.some((m) => !m)) return null
    if (matches.every((m) => m.fieldSet === 'all')) return { fieldSet: 'all', form: 'Union(all-GlobalSettings)' }
    const sets = matches.map((m) => (m.fieldSet === 'all' ? ctx.allFieldNames : [...m.fieldSet]))
    let intersection = new Set(sets[0])
    for (const s of sets.slice(1)) {
      const asSet = new Set(s)
      intersection = new Set([...intersection].filter((x) => asSet.has(x)))
    }
    return { fieldSet: intersection, form: 'Union' }
  }
  if (typeNode.type !== 'TSTypeReference') return null
  if (typeNode.typeName?.type !== 'Identifier') return null // TSQualifiedName: unsupported, stays unresolved
  const rawName = typeNode.typeName.name
  if (ctx.globalSettingsLocalNames.has(rawName)) return { fieldSet: 'all', form: 'GlobalSettings' }
  const params = typeNode.typeParameters?.params
  if (UTILITY_TYPE_NAMES.has(rawName) && !ctx.shadowedTypeNames.has(rawName) && params?.[0]) {
    const inner = matchSettingsShape(ctx, params[0], depth + 1)
    if (!inner) return null
    return { fieldSet: inner.fieldSet, form: `${rawName}<${inner.form}>` }
  }
  if ((rawName === 'Pick' || rawName === 'Omit') && !ctx.shadowedTypeNames.has(rawName) && params?.length >= 2) {
    const inner = matchSettingsShape(ctx, params[0], depth + 1)
    if (!inner) return null
    const keys = stringLiteralUnion(params[1])
    if (keys === null) return null // dynamic key list — unresolved
    let fieldSet
    if (rawName === 'Pick') {
      fieldSet = inner.fieldSet === 'all' ? new Set(keys) : new Set(keys.filter((k) => inner.fieldSet.has(k)))
    } else {
      const base = inner.fieldSet === 'all' ? ctx.allFieldNames : [...inner.fieldSet]
      fieldSet = new Set(base.filter((f) => !keys.includes(f)))
    }
    return { fieldSet, form: rawName }
  }
  const alias = ctx.typeAliases.get(rawName)
  if (alias) return matchSettingsShape(ctx, alias, depth + 1)
  return null
}

// Does `typeNode` describe a function/getter whose return type
// resolves to (a subset of) GlobalSettings? Returns { direct, promiseInner }.
function matchGetterShape(ctx, typeNode, depth = 0) {
  if (!typeNode || depth > MAX_TYPE_DEPTH) return null
  if (typeNode.type !== 'TSFunctionType') return null
  const returnTypeNode = typeNode.typeAnnotation?.typeAnnotation
  const direct = matchSettingsShape(ctx, returnTypeNode, depth + 1)
  let promiseInner = null
  if (
    returnTypeNode?.type === 'TSTypeReference' &&
    returnTypeNode.typeName?.type === 'Identifier' &&
    returnTypeNode.typeName.name === 'Promise' && !ctx.shadowedTypeNames.has('Promise') &&
    returnTypeNode.typeParameters?.params?.[0]
  ) {
    promiseInner = matchSettingsShape(ctx, returnTypeNode.typeParameters.params[0], depth + 1)
  }
  if (!direct && !promiseInner) return null
  return { direct, promiseInner }
}

// Mode (b): resolve a container type's member named `key`. Returns one of:
//   { isField: true }                       — container IS GlobalSettings-ish and key is one of its fields
//   { containerMatch: fieldSetMatch }        — member itself resolves to a GlobalSettings-ish shape (nested container)
//   { getterMatch: getterShape }             — member is a getter returning a GlobalSettings-ish shape
//   { notFound: true }                       — key not resolvable as anything relevant to this census
function containerMemberLookup(ctx, typeNode, key, depth = 0) {
  if (!typeNode || depth > MAX_TYPE_DEPTH) return { notFound: true }
  const asSettings = matchSettingsShape(ctx, typeNode, depth)
  if (asSettings) {
    if (asSettings.fieldSet === 'all' || asSettings.fieldSet.has(key)) return { isField: true }
    return { notFound: true }
  }
  if (typeNode.type === 'TSTypeLiteral') return lookupInMembers(ctx, typeNode.members, key, depth)
  if (typeNode.type === 'TSIntersectionType') {
    for (const member of typeNode.types) {
      const r = containerMemberLookup(ctx, member, key, depth + 1)
      if (!r.notFound) return r
    }
    return { notFound: true }
  }
  if (typeNode.type === 'TSTypeReference' && typeNode.typeName?.type === 'Identifier') {
    const rawName = typeNode.typeName.name
    const alias = ctx.typeAliases.get(rawName)
    if (alias) return containerMemberLookup(ctx, alias, key, depth + 1)
    const members = ctx.interfaceMembers.get(rawName)
    if (members) return lookupInMembers(ctx, members, key, depth)
    return { notFound: true } // external/unknown container — unresolved, not guessed
  }
  return { notFound: true }
}

function lookupInMembers(ctx, members, key, depth) {
  for (const member of members) {
    if (member.type !== 'TSPropertySignature' || member.computed) continue
    if (objectKeyName(member.key) !== key) continue
    const memberType = member.typeAnnotation?.typeAnnotation
    const asSettings = matchSettingsShape(ctx, memberType, depth + 1)
    if (asSettings) return { containerMatch: asSettings }
    const asGetter = matchGetterShape(ctx, memberType, depth + 1)
    if (asGetter) return { getterMatch: asGetter }
    return { notFound: true }
  }
  return { notFound: true }
}

// ---------------------------------------------------------------------------
// Reference collection for one module
// ---------------------------------------------------------------------------
function analyzeModule(relPosix, code, babelParse, canonicalFieldNames) {
  const canonicalFieldSet = new Set(canonicalFieldNames)
  const references = [] // { field, path, line, kind, accessForm, receiverEvidence }
  const unresolved = {
    aliasAccesses: [],
    candidateAccesses: [],
    computedDynamicAccesses: [],
    destructureRestUnresolved: [],
    destructureComputedUnresolved: [],
  }

  let ast
  try {
    ast = parseSource(babelParse, code, relPosix)
  } catch (error) {
    return { parseError: error.message, references, unresolved }
  }

  const ctx = buildModuleContext(relPosix, code, ast, canonicalFieldSet, canonicalFieldNames)
  const parents = buildParentMap(ast)
  const attributed = new Set() // MemberExpression/OptionalMemberExpression nodes already recorded

  function isWriteTarget(node) {
    const parent = parents.get(node)
    if (!parent) return false
    if (parent.type === 'AssignmentExpression' && parent.left === node) return true
    if (parent.type === 'UpdateExpression' && parent.argument === node) return true
    return false
  }

  function nearestTestTitle(node) {
    let cursor = parents.get(node)
    while (cursor) {
      if (cursor.type === 'CallExpression') {
        let calleeName = null
        if (cursor.callee.type === 'Identifier') calleeName = cursor.callee.name
        else if (cursor.callee.type === 'MemberExpression' && cursor.callee.property?.type === 'Identifier') {
          calleeName = cursor.callee.object?.type === 'Identifier' ? cursor.callee.object.name : null
        }
        if (calleeName && ['it', 'test', 'describe'].includes(calleeName)) {
          const arg0 = cursor.arguments?.[0]
          if (arg0?.type === 'StringLiteral') return { title: arg0.value, line: lineOf(cursor) }
          if (arg0?.type === 'TemplateLiteral' && arg0.expressions.length === 0) {
            return { title: arg0.quasis.map((q) => q.value.cooked).join(''), line: lineOf(cursor) }
          }
        }
      }
      cursor = parents.get(cursor)
    }
    return null
  }

  const isTestFile = /\.(test|spec)\./.test(relPosix)

  function recordReference(field, node, kind, accessForm, receiverEvidence) {
    if (!canonicalFieldSet.has(field)) return
    attributed.add(node)
    const entry = {
      field,
      path: relPosix,
      line: lineOf(node),
      kind,
      accessForm,
      receiverEvidence,
    }
    if (isTestFile) {
      const testPointer = nearestTestTitle(node)
      if (testPointer) {
        entry.testTitle = testPointer.title
        entry.testTitleLine = testPointer.line
      }
    }
    references.push(entry)
  }

  function recordObjectLiteralWrites(objectExpr, receiverEvidence, fieldSet) {
    for (const prop of objectExpr.properties) {
      if (prop.type === 'SpreadElement') continue // no per-field info from a spread target
      if (prop.type !== 'ObjectProperty') continue
      if (prop.computed) {
        unresolved.computedDynamicAccesses.push({ path: relPosix, line: lineOf(prop), receiverEvidence, note: 'computed key in settings object-literal write' })
        continue
      }
      const key = objectKeyName(prop.key)
      if (key && canonicalFieldSet.has(key) && (fieldSet === 'all' || fieldSet.has(key))) {
        recordReference(key, prop.key, 'write', 'object-literal', receiverEvidence)
      }
    }
  }

  function destructureField(pattern, key, node, receiverEvidence) {
    recordReference(key, node, 'read', 'destructure', receiverEvidence)
  }

  // Each scope is either the Program (module top level, no params) or a
  // function-like node's own params + body.
  const functionNodes = []
  walkFullModule(ast, (node) => {
    if (FUNCTION_LIKE_TYPES.has(node.type)) functionNodes.push(node)
  })
  const scopes = [{ isProgram: true, params: [], body: ast.program }]
  for (const fn of functionNodes) scopes.push({ isProgram: false, params: fn.params ?? [], body: fn.body, fn })

  // Module-level named getters, visible as call targets from every scope.
  const moduleGetters = new Map()
  for (const node of ast.program.body) {
    if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier' && node.returnType) {
      const shape = matchGetterShape(ctx, { type: 'TSFunctionType', typeAnnotation: node.returnType, parameters: [] }, 0)
      if (shape) moduleGetters.set(node.id.name, shape)
    } else if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id?.type !== 'Identifier') continue
        const init = decl.init
        if ((init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') && init.returnType) {
          const shape = matchGetterShape(ctx, { type: 'TSFunctionType', typeAnnotation: init.returnType, parameters: [] }, 0)
          if (shape) moduleGetters.set(decl.id.name, shape)
        }
      }
    }
  }

  for (const scope of scopes) {
    const scopeBindings = new Map() // name -> { fieldSet, form }
    const scopeGetters = new Map() // name -> { direct, promiseInner }
    // A name declared MORE THAN ONCE anywhere in this same function/program
    // scope (a param later shadowed by a block-local of the same name, two
    // sibling blocks each declaring it differently, etc.) is conservatively
    // treated as ambiguous for the REMAINDER of this scope: no further
    // member-expression access on that name is attributed to any field, in
    // either direction. This is a scope-wide approximation, not true
    // lexical/block scoping — see issue (3) and unsupportedForms.
    const declaredScopeNames = new Set()
    const ambiguousScopeNames = new Set()
    const declarationCounts = new Map()
    function collectPattern(pattern) {
      if (!pattern) return
      if (pattern.type === 'Identifier') declarationCounts.set(pattern.name, (declarationCounts.get(pattern.name) ?? 0) + 1)
      else if (pattern.type === 'AssignmentPattern') collectPattern(pattern.left)
      else if (pattern.type === 'RestElement') collectPattern(pattern.argument)
      else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(collectPattern)
      else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(prop => collectPattern(prop.type === 'RestElement' ? prop.argument : prop.value))
    }
    scope.params.forEach(collectPattern)
    walkOwnScope(scope.body, node => {
      if (node.type === 'VariableDeclarator') collectPattern(node.id)
      if (node.type === 'CatchClause') collectPattern(node.param)
      if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') collectPattern(node.id)
      if (node.type === 'ImportDeclaration') node.specifiers.forEach(spec => collectPattern(spec.local))
    })
    for (const [name, count] of declarationCounts) if (count > 1) ambiguousScopeNames.add(name)
    function lookupGetter(name) {
      if (ambiguousScopeNames.has(name)) return null
      if (scopeGetters.has(name)) return scopeGetters.get(name)
      if (!scope.isProgram && declarationCounts.has(name)) return null
      return moduleGetters.get(name) ?? null
    }
    function noteScopedDeclaration(name) {
      if (ambiguousScopeNames.has(name)) return false
      if (declaredScopeNames.has(name)) {
        ambiguousScopeNames.add(name)
        scopeBindings.delete(name)
        scopeGetters.delete(name)
        return false
      }
      declaredScopeNames.add(name)
      return true
    }

    // Computes whether `typeNode` matches (does NOT itself decide whether to
    // register — callers gate that on their own noteScopedDeclaration call,
    // since the bookkeeping must fire even for declarations that turn out
    // not to match, to correctly detect a later shadowing collision).
    function matchParamOrVarType(typeNode) {
      const settingsMatch = matchSettingsShape(ctx, typeNode, 0)
      if (settingsMatch) return { kind: 'binding', match: settingsMatch }
      const getterMatch = matchGetterShape(ctx, typeNode, 0)
      if (getterMatch) return { kind: 'getter', match: getterMatch }
      return null
    }

    function registerParamOrVarType(name, typeNode, node, formPrefix) {
      const canRegister = noteScopedDeclaration(name)
      const resolved = matchParamOrVarType(typeNode)
      if (!resolved) return false
      if (resolved.kind === 'binding') {
        if (canRegister) scopeBindings.set(name, { fieldSet: resolved.match.fieldSet, form: `${formPrefix}:${resolved.match.form}` })
      } else if (canRegister) {
        scopeGetters.set(name, resolved.match)
      }
      return true
    }

    function processObjectPattern(pattern, containerTypeNode, evidencePrefix) {
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') {
          unresolved.destructureRestUnresolved.push({ path: relPosix, line: lineOf(prop), context: evidencePrefix })
          continue
        }
        if (prop.type !== 'ObjectProperty') continue
        if (prop.computed) {
          unresolved.destructureComputedUnresolved.push({ path: relPosix, line: lineOf(prop) })
          continue
        }
        const key = objectKeyName(prop.key)
        if (key === null) {
          unresolved.destructureComputedUnresolved.push({ path: relPosix, line: lineOf(prop) })
          continue
        }
        let localName = null
        if (prop.value.type === 'Identifier') localName = prop.value.name
        else if (prop.value.type === 'AssignmentPattern' && prop.value.left.type === 'Identifier') localName = prop.value.left.name
        if (!containerTypeNode) continue
        const lookup = containerMemberLookup(ctx, containerTypeNode, key, 0)
        if (lookup.isField) {
          // Direct evidence at this exact destructure site — recorded
          // regardless of what later happens to the local binding name.
          destructureField(pattern, key, prop.key, `${evidencePrefix}-destructure`)
        } else if (lookup.containerMatch && localName) {
          if (noteScopedDeclaration(localName)) {
            scopeBindings.set(localName, { fieldSet: lookup.containerMatch.fieldSet, form: `${evidencePrefix}-nested-container:${lookup.containerMatch.form}` })
          }
        } else if (lookup.getterMatch && localName) {
          if (noteScopedDeclaration(localName)) scopeGetters.set(localName, lookup.getterMatch)
        }
        // lookup.notFound: property unrelated to the settings census — skip.
      }
    }

    // 1. Params.
    for (const param of scope.params) {
      const target = param.type === 'AssignmentPattern' ? param.left : param
      if (target.type === 'Identifier') {
        if (target.typeAnnotation) {
          registerParamOrVarType(target.name, target.typeAnnotation.typeAnnotation, target, 'typed-param')
        } else {
          // Still note the plain declaration so a LATER same-named variable
          // in this scope (typed or not) is correctly detected as shadowing
          // rather than silently trusted.
          noteScopedDeclaration(target.name)
        }
      } else if (target.type === 'ObjectPattern' && target.typeAnnotation) {
        processObjectPattern(target, target.typeAnnotation.typeAnnotation, 'typed-param')
      }
    }

    // 2. Own-scope variable declarators (never descending into nested
    // function scopes — those are separate entries in `scopes`).
    const declarators = []
    walkOwnScope(scope.body, (node) => {
      if (node.type === 'VariableDeclarator') declarators.push(node)
    })
    for (const decl of declarators) {
      if (decl.id.type === 'Identifier') {
        const name = decl.id.name
        if (decl.id.typeAnnotation) {
          const matched = registerParamOrVarType(name, decl.id.typeAnnotation.typeAnnotation, decl.id, 'typed-variable')
          if (matched && decl.init?.type === 'ObjectExpression' && scopeBindings.has(name)) {
            recordObjectLiteralWrites(decl.init, 'typed-variable-object-literal-init', scopeBindings.get(name).fieldSet)
          }
          continue
        }
        const canRegister = noteScopedDeclaration(name)
        const init = decl.init
        if (!init) continue
        let callExpr = null
        let viaAwait = false
        if (init.type === 'CallExpression') callExpr = init
        else if (init.type === 'AwaitExpression' && init.argument?.type === 'CallExpression') {
          callExpr = init.argument
          viaAwait = true
        }
        if (callExpr && callExpr.callee.type === 'Identifier') {
          const getter = lookupGetter(callExpr.callee.name)
          if (getter) {
            const shape = viaAwait ? getter.promiseInner : getter.direct
            if (shape && canRegister) scopeBindings.set(name, { fieldSet: shape.fieldSet, form: `typed-call-return:${shape.form}` })
          }
        } else if (init.type === 'Identifier' && scopeBindings.has(init.name)) {
          unresolved.aliasAccesses.push({ path: relPosix, line: lineOf(decl), aliasName: name, aliasedFrom: init.name })
        }
      } else if (decl.id.type === 'ObjectPattern') {
        let containerTypeNode = decl.id.typeAnnotation?.typeAnnotation ?? null
        if (!containerTypeNode) {
          const init = decl.init
          let callExpr = null
          let viaAwait = false
          if (init?.type === 'CallExpression') callExpr = init
          else if (init?.type === 'AwaitExpression' && init.argument?.type === 'CallExpression') {
            callExpr = init.argument
            viaAwait = true
          }
          if (callExpr && callExpr.callee.type === 'Identifier') {
            const getter = lookupGetter(callExpr.callee.name)
            const shape = getter ? (viaAwait ? getter.promiseInner : getter.direct) : null
            if (shape) {
              // Synthesize a pseudo type-reference-free container: since the
              // container IS GlobalSettings-ish directly (not a named type
              // node), resolve each destructured key against its fieldSet
              // inline rather than through containerMemberLookup.
              for (const prop of decl.id.properties) {
                if (prop.type === 'RestElement') {
                  unresolved.destructureRestUnresolved.push({ path: relPosix, line: lineOf(prop), context: 'typed-call-return' })
                  continue
                }
                if (prop.type !== 'ObjectProperty' || prop.computed) {
                  unresolved.destructureComputedUnresolved.push({ path: relPosix, line: lineOf(prop) })
                  continue
                }
                const key = objectKeyName(prop.key)
                if (key && (shape.fieldSet === 'all' || shape.fieldSet.has(key))) {
                  destructureField(decl.id, key, prop.key, 'typed-call-return-destructure')
                }
              }
            }
          }
          continue
        }
        processObjectPattern(decl.id, containerTypeNode, 'typed-variable')
      }
    }

    // 3. Object-literal writes from an explicit `return { ... }` inside a
    // settings-typed-returning function, or an expression-bodied arrow that
    // IS the object literal.
    if (!scope.isProgram && scope.fn.returnType) {
      const returnMatch = matchSettingsShape(ctx, scope.fn.returnType.typeAnnotation, 0)
      if (returnMatch) {
        if (scope.fn.body.type === 'ObjectExpression') {
          recordObjectLiteralWrites(scope.fn.body, 'typed-return-object-literal', returnMatch.fieldSet)
        } else {
          const returns = []
          walkOwnScope(scope.body, (node) => {
            if (node.type === 'ReturnStatement') returns.push(node)
          })
          for (const ret of returns) {
            if (ret.argument?.type === 'ObjectExpression') recordObjectLiteralWrites(ret.argument, 'typed-return-object-literal', returnMatch.fieldSet)
          }
        }
      }
    }

    // 4. Direct member-expression access on a confirmed receiver, within
    // this same scope only.
    walkOwnScope(scope.body, (node) => {
      if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return
      if (node.object.type !== 'Identifier') return
      const binding = scopeBindings.get(node.object.name)
      if (!binding) return
      let propName = null
      let accessForm = 'member'
      if (!node.computed && node.property.type === 'Identifier') {
        propName = node.property.name
        accessForm = 'member'
      } else if (node.computed && node.property.type === 'StringLiteral') {
        propName = node.property.value
        accessForm = 'bracket-literal'
      } else if (node.computed) {
        unresolved.computedDynamicAccesses.push({ path: relPosix, line: lineOf(node), receiverEvidence: binding.form })
        return
      }
      if (propName && canonicalFieldSet.has(propName) && (binding.fieldSet === 'all' || binding.fieldSet.has(propName))) {
        const kind = isWriteTarget(node) ? 'write' : 'read'
        recordReference(propName, node, kind, accessForm, binding.form)
      }
    })
  }

  // 5. Final full-module pass: any MemberExpression matching a canonical
  // field name that was NOT attributed above is an unknown-receiver
  // candidate — recorded, never silently guessed as a real field reference.
  walkFullModule(ast, (node) => {
    if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return
    if (attributed.has(node)) return
    let propName = null
    if (!node.computed && node.property.type === 'Identifier') propName = node.property.name
    else if (node.computed && node.property.type === 'StringLiteral') propName = node.property.value
    if (!propName || !canonicalFieldSet.has(propName)) return
    let receiverText = 'unknown-expression'
    if (node.object.type === 'Identifier') receiverText = node.object.name
    else if (node.object.type === 'ThisExpression') receiverText = 'this'
    else if (node.object.type === 'MemberExpression' && !node.object.computed && node.object.property?.type === 'Identifier') {
      receiverText = `<expr>.${node.object.property.name}`
    }
    unresolved.candidateAccesses.push({ path: relPosix, line: lineOf(node), propertyName: propName, receiverText })
  })

  return { references, unresolved }
}

// ---------------------------------------------------------------------------
// Canonical field loading
// ---------------------------------------------------------------------------
function loadCanonicalFields() {
  assertNoSymlinkAncestors(REPO_ROOT, path.relative(REPO_ROOT, CANONICAL_FIELDS_PATH), 'canonical fields path')
  const raw = readFileSync(CANONICAL_FIELDS_PATH, 'utf8')
  const doc = JSON.parse(raw)
  assert.ok(Array.isArray(doc.fields), 'parity-settings-properties.json: fields is not an array')
  const names = doc.fields.map((f) => {
    assert.equal(typeof f.name, 'string', 'field entry missing string name')
    return f.name
  })
  const unique = new Set(names)
  assert.equal(unique.size, names.length, 'canonical field list has duplicate names')
  return { names, declaredCount: doc.counts?.declaredFields ?? names.length, sourceSha256: sha256Hex(raw) }
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------
function buildDocument({ sourceRoot, gitMeta, canonical, scanResults, shaMismatch }) {
  const byField = new Map(canonical.names.map((n) => [n, []]))
  const allUnresolved = {
    aliasAccesses: [],
    candidateAccesses: [],
    computedDynamicAccesses: [],
    destructureRestUnresolved: [],
    destructureComputedUnresolved: [],
  }
  const parseFailures = []
  let filesParsed = 0

  for (const { relPosix, result } of scanResults) {
    if (result.parseError) {
      parseFailures.push({ path: relPosix, error: result.parseError })
      continue
    }
    filesParsed += 1
    for (const ref of result.references) {
      byField.get(ref.field).push(ref)
    }
    for (const key of Object.keys(allUnresolved)) {
      allUnresolved[key].push(...result.unresolved[key])
    }
  }

  const cmp = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line)
  for (const list of byField.values()) list.sort(cmp)
  for (const list of Object.values(allUnresolved)) list.sort(cmp)

  const fields = canonical.names.map((name) => {
    const refs = byField.get(name)
    return {
      name,
      referenceStatus: refs.length > 0 ? 'observed' : 'no-observed-reference',
      referenceStatusNote:
        refs.length > 0
          ? undefined
          : 'no reference observed by this bounded scan across the prefiltered file set — NOT a claim that the field is unused anywhere in the source tree',
      references: refs.map((r) => ({
        path: r.path,
        line: r.line,
        kind: r.kind,
        accessForm: r.accessForm,
        receiverEvidence: r.receiverEvidence,
        ...(r.testTitle ? { testTitle: r.testTitle, testTitleLine: r.testTitleLine } : {}),
      })),
    }
  })

  const totalReferences = fields.reduce((sum, f) => sum + f.references.length, 0)
  const readReferences = fields.reduce((sum, f) => sum + f.references.filter((r) => r.kind === 'read').length, 0)
  const writeReferences = totalReferences - readReferences
  const byReceiverEvidence = {}
  for (const f of fields) {
    for (const r of f.references) {
      const bucket = r.receiverEvidence.split(':')[0]
      byReceiverEvidence[bucket] = (byReceiverEvidence[bucket] ?? 0) + 1
    }
  }

  const counts = {
    canonicalFieldCount: canonical.names.length,
    filesEnumerated: scanResults.length,
    filesParsed,
    filesParseFailed: parseFailures.length,
    fieldsWithAtLeastOneReference: fields.filter((f) => f.referenceStatus === 'observed').length,
    fieldsWithNoObservedReference: fields.filter((f) => f.referenceStatus === 'no-observed-reference').length,
    totalDirectReferences: totalReferences,
    readReferences,
    writeReferences,
    byReceiverEvidence,
    unresolvedAliasAccesses: allUnresolved.aliasAccesses.length,
    unresolvedCandidateAccesses: allUnresolved.candidateAccesses.length,
    unresolvedComputedDynamicAccesses: allUnresolved.computedDynamicAccesses.length,
    unresolvedDestructureRestUnresolved: allUnresolved.destructureRestUnresolved.length,
    unresolvedDestructureComputedUnresolved: allUnresolved.destructureComputedUnresolved.length,
  }

  return {
    schema: SCHEMA,
    status: 'bounded-checkpoint',
    statusNote:
      'Bounded AST routing evidence, not type-checker proof or full E2 consumer coverage. Direct references require a syntactically ' +
      'traced annotation/return type; imports must resolve relatively to src/shared/global-settings-types.ts (not a matching basename), ' +
      'and re-exports do not introduce local bindings. Type-name collisions are conservatively excluded module-wide; value-name ' +
      'collisions are excluded function-wide, including destructured and catch bindings. Pick/Omit and union field restrictions apply ' +
      'to member accesses and literal writes. Untyped local getters cannot fall back to shadowed module getters. These are bounded ' +
      'approximations, not full lexical/type resolution. Files without the raw GlobalSettings token are not scanned. No observed reference ' +
      'never means unused; counts include test/default construction sites, not just observable UI consumers. Coordinator regression tests ' +
      'exposed13 false-positive forms and passed after correction; real-corpus counts did not change. No original test or product behavior executed.',
    source: {
      root: sourceRoot,
      headSha: gitMeta.headSha,
      pinnedSha: PINNED_SOURCE_SHA,
      shaMismatch,
    },
    canonicalFieldSource: 'docs/migration/parity-settings-properties.json',
    canonicalFieldSourceSha256: canonical.sourceSha256,
    canonicalDeclaredFieldCount: canonical.declaredCount,
    scanScope: {
      description:
        'Candidate files = tracked *.ts/*.tsx files under src/ whose raw text contains the literal token "GlobalSettings" (via `git grep -lI`). ' +
        'out/ and node_modules/ are never tracked in this checkout and are never scanned.',
      filesEnumerated: scanResults.length,
      filesParsed,
      parseFailures,
    },
    methodology:
      'Two-mode AST resolution per module, no cross-file resolution: (a) does an identifier\'s own type annotation resolve to GlobalSettings ' +
      'or a field subset? (b) for an ObjectPattern destructure, does the CONTAINER type\'s named member resolve the same way? Both modes chase ' +
      'bounded same-module type-alias/interface hops (MAX depth 6) and unwrap Partial/Readonly/Required/Pick/Omit and non-null unions. A ' +
      'same-module (or same-scope parameter) getter whose declared return type resolves the same way is treated identically at its ' +
      'call sites. Every MemberExpression/OptionalMemberExpression on a confirmed receiver is classified read (default) or write (assignment/' +
      'update-expression target). Every destructured field off a confirmed container is a read; an ObjectExpression that is the direct ' +
      'initializer of a settings-typed variable, or the direct return value of a settings-typed-returning function, has its own top-level ' +
      'non-computed non-spread keys recorded as writes. Anything the two modes cannot resolve this way (untyped aliases, computed/dynamic ' +
      'keys, `...rest`, unresolved containers) is recorded in a separate unresolved bucket, never guessed into a field reference.',
    counts,
    fields,
    unresolved: allUnresolved,
    unsupportedForms: [
      'Cross-module call-target resolution is not performed: `const s = importedGetSettings()` is never traced into the imported module, even if that module\'s function has an explicit GlobalSettings-ish return type.',
      'Only bare-identifier call expressions (`getSettings()`) are traced to a getter; a method-call form (`store.getSettings()`, `deps.getSettings()`) is never resolved even when the receiver object\'s own type declares that method\'s return type as GlobalSettings-ish — e.g. `gitlab-project-recents.ts`\'s `getSettings(): Pick<GlobalSettings, \'gitlabProjects\'>` interface method is not traced at its call sites, which is why `gitlabProjects` shows no-observed-reference despite this real, present source pattern.',
      'Type-alias/interface resolution is module-global by declared name, not lexically block-scoped: a name declared MORE THAN ONCE anywhere in the module (as an alias, an interface, or both) is excluded from resolution entirely (conservatively ambiguous) rather than resolved to whichever declaration was seen first or last.',
      'A binding\'s identity is only traced within its own immediate function/program scope; a nested closure that captures an outer typed binding (without redeclaring the name) is not traced into and its accesses are absent from this census, not misattributed.',
      'Within one function/program scope, a name declared more than once (a param later shadowed by a block-local of the same name, two sibling blocks each declaring it differently) is treated as ambiguous for the WHOLE scope, not just the shadowed sub-block — this is a scope-wide approximation, not true lexical/block scoping, and can under-attribute a param that is validly used before an unrelated later same-named local appears.',
      'Canonical import evidence uses exact relative-path normalization to src/shared/global-settings-types.ts. Package aliases, barrels and re-exports are not resolved as local bindings. Generic/local/imported type-name collisions are excluded conservatively across the module; utility types may not be locally shadowed.',
      'A union type with more than one non-null alternative resolves only when EVERY alternative independently matches; the attributed field set is then the intersection across alternatives (fields only present on some alternatives are not attributed), never the first-recognized member alone.',
      'Interface `extends` clauses are not resolved — only an interface\'s own body members are inspected.',
      '`...rest` destructure elements capturing an unknown subset of fields are recorded in destructureRestUnresolved, never expanded to individual field references.',
      'Computed (bracket) access with a non-string-literal key on a confirmed settings receiver is recorded in computedDynamicAccesses with no field attributed, even though the real key range is provably a subset of the 214 fields (e.g. `key: keyof GlobalSettings`).',
      'An object-literal is treated as a write site only when it is the direct initializer of a settings-typed variable or the direct return value of a settings-typed-returning function/arrow; a literal built through an intermediate reassignment, spread-only merge, or multi-step builder contributes no per-field write evidence here (spread elements themselves are always skipped, sibling literal keys on the same object are still recorded).',
      'Files whose raw text never contains the literal token "GlobalSettings" are excluded from the scan surface entirely (not even as unresolved candidates) — a file reaching a settings field only through a fully untyped/`any`-cast or otherwise textually-indirect path is invisible to this pass.',
      'candidateAccesses (unknown-receiver) are only searched for within the same prefiltered file set as confirmed references, not across the whole src/ tree, to keep the unresolved bucket proportionate to the scan surface rather than a whole-repo property-name grep.',
    ],
    gaps: [
      'This census does not resolve nested nested nested access beyond a field\'s own top-level member expression (e.g. `settings.worktreeVisibilityDefaults.external` is recorded as a reference to `worktreeVisibilityDefaults`; the further `.external` access on its value is out of scope).',
      'IPC/RPC boundary crossings (main<->renderer) are not traced — a field read in main-process code and a field read in renderer code from the same logical settings object are recorded as independent references with no cross-process linkage claimed.',
      'No completeness or "fully mapped" claim is made for any field or for the census as a whole; see statusNote and unsupportedForms.',
    ],
  }
}

// Deliberately COMPACT (target <=220 lines): this document is a summary and
// pointer, never a re-derivation of the machine data. Every per-field
// reference, every exact line/receiver-evidence citation, and every
// unresolved-bucket entry lives ONLY in the JSON companion — repeating
// ~1000+ individual reference rows here previously produced an unreviewable
// ~2900-line file. See docs/migration/parity-settings-consumers.json for
// the full per-field reference list.
function renderMarkdown(doc) {
  const L = []
  L.push('# Parity settings consumers — bounded AST reference census (E2 consumer routing)')
  L.push('')
  L.push(
    `**Bounded checkpoint, not full-coverage closure.** Summary only — full per-field references, exact ` +
      `line/receiver-evidence citations, and unresolved-bucket entries are in the machine companion ` +
      `\`docs/migration/parity-settings-consumers.json\` (schema \`${doc.schema}\`, status \`${doc.status}\`), never ` +
      `repeated here. Read-only AST census across the frozen legacy checkout \`${doc.source.root}\` at ` +
      `\`${doc.source.headSha}\`` +
      (doc.source.shaMismatch ? ` (**MISMATCH** vs pinned \`${doc.source.pinnedSha}\`)` : ` (matches pinned baseline)`) +
      `. No implementation, no execution of any original test/app/daemon. Canonical field list loaded from ` +
      `\`${doc.canonicalFieldSource}\` (declared field count ${doc.canonicalDeclaredFieldCount}).`,
  )
  L.push('')
  L.push('## Status note')
  L.push('')
  L.push(doc.statusNote)
  L.push('')
  L.push('## Scan scope')
  L.push('')
  L.push(doc.scanScope.description)
  L.push(
    `Files enumerated: **${doc.scanScope.filesEnumerated}**; parsed: **${doc.scanScope.filesParsed}**; parse ` +
      `failures: **${doc.scanScope.parseFailures.length}**${doc.scanScope.parseFailures.length > 0 ? ' (see JSON `scanScope.parseFailures` for the list)' : ''}.`,
  )
  L.push('')
  L.push('## Methodology')
  L.push('')
  L.push(doc.methodology)
  L.push('')
  L.push('## Counts')
  L.push('')
  for (const [k, v] of Object.entries(doc.counts)) {
    if (k === 'byReceiverEvidence') {
      L.push(`- \`${k}\`: ${Object.entries(v).map(([rk, rv]) => `\`${rk}\`=${rv}`).join(', ')}`)
      continue
    }
    L.push(`- \`${k}\`: **${v}**`)
  }
  L.push('')
  L.push(
    'No percentage-complete or "fully mapped" figure is stated anywhere in this document. `no-observed-reference` ' +
      'is an explicit scan result, never an absence-of-usage claim (see Status note). Counts are reported candidly ' +
      'even where they are smaller after a correction pass than an earlier, less conservative run.',
  )
  L.push('')
  L.push('## Fields with no observed reference (this bounded scan)')
  L.push('')
  const none = doc.fields.filter((f) => f.referenceStatus === 'no-observed-reference')
  if (none.length === 0) {
    L.push('None — every canonical field had at least one observed reference in the scanned file set.')
  } else {
    L.push(none[0].referenceStatusNote + ':')
    L.push('')
    L.push(none.map((f) => `\`${f.name}\``).join(', '))
  }
  L.push('')
  L.push('## Unresolved buckets (counts only — never silently attributed to a field)')
  L.push('')
  L.push('Full itemized entries (path/line/context) for each bucket are in the JSON companion under `unresolved.<bucket>`.')
  L.push('')
  for (const [key, list] of Object.entries(doc.unresolved)) {
    L.push(`- \`${key}\`: **${list.length}**`)
  }
  L.push('')
  L.push('## Unsupported forms (enumerated, never silently dropped)')
  L.push('')
  for (const u of doc.unsupportedForms) L.push(`- ${u}`)
  L.push('')
  L.push('## Remaining gaps')
  L.push('')
  for (const g of doc.gaps) L.push(`- ${g}`)
  L.push('')
  L.push('## Full detail')
  L.push('')
  L.push(
    'Every one of the 214 canonical fields, its `referenceStatus`, and (where observed) its complete list of ' +
      '`{path, line, kind, accessForm, receiverEvidence, testTitle?}` reference entries is in ' +
      '`docs/migration/parity-settings-consumers.json` → `fields[]`, in the same canonical order as ' +
      '`parity-settings-properties.json`. This document intentionally does not repeat that data.',
  )
  L.push('')

  return L.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// Strictly read-only, strictly stdout-only: no file is ever written by this
// function under any argument combination. `--verify-json`/`--verify-md`
// only READ an already-authored artifact to compare it against a fresh
// in-memory regeneration.
async function run(argv) {
  const opts = parseArgv(argv)
  assert.ok(opts.source, 'pass --source <read-only reference checkout> or set $DROGON_SOURCE_ROOT; no implicit checkout')
  const sourceRoot = realpathSync(opts.source)
  const gitMeta = sourceGitMeta(sourceRoot)
  const shaMismatch = gitMeta.headSha !== PINNED_SOURCE_SHA
  if (shaMismatch) {
    throw new Error(`legacy source HEAD ${gitMeta.headSha} does not match pinned baseline ${PINNED_SOURCE_SHA} — refusing (no override exists)`)
  }

  const canonical = loadCanonicalFields()
  const babel = loadBabelParser()
  const files = listCandidateFiles(sourceRoot)

  const scanResults = []
  for (const relPosix of files) {
    assertNoSymlinkAncestors(sourceRoot, relPosix, 'source module')
    const absPath = assertWithinRoot(sourceRoot, relPosix, 'source module')
    const code = readFileSync(absPath, 'utf8')
    const result = analyzeModule(relPosix, code, babel.parse, canonical.names)
    scanResults.push({ relPosix, result })
  }

  const doc = buildDocument({ sourceRoot, gitMeta, canonical, scanResults, shaMismatch })
  const jsonText = JSON.stringify(doc, null, 2) + '\n'
  const md = renderMarkdown(doc)

  if (opts.verifyJsonPath || opts.verifyMdPath) {
    let ok = true
    if (opts.verifyJsonPath) {
      const existing = readFileSync(path.resolve(opts.verifyJsonPath), 'utf8')
      const matches = existing === jsonText
      ok = ok && matches
      process.stdout.write(`verify-json ${matches ? 'OK' : 'MISMATCH'}: ${opts.verifyJsonPath}\n`)
    }
    if (opts.verifyMdPath) {
      const existing = readFileSync(path.resolve(opts.verifyMdPath), 'utf8')
      const matches = existing === md
      ok = ok && matches
      process.stdout.write(`verify-md ${matches ? 'OK' : 'MISMATCH'}: ${opts.verifyMdPath}\n`)
    }
    if (!ok) {
      process.exitCode = 1
    }
    return
  }

  process.stdout.write(opts.format === 'md' ? md : jsonText)
}

const isMain = process.argv[1] && process.argv[1] !== '-' && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
if (isMain) {
  run(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`${err.stack ?? err.message}\n`)
    process.exitCode = 1
  })
}

export {
  analyzeModule,
  buildDocument,
  buildModuleContext,
  containerMemberLookup,
  loadBabelParser,
  loadCanonicalFields,
  matchGetterShape,
  matchSettingsShape,
  renderMarkdown,
  run,
  sourceGitMeta,
}
