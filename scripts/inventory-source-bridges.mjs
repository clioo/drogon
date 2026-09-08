#!/usr/bin/env node
// READ-ONLY renderer/service bridge-contract census for the Drogon parity
// audit. Closes the omissions recorded in
// docs/migration/parity-platform-audit.md §8 enumeration-coverage /
// §10 gaps register (G3 linear-bridge>60, G4 gh-bridge census, G5 api-types.ts
// authoritative census, G6 main-side handler registry), and the coordinator's
// second-pass correctness rejection of the first artifact:
//
//   1) RPC method GROUPS composed of imported sub-arrays (TERMINAL_METHODS,
//      ORCHESTRATION_METHODS, GITHUB_METHODS, ...), `defineStreamingMethod`
//      calls, and factory-function-returned arrays
//      (browser-network-tunnel.ts `createBrowserNetworkTunnelMethods()`)
//      must be followed recursively, not reported "resolved" with zero
//      methods just because the group's OWN file has no direct
//      `defineMethod(...)` call.
//   2) Main-side `ipcMain.handle/on` registrations are read (read-scope only
//      — the four owned WRITE paths are unchanged) and cross-referenced
//      against preload channels; every preload channel is either matched to
//      an exact main registration (with source anchors) or recorded
//      unresolved — never assumed disjoint by fiat.
//   3) The four flattened top-level `telemetryTrack*` functions declared
//      directly in index.ts (not inside any `*-bridge.ts` file) are walked
//      for their own `ipcRenderer.invoke(...)` channels, and bridge/domain
//      identity is cross-checked against the index.ts assembly (ground
//      truth), not solely the bridge file's own `satisfies` annotation
//      (which some files, e.g. mentu-bridge.ts, never write).
//   4) Output guards lstat the WRITE LEAF itself (never follow/overwrite a
//      symlink at the destination), walk the full ancestor chain for
//      component-boundary escapes even before directories exist, and stage
//      every write through an exclusive temp file + atomic rename — the same
//      pattern already proven in scripts/inventory-source-tests.mjs. Source
//      reads reject path traversal beyond the source root, not just
//      symlinked components.
//   5) Computed object keys are only trusted when they are literal strings;
//      a computed *identifier* key is a variable reference, never treated as
//      a literal method name. Import aliases are resolved by their ORIGINAL
//      exported name in the target module, not the local alias, when
//      following cross-file spreads (and every followed file's bytes are
//      hashed, none silently skip fileHashesSha256). Aggregate counts are
//      computed over a de-duplicated reachable-method list keyed by
//      (originFile, originAnchor), so a method reachable via more than one
//      composition path is counted once — and the artifact clearly labels
//      "syntax occurrences" (e.g. total `ipcRenderer.*` call sites parsed)
//      separately from "assembled reachable API methods" (the deduped list
//      actually wired into the exported `api` object). A disposer boolean is
//      never asserted from "any on + any removeListener in the same
//      function" — pairing requires a matching channel AND a matching
//      listener identifier between the `on`/`once` and `removeListener`
//      call sites; anything short of that is recorded
//      `unresolved-disposer-pairing` with both call sites' anchors, never
//      silently upgraded to a pairing claim.
//
// Parses the LEGACY Orca checkout (pass --source explicitly or set
// $DROGON_SOURCE_ROOT; pinned to c97906287bb7a390b25e2025b600d9fb3c25d9c3)
// with the Babel parser
// already installed in this workspace's node_modules (resolved indirectly
// through @vitejs/plugin-react, per task instruction) and emits deterministic
// artifacts into THIS repo only:
//
//   docs/migration/parity-source-bridges.json
//   docs/migration/parity-bridge-enumeration.md
//   .preflight/bridge-audit/<nonce>.json   (raw fixture run record, not proof)
//
// It never writes to the legacy source, never executes/imports/evals source
// app code, starts no daemons, installs no dependencies, and mutates nothing
// outside the three output paths above. The only external process spawned is
// `git -C <source> rev-parse HEAD` / `git -C <source> status --porcelain=v1`
// / `git -C <source> ls-files` (all read-only). Main-side `src/main/**`
// files are READ for the ipcMain census in item (2) above; this script's
// four WRITE-owned paths are unchanged (it does not gain write scope over
// any main-side file).
//
// Determinism contract: same `--source` revision + same checked-in scripts
// must reproduce byte-identical JSON and Markdown. No wall-clock timestamps
// in either artifact (the .preflight fixture record is the only place a
// nonce/timestamp appears, and it is explicitly a non-authoritative fixture).
//
// Usage:
//   node scripts/inventory-source-bridges.mjs [--source <legacy-checkout>]
//   node scripts/inventory-source-bridges.mjs --verify   # byte-identical rerun?

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
// No implicit reference checkout: pass --source explicitly or set
// $DROGON_SOURCE_ROOT (check-frozen-test-ports precedent).
const DEFAULT_SOURCE = process.env.DROGON_SOURCE_ROOT ?? null
const EXPECTED_SOURCE_SHA = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const KNOWN_UNTRACKED = new Set(['.mentu/plans/drogon-rewrite-preflight.md'])
const JSON_OUTPUT = path.join(REPO_ROOT, 'docs/migration/parity-source-bridges.json')
const MD_OUTPUT = path.join(REPO_ROOT, 'docs/migration/parity-bridge-enumeration.md')
const FIXTURE_DIR = path.join(REPO_ROOT, '.preflight/bridge-audit')
const SCHEMA = 'drogon.inventory.source-bridges.v2'

function fail(message) {
  process.stderr.write(`inventory-source-bridges: ${message}\n`)
  process.exit(1)
}

function parseArgv(argv) {
  const out = {
    source: DEFAULT_SOURCE,
    verify: false,
    expectedSha: EXPECTED_SOURCE_SHA,
    jsonOutput: JSON_OUTPUT,
    mdOutput: MD_OUTPUT,
    fixtureDir: FIXTURE_DIR,
    allowedRoot: REPO_ROOT,
    knownUntracked: KNOWN_UNTRACKED,
    stagingSuffix: process.env.INVENTORY_BRIDGES_STAGING_SUFFIX,
    skipMainCensus: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--source') {
      out.source = argv[++i]
      assert.ok(out.source, '--source requires a path')
    } else if (arg === '--verify') {
      out.verify = true
    } else if (arg === '--expected-sha') {
      // Test-only override: production invocations rely on the default
      // frozen baseline. Never used to point the real audit at an
      // unreviewed revision — this only lets unit tests exercise the
      // freeze-check logic against throwaway fixture repos.
      out.expectedSha = argv[++i]
      assert.ok(out.expectedSha, '--expected-sha requires a value')
    } else if (arg === '--json-output') {
      out.jsonOutput = argv[++i]
      assert.ok(out.jsonOutput, '--json-output requires a path')
    } else if (arg === '--md-output') {
      out.mdOutput = argv[++i]
      assert.ok(out.mdOutput, '--md-output requires a path')
    } else if (arg === '--fixture-dir') {
      out.fixtureDir = argv[++i]
      assert.ok(out.fixtureDir, '--fixture-dir requires a path')
    } else if (arg === '--allowed-root') {
      out.allowedRoot = argv[++i]
      assert.ok(out.allowedRoot, '--allowed-root requires a path')
    } else if (arg === '--allow-untracked') {
      out.knownUntracked = new Set([...out.knownUntracked, argv[++i]])
    } else if (arg === '--skip-main-census') {
      // Test-only: the main-side census walks the whole src/main tree; unit
      // fixtures that only need to exercise preload/RPC logic can skip it.
      out.skipMainCensus = true
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: node scripts/inventory-source-bridges.mjs [--source <legacy-checkout>] [--verify]\n',
      )
      process.exit(0)
    } else {
      fail(`unknown argument: ${arg}`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Source-read guards: no path component from the source root down to a leaf
// file may be a symlink, and the resolved leaf must not escape the source
// root (rejects `..`-style traversal beyond root, not just symlinks).
// ---------------------------------------------------------------------------
function assertNoSymlinkAncestors(root, relPath) {
  const parts = relPath.split('/')
  let cursor = root
  for (const part of parts) {
    cursor = path.join(cursor, part)
    let st
    try {
      st = lstatSync(cursor)
    } catch (error) {
      fail(`read failure guarding ${relPath}: ${(error && error.message) || error}`)
    }
    if (st.isSymbolicLink()) {
      fail(`refusing symlinked path component: ${cursor}`)
    }
  }
}

function assertWithinRoot(root, relPath) {
  const resolvedRoot = path.resolve(root)
  const resolvedFull = path.resolve(root, relPath)
  if (resolvedFull !== resolvedRoot && !resolvedFull.startsWith(resolvedRoot + path.sep)) {
    fail(`refusing to read outside source root (path traversal): ${relPath}`)
  }
}

// ---------------------------------------------------------------------------
// Output guards, mirroring the proven pattern in
// scripts/inventory-source-tests.mjs: lexical containment check first (no
// FS calls), then lstat the LEAF itself (never follow/overwrite a symlink
// or dangling symlink at the destination — lstat succeeds on dangling links
// too, so this catches both), then walk UP to the first EXISTING ancestor,
// realpath it, and reconstruct the full intended destination with the
// not-yet-created components appended — this catches a symlinked
// intermediate directory even before mkdir creates the rest of the chain.
// Every check runs BEFORE any mkdir/write.
// ---------------------------------------------------------------------------
function assertLexicalContainment(resolvedPath, allowedRoot, sourceRootReal, label) {
  if (resolvedPath !== allowedRoot && !resolvedPath.startsWith(allowedRoot + path.sep)) {
    fail(`refusing to write ${label}: escapes allowed root: ${resolvedPath}`)
  }
  if (resolvedPath === sourceRootReal || resolvedPath.startsWith(sourceRootReal + path.sep)) {
    fail(`refusing to write ${label}: lands inside the source tree: ${resolvedPath}`)
  }
}

// Walks from `dirPath` UP toward `allowedRoot`, stopping at whichever comes
// first: an ancestor that already exists, or `allowedRoot` itself. The walk
// is deliberately bounded at `allowedRoot` — ABOVE that boundary lie paths
// this script has no opinion about (e.g. on macOS, the real tmpdir used by
// unit-test fixtures sits under `/private/var/...`, itself reached through
// OS-level symlinks like `/tmp` and `/var` that have nothing to do with this
// script's guard; walking past `allowedRoot` to interrogate them produces
// false positives, not real safety). Ancestors strictly between `dirPath`
// and `allowedRoot` that don't exist yet are exactly what `mkdirSync`
// (called by the caller right after this check) is about to create; any
// that DO already exist are realpath'd so a symlinked intermediate
// directory is still caught before that mkdir/write.
function assertAncestorChainSafe(dirPath, allowedRoot, sourceRootReal, label) {
  let ancestor = dirPath
  const missing = []
  while (ancestor !== allowedRoot && ancestor.startsWith(allowedRoot + path.sep)) {
    let st = null
    try {
      st = lstatSync(ancestor)
    } catch {
      st = null
    }
    if (st !== null) break
    missing.unshift(path.basename(ancestor))
    ancestor = path.dirname(ancestor)
  }
  let ancestorReal
  try {
    ancestorReal = realpathSync(ancestor)
  } catch (error) {
    fail(`cannot resolve existing ancestor for ${label}: ${(error && error.message) || error}`)
  }
  const destination = path.resolve(ancestorReal, ...missing)
  if (destination === sourceRootReal || destination.startsWith(sourceRootReal + path.sep)) {
    fail(`refusing to write ${label}: ancestor chain resolves inside the source tree: ${destination}`)
  }
  if (destination !== allowedRoot && !destination.startsWith(allowedRoot + path.sep)) {
    fail(`refusing to write ${label}: ancestor chain escapes allowed root via symlink: ${destination}`)
  }
  return destination
}

function resolveSourceRootReal(sourceRoot) {
  try {
    return realpathSync(sourceRoot)
  } catch {
    return path.resolve(sourceRoot)
  }
}

// Directory targets (FIXTURE_DIR, and the parent dirs of the JSON/MD leaf
// files): the directory itself, if it already exists, must not be a symlink.
function assertSafeOutputDir(dirPath, allowedRoot, sourceRoot) {
  const resolved = path.resolve(dirPath)
  const sourceRootReal = resolveSourceRootReal(sourceRoot)
  assertLexicalContainment(resolved, allowedRoot, sourceRootReal, `directory ${dirPath}`)
  try {
    const st = lstatSync(resolved)
    if (st.isSymbolicLink()) {
      fail(`refusing to write through a symlinked directory: ${dirPath}`)
    }
    if (!st.isDirectory()) {
      fail(`refusing to use a non-directory as an output directory: ${dirPath}`)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') fail(`cannot stat output directory: ${(error && error.message) || error}`)
  }
  // `resolved` IS the directory being validated (not a file whose parent we
  // check) — walk its own chain up to allowedRoot, not its parent's.
  assertAncestorChainSafe(resolved, allowedRoot, sourceRootReal, `directory ${dirPath}`)
  return resolved
}

// Leaf file targets: the leaf itself, if it exists, must be lstat-checked
// (never a symlink, never a directory, never any non-regular file) BEFORE
// any staged write is attempted, and the full ancestor chain up to
// allowedRoot must be re-verified (mirrors the sibling script's "recheck
// after creation" discipline, done here before creation).
function assertSafeOutputFile(filePath, allowedRoot, sourceRoot) {
  const resolved = path.resolve(filePath)
  const sourceRootReal = resolveSourceRootReal(sourceRoot)
  assertLexicalContainment(resolved, allowedRoot, sourceRootReal, `file ${filePath}`)
  try {
    const st = lstatSync(resolved)
    if (st.isSymbolicLink()) {
      fail(`refusing to write through a symlinked output file (leaf lstat): ${filePath}`)
    }
    if (st.isDirectory()) {
      fail(`refusing to overwrite a directory with a file write: ${filePath}`)
    }
    if (!st.isFile()) {
      fail(`refusing to overwrite non-regular output: ${filePath}`)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') fail(`cannot stat output file: ${(error && error.message) || error}`)
  }
  assertAncestorChainSafe(path.dirname(resolved), allowedRoot, sourceRootReal, `file ${filePath}`)
  return resolved
}

// Atomic staged write: an exclusive (`wx`) random-sibling temp file, so a
// preexisting file or symlink at the temp path fails closed instead of being
// followed or overwritten, then an atomic rename onto the final path (rename
// replaces whatever inode is at the destination rather than following a
// symlink there). Mirrors scripts/inventory-source-tests.mjs exactly.
function stageAndWriteFile(resolvedPath, contents, stagingSuffixOverride) {
  const dir = path.dirname(resolvedPath)
  let staging = ''
  let stagedFd = null
  let stagedCreated = false
  for (let attempt = 0; attempt < 10 && stagedFd === null; attempt += 1) {
    const tag = stagingSuffixOverride ?? `${process.pid}-${randomBytes(8).toString('hex')}`
    staging = path.join(dir, `.inventory-bridges-${tag}.tmp`)
    try {
      stagedFd = openSync(staging, 'wx', 0o600)
      stagedCreated = true
    } catch (error) {
      if (error.code !== 'EEXIST') fail(`cannot stage output: ${(error && error.message) || error}`)
      if (stagingSuffixOverride !== undefined) {
        fail(`refusing to stage output: temp path already exists: ${staging}`)
      }
    }
  }
  if (stagedFd === null) fail('cannot stage output: no unique temp name after 10 attempts')
  try {
    writeSync(stagedFd, contents, null, 'utf8')
  } catch (error) {
    try {
      closeSync(stagedFd)
    } catch {
      // best effort
    }
    try {
      if (stagedCreated) unlinkSync(staging)
    } catch {
      // best effort
    }
    fail(`cannot write output: ${(error && error.message) || error}`)
  }
  try {
    closeSync(stagedFd)
  } catch (error) {
    fail(`cannot write output: ${(error && error.message) || error}`)
  }
  try {
    renameSync(staging, resolvedPath)
  } catch (error) {
    fail(`cannot finalize output: ${(error && error.message) || error}`)
  }
}

// ---------------------------------------------------------------------------
// git (read-only) helpers against the LEGACY source
// ---------------------------------------------------------------------------
function gitText(source, args) {
  try {
    return execFileSync('git', ['-C', source, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch (error) {
    fail(`git ${args.join(' ')} failed: ${(error && error.message) || error}`)
  }
}

function sourceGitMeta(source, expectedSha, knownUntracked) {
  const head = gitText(source, ['rev-parse', 'HEAD']).trim()
  if (!/^[0-9a-f]{40}$/.test(head)) {
    fail(`git rev-parse HEAD did not return a SHA: ${head}`)
  }
  const porcelain = gitText(source, ['status', '--porcelain=v1', '--untracked-files=normal'])
  const lines = porcelain.split('\n').filter((line) => line.length > 0)
  const trackedRows = lines.filter((line) => !line.startsWith('??') && !line.startsWith('!!'))
  const untrackedRows = lines
    .filter((line) => line.startsWith('??'))
    .map((line) => line.slice(3))
  const unexpectedUntracked = untrackedRows.filter((row) => !knownUntracked.has(row))
  if (head !== expectedSha) {
    fail(
      `legacy source HEAD ${head} does not match the frozen audit baseline ${expectedSha}; ` +
        'this script refuses to enumerate an unfrozen reference checkout',
    )
  }
  if (trackedRows.length > 0) {
    fail(`legacy source has tracked dirty changes, refusing to enumerate: ${trackedRows.join('; ')}`)
  }
  if (unexpectedUntracked.length > 0) {
    fail(`legacy source has unexpected untracked files: ${unexpectedUntracked.join('; ')}`)
  }
  return { fullSha: head, trackedDirty: trackedRows.length > 0, untrackedRows }
}

function listSourceFiles(source, subdir) {
  const out = gitText(source, ['ls-files', '--', subdir])
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .sort()
}

// Shared cache so every read (top-level, cross-file spread target,
// cross-file constant resolution, main-side census file) hashes exactly
// once and is recorded exactly once — no read path is silently exempt from
// fileHashesSha256.
function readSourceFile(source, relPath, fileHashes) {
  assertWithinRoot(source, relPath)
  assertNoSymlinkAncestors(source, relPath)
  const full = path.join(source, relPath)
  let bytes
  try {
    bytes = readFileSync(full)
  } catch (error) {
    fail(`read failure for ${relPath}: ${(error && error.message) || error}`)
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (fileHashes && !(relPath in fileHashes)) fileHashes[relPath] = sha256
  return { text: bytes.toString('utf8'), sha256 }
}

// ---------------------------------------------------------------------------
// Babel resolution: exactly the createRequire(createRequire(...)) chain the
// task specifies, so no new dependency is installed by this script.
// ---------------------------------------------------------------------------
function loadBabel() {
  const outerRequire = createRequire(path.resolve(REPO_ROOT, 'apps/desktop/package.json'))
  const pluginReactEntry = outerRequire.resolve('@vitejs/plugin-react')
  const innerRequire = createRequire(pluginReactEntry)
  const parser = innerRequire('@babel/parser')
  const traverseModule = innerRequire('@babel/traverse')
  const generatorModule = innerRequire('@babel/generator')
  const traverse = traverseModule.default || traverseModule
  const generate = (generatorModule.default || generatorModule).default || generatorModule.default || generatorModule
  return { parser, traverse, generate }
}

const BABEL = loadBabel()
const AST_CACHE = new Map() // relPath -> ast (reparse guard: parse each file's AST once)

function parseTs(text, relPath) {
  if (AST_CACHE.has(relPath)) return AST_CACHE.get(relPath)
  let ast
  try {
    ast = BABEL.parser.parse(text, {
      sourceType: 'module',
      plugins: ['typescript'],
      errorRecovery: false,
    })
  } catch (error) {
    fail(`Babel parse failure in ${relPath}: ${(error && error.message) || error}`)
  }
  AST_CACHE.set(relPath, ast)
  return ast
}

function snippet(node, text) {
  if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return null
  return text.slice(node.start, node.end)
}

function moduleToRelPath(baseDir, specifier) {
  if (!specifier || !specifier.startsWith('.')) return null
  const joined = path.posix.normalize(path.posix.join(baseDir, specifier))
  return `${joined}.ts`
}

// ---------------------------------------------------------------------------
// Import maps (alias-correct): localName -> { module, importedName }.
// `importedName` is the ORIGINAL export name in the target module — required
// so `import { widgetListApi as aliasedName } from './x'; ...aliasedName`
// looks up `export const widgetListApi` in `./x`, not `export const
// aliasedName`.
// ---------------------------------------------------------------------------
function collectImportMap(ast) {
  const map = new Map()
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        const importedName =
          spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value
        map.set(spec.local.name, { module: node.source.value, importedName })
      } else if (spec.type === 'ImportDefaultSpecifier') {
        map.set(spec.local.name, { module: node.source.value, importedName: 'default' })
      }
    }
  }
  return map
}

// Local (same-file) `const FOO = 'literal'` declarations, so identifier
// refs (channel args, computed keys) resolve without chasing cross-file
// imports when the constant is declared right there.
function collectLocalStringConsts(ast) {
  const map = new Map()
  for (const rawNode of ast.program.body) {
    // `export const X = 'literal'` parses as ExportNamedDeclaration wrapping
    // a VariableDeclaration — unwrap it, otherwise every EXPORTED channel
    // constant (the common case for shared/*-channel.ts files) is invisible
    // here and cross-file channel resolution silently fails for all of them.
    const node = rawNode.type === 'ExportNamedDeclaration' && rawNode.declaration ? rawNode.declaration : rawNode
    if (node.type !== 'VariableDeclaration') continue
    for (const decl of node.declarations) {
      if (decl.id.type === 'Identifier' && decl.init && decl.init.type === 'StringLiteral') {
        map.set(decl.id.name, decl.init.value)
      }
    }
  }
  return map
}

const MAX_CONST_RESOLUTION_DEPTH = 6

// Generic cross-file string-constant resolver, used both for preload/main
// channel identifier refs and for computed-identifier object keys. Depth-
// and cycle-guarded; every followed file is hashed via `fileHashes`.
function resolveIdentifierToStringLiteral({ source, relPath, importMap, localConstMap, name, depth, visiting, fileHashes }) {
  if (localConstMap.has(name)) {
    return { kind: 'resolved-const-ref', value: localConstMap.get(name), refName: name, resolvedIn: relPath }
  }
  const imported = importMap.get(name)
  const visitKey = `${relPath}::${name}`
  if (!imported || depth >= MAX_CONST_RESOLUTION_DEPTH || visiting.has(visitKey)) {
    return { kind: 'unresolved-identifier-ref', value: null, refName: name }
  }
  const targetRelPath = moduleToRelPath(path.posix.dirname(relPath), imported.module)
  if (!targetRelPath) return { kind: 'unresolved-identifier-ref', value: null, refName: name }
  let targetRead
  try {
    targetRead = readSourceFile(source, targetRelPath, fileHashes)
  } catch {
    return { kind: 'unresolved-identifier-ref', value: null, refName: name, targetFile: targetRelPath }
  }
  const targetAst = parseTs(targetRead.text, targetRelPath)
  const targetLocalConstMap = collectLocalStringConsts(targetAst)
  // The target's export might itself just be a re-export alias; check both
  // its own local consts (matched by the ORIGINAL imported name) and, if
  // absent, recurse through its own import map under the same original name.
  if (targetLocalConstMap.has(imported.importedName)) {
    return {
      kind: 'resolved-const-ref',
      value: targetLocalConstMap.get(imported.importedName),
      refName: name,
      resolvedIn: targetRelPath,
    }
  }
  const targetImportMap = collectImportMap(targetAst)
  return resolveIdentifierToStringLiteral({
    source,
    relPath: targetRelPath,
    importMap: targetImportMap,
    localConstMap: targetLocalConstMap,
    name: imported.importedName,
    depth: depth + 1,
    visiting: new Set([...visiting, visitKey]),
    fileHashes,
  })
}

// ---------------------------------------------------------------------------
// Bridge implementation extraction (*-bridge.ts)
// ---------------------------------------------------------------------------
const IPC_CALL_KINDS = new Set(['invoke', 'send', 'sendSync', 'on', 'once', 'removeListener'])
const DIRECTION_BY_KIND = {
  invoke: 'request-response (renderer->main, awaits reply)',
  send: 'fire-and-forget (renderer->main, no reply)',
  sendSync: 'blocking-request (renderer->main, synchronous)',
  on: 'event-subscription (main->renderer push)',
  once: 'event-subscription-once (main->renderer push, single-fire)',
  removeListener: 'disposer (subscription teardown, not a channel direction)',
}

function findEnclosingConditionSnippet(path_, text) {
  let cur = path_.parentPath
  let depth = 0
  while (cur && depth < 4) {
    if (cur.isIfStatement() || cur.isConditionalExpression()) {
      return snippet(cur.node.test, text)
    }
    cur = cur.parentPath
    depth += 1
  }
  return null
}

function resolveChannelArg(argNode, text, ctx) {
  if (!argNode) return { kind: 'missing', value: null }
  if (argNode.type === 'StringLiteral') {
    return { kind: 'literal', value: argNode.value }
  }
  if (argNode.type === 'Identifier') {
    return resolveIdentifierToStringLiteral({ ...ctx, name: argNode.name, depth: 0, visiting: new Set() })
  }
  return { kind: 'unresolved-dynamic', value: null, raw: snippet(argNode, text) }
}

function extractIpcCallsInFunction(fnPath, text, ctx) {
  const calls = []
  fnPath.traverse({
    CallExpression(callPath) {
      const callee = callPath.node.callee
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'ipcRenderer' &&
        callee.property.type === 'Identifier' &&
        IPC_CALL_KINDS.has(callee.property.name)
      ) {
        const kind = callee.property.name
        const channel = resolveChannelArg(callPath.node.arguments[0], text, ctx)
        // Only on/once/removeListener carry a listener function as their
        // 2nd argument; invoke/send/sendSync's 2nd+ arguments are payload
        // data, never a listener — recording them here would be a false
        // signal for disposer-pairing matching.
        const listenerArg = kind === 'on' || kind === 'once' || kind === 'removeListener' ? callPath.node.arguments[1] : null
        calls.push({
          kind,
          direction: DIRECTION_BY_KIND[kind],
          channel,
          listenerRef: listenerArg && listenerArg.type === 'Identifier' ? listenerArg.name : null,
          conditionSnippet: findEnclosingConditionSnippet(callPath, text),
          anchor: callPath.node.loc ? callPath.node.loc.start.line : null,
        })
      }
    },
  })
  return calls
}

// A disposer boolean asserted from "any on + any removeListener in the same
// function" is not pairing proof (two independent subscriptions in one
// method would satisfy that trivially). Real pairing requires a matching
// resolved channel value AND a matching listener identifier between an
// on/once call and a removeListener call.
function computeDisposerPairing(calls) {
  const onCalls = calls.filter((c) => c.kind === 'on' || c.kind === 'once')
  const removeCalls = calls.filter((c) => c.kind === 'removeListener')
  if (onCalls.length === 0 && removeCalls.length === 0) return { status: 'no-subscription-calls' }
  if (onCalls.length === 0 || removeCalls.length === 0) {
    return {
      status: 'unresolved-disposer-pairing',
      reason: onCalls.length === 0 ? 'removeListener call(s) with no on/once call in this method' : 'on/once call(s) with no removeListener call in this method',
      onAnchors: onCalls.map((c) => c.anchor),
      removeAnchors: removeCalls.map((c) => c.anchor),
    }
  }
  const pairs = []
  for (const onCall of onCalls) {
    for (const rmCall of removeCalls) {
      const channelResolved = onCall.channel.value != null && rmCall.channel.value != null
      const channelMatch = channelResolved && onCall.channel.value === rmCall.channel.value
      const listenerMatch = onCall.listenerRef != null && onCall.listenerRef === rmCall.listenerRef
      if (channelMatch && listenerMatch) {
        pairs.push({ onAnchor: onCall.anchor, removeAnchor: rmCall.anchor, channel: onCall.channel.value, listenerRef: onCall.listenerRef })
      }
    }
  }
  if (pairs.length > 0) return { status: 'paired', pairs }
  return {
    status: 'unresolved-disposer-pairing',
    reason: 'on/once and removeListener calls present but no channel+listener match could be confirmed by source anchor',
    onAnchors: onCalls.map((c) => c.anchor),
    removeAnchors: removeCalls.map((c) => c.anchor),
  }
}

function classifyMethodValue(propPath, text, ctx) {
  const value = propPath.node.value
  const isFn = value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression'
  if (!isFn) {
    return {
      resolution: 'non-function-property',
      raw: snippet(value, text),
      ipcCalls: [],
    }
  }
  const calls = extractIpcCallsInFunction(propPath.get('value'), text, ctx)
  if (calls.length === 0) {
    // Delegated to an imported helper (e.g. subscribeRuntimeEnvironmentFromPreload)
    // or another non-ipcRenderer call: record the callee(s), not silently drop.
    const delegatedCallees = new Set()
    propPath.get('value').traverse({
      CallExpression(callPath) {
        const callee = callPath.node.callee
        if (callee.type === 'Identifier') delegatedCallees.add(callee.name)
        else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          delegatedCallees.add(`.${callee.property.name}`)
        }
      },
    })
    return {
      resolution: delegatedCallees.size > 0 ? 'delegated-unresolved' : 'no-ipc-call-found',
      delegatedCallees: Array.from(delegatedCallees).sort(),
      ipcCalls: [],
    }
  }
  return {
    resolution: 'resolved',
    ipcCalls: calls,
    disposerPairing: computeDisposerPairing(calls),
  }
}

function findSatisfiesDomain(declaratorPath) {
  // `export const xApi = {...} satisfies PreloadApi['domain']` or
  // `satisfies PreloadApi`
  let node = declaratorPath.node.init
  if (node && node.type === 'TSSatisfiesExpression') {
    const t = node.typeAnnotation
    if (t.type === 'TSIndexedAccessType' && t.indexType.type === 'TSLiteralType' && t.indexType.literal.type === 'StringLiteral') {
      return t.indexType.literal.value
    }
    if (t.type === 'TSTypeReference' && t.typeName.type === 'Identifier') {
      return `(type:${t.typeName.name})`
    }
  }
  return null
}

// Finds `export const <exportName> = {...}` (optionally `satisfies X` or a
// plain `: SomeType` annotation, e.g. mentu-bridge.ts's `export const
// mentuApi: MentuApi = {...}`) inside an already-parsed AST.
function findExportedObjectDeclarator(ast, exportedName) {
  let found = null
  BABEL.traverse(ast, {
    ExportNamedDeclaration(exportPath) {
      if (found) return
      const decl = exportPath.node.declaration
      if (!decl || decl.type !== 'VariableDeclaration') return
      for (const [idx, declarator] of decl.declarations.entries()) {
        if (!(declarator.id.type === 'Identifier' && declarator.id.name === exportedName)) continue
        let init = declarator.init
        if (init && init.type === 'TSSatisfiesExpression') init = init.expression
        if (!init || init.type !== 'ObjectExpression') continue
        const declaratorPath = exportPath.get(`declaration.declarations.${idx}`)
        found = { declarator, declaratorPath, init }
      }
    },
  })
  return found
}

// Extracts an object property's key: only a plain identifier key
// (`{foo: ...}`), a literal string key (`{'foo': ...}` or the computed form
// `{['foo']: ...}`), or a resolvable computed identifier reference
// (`{[SOME_CONST]: ...}`) counts as a real name. A COMPUTED identifier key
// (`prop.computed === true` and the key node is itself an `Identifier`) is a
// variable reference, not a literal — treating its `.name` as the method
// name would silently fabricate a method that doesn't exist under that
// string at runtime.
function extractPropertyKeyName(prop, ctx) {
  const key = prop.key
  if (!prop.computed) {
    if (key.type === 'Identifier') return { name: key.name, resolution: 'literal' }
    if (key.type === 'StringLiteral') return { name: key.value, resolution: 'literal' }
    return { name: null, resolution: 'unresolved-non-identifier-key' }
  }
  // Computed key.
  if (key.type === 'StringLiteral') return { name: key.value, resolution: 'literal-computed' }
  if (key.type === 'NumericLiteral') return { name: String(key.value), resolution: 'literal-computed' }
  if (key.type === 'Identifier') {
    const resolved = resolveIdentifierToStringLiteral({ ...ctx, name: key.name, depth: 0, visiting: new Set() })
    if (resolved.kind === 'resolved-const-ref') {
      return { name: resolved.value, resolution: 'resolved-computed-const-ref', refName: key.name }
    }
    return { name: null, resolution: 'unresolved-computed-identifier-key', refName: key.name }
  }
  return { name: null, resolution: 'unresolved-computed-expression-key' }
}

const MAX_SPREAD_DEPTH = 6

// Extracts the method list of an already-located object literal, resolving
// same-file property values (invoke/send/sendSync/on calls) AND one-or-more
// levels of cross-file `...someImportedApi` object spreads by statically
// following the spread identifier — via its ORIGINAL exported name, so
// aliased imports resolve correctly — through the file's import map into
// the target module and recursing into ITS exported object of that name.
// Depth-guarded and read-guarded (same symlink/hash discipline as every
// other source read in this script; every followed file's bytes are hashed
// into `fileHashes`); anything that still isn't a plain
// ObjectProperty/ObjectMethod/resolvable-spread is recorded unresolved,
// never silently dropped.
function extractObjectMethods({ source, relPath, text, init, objPath, importMap, localConstMap, depth, visiting, fileHashes }) {
  const ctx = { source, relPath, importMap, localConstMap, fileHashes }
  const methods = []
  for (const [pIdx, prop] of init.properties.entries()) {
    if (prop.type === 'SpreadElement' && prop.argument.type === 'Identifier') {
      const localName = prop.argument.name
      const imported = importMap.get(localName)
      const visitKey = `${relPath}::${localName}`
      if (!imported || depth >= MAX_SPREAD_DEPTH || visiting.has(visitKey)) {
        methods.push({
          name: '(unresolved-spread)',
          resolution: imported ? 'unresolved-spread-depth-or-cycle' : 'unresolved-spread-non-local-import',
          raw: snippet(prop, text),
          spreadOf: localName,
          anchor: prop.loc ? prop.loc.start.line : null,
        })
        continue
      }
      const targetRelPath = moduleToRelPath(path.posix.dirname(relPath), imported.module)
      if (!targetRelPath) {
        methods.push({
          name: '(unresolved-spread)',
          resolution: 'unresolved-spread-non-relative-import',
          raw: snippet(prop, text),
          spreadOf: localName,
          anchor: prop.loc ? prop.loc.start.line : null,
        })
        continue
      }
      let targetRead
      try {
        targetRead = readSourceFile(source, targetRelPath, fileHashes)
      } catch {
        methods.push({
          name: '(unresolved-spread)',
          resolution: 'unresolved-spread-read-failure',
          raw: snippet(prop, text),
          spreadOf: localName,
          targetFile: targetRelPath,
          anchor: prop.loc ? prop.loc.start.line : null,
        })
        continue
      }
      const targetAst = parseTs(targetRead.text, targetRelPath)
      // Look up the ORIGINAL exported name in the target module, not the
      // local alias used at the spread site.
      const targetFound = findExportedObjectDeclarator(targetAst, imported.importedName)
      if (!targetFound) {
        methods.push({
          name: '(unresolved-spread)',
          resolution: 'unresolved-spread-export-not-found',
          raw: snippet(prop, text),
          spreadOf: localName,
          spreadOfExportedName: imported.importedName,
          targetFile: targetRelPath,
          anchor: prop.loc ? prop.loc.start.line : null,
        })
        continue
      }
      const targetImportMap = collectImportMap(targetAst)
      const targetLocalConstMap = collectLocalStringConsts(targetAst)
      const targetObjPath = targetFound.declaratorPath.get('init.expression').node
        ? targetFound.declaratorPath.get('init.expression')
        : targetFound.declaratorPath.get('init')
      const nested = extractObjectMethods({
        source,
        relPath: targetRelPath,
        text: targetRead.text,
        init: targetFound.init,
        objPath: targetObjPath,
        importMap: targetImportMap,
        localConstMap: targetLocalConstMap,
        depth: depth + 1,
        visiting: new Set([...visiting, visitKey]),
        fileHashes,
      })
      for (const m of nested) methods.push({ ...m, spreadFrom: targetRelPath })
      continue
    }
    if (prop.type !== 'ObjectProperty' && prop.type !== 'ObjectMethod') {
      methods.push({
        name: '(non-property-member)',
        resolution: 'unresolved-spread-or-computed',
        raw: snippet(prop, text),
        anchor: prop.loc ? prop.loc.start.line : null,
      })
      continue
    }
    const keyResult = extractPropertyKeyName(prop, ctx)
    const propPath = objPath.get(`properties.${pIdx}`)
    const classification =
      prop.type === 'ObjectMethod'
        ? { resolution: 'resolved', ipcCalls: extractIpcCallsInFunction(propPath, text, ctx), disposerPairing: computeDisposerPairing(extractIpcCallsInFunction(propPath, text, ctx)) }
        : classifyMethodValue(propPath, text, ctx)
    methods.push({
      name: keyResult.name === null ? `(${keyResult.resolution})` : keyResult.name,
      keyResolution: keyResult.resolution,
      originFile: relPath,
      originAnchor: prop.loc ? prop.loc.start.line : null,
      anchor: prop.loc ? prop.loc.start.line : null,
      ...classification,
    })
  }
  return methods
}

function extractImportedBridgeAlias({ source, relPath, text, declarator, init, importMap, fileHashes, depth, visiting }) {
  const unresolved = (reason, targetFile) => [{
    name: '(unresolved-object-alias)',
    resolution: `unresolved-object-alias-${reason}`,
    aliasOf: init.name,
    ...(targetFile ? { targetFile } : {}),
    originFile: relPath,
    originAnchor: declarator.loc?.start.line ?? null,
    anchor: declarator.loc?.start.line ?? null,
    raw: snippet(init, text),
    ipcCalls: [],
  }]
  const visitKey = `${relPath}::${declarator.id.name}`
  if (depth >= MAX_SPREAD_DEPTH || visiting.has(visitKey)) {
    return unresolved('depth-or-cycle')
  }
  const imported = importMap.get(init.name)
  if (!imported) return unresolved('non-imported-identifier')
  const targetFile = moduleToRelPath(path.posix.dirname(relPath), imported.module)
  if (!targetFile) return unresolved('non-relative-import')
  let targetRead
  try {
    targetRead = readSourceFile(source, targetFile, fileHashes)
  } catch {
    return unresolved('read-failure', targetFile)
  }
  const exports = extractBridgeFile(source, targetFile, targetRead.text, fileHashes, {
    depth: depth + 1,
    visiting: new Set([...visiting, visitKey]),
    exportFilter: imported.importedName,
  })
  const target = exports.find((entry) => entry.exportName === imported.importedName)
  return target?.methods ?? unresolved('export-not-found', targetFile)
}

function extractBridgeFile(source, relPath, text, fileHashes, { depth = 0, visiting = new Set(), exportFilter = null } = {}) {
  const ast = parseTs(text, relPath)
  const localConstMap = collectLocalStringConsts(ast)
  const importMap = collectImportMap(ast)
  const exported = []
  BABEL.traverse(ast, {
    ExportNamedDeclaration(exportPath) {
      const decl = exportPath.node.declaration
      if (!decl || decl.type !== 'VariableDeclaration') return
      for (const [idx, declarator] of decl.declarations.entries()) {
        if (exportFilter && (declarator.id.type !== 'Identifier' || declarator.id.name !== exportFilter)) continue
        let init = declarator.init
        if (init && init.type === 'TSSatisfiesExpression') init = init.expression
        if (!init || (init.type !== 'ObjectExpression' && init.type !== 'Identifier')) continue
        const declaratorPath = exportPath.get(`declaration.declarations.${idx}`)
        const domainFromSatisfies = findSatisfiesDomain(declaratorPath)
        const objPath = declaratorPath.get('init.expression').node ? declaratorPath.get('init.expression') : declaratorPath.get('init')
        const methods = init.type === 'Identifier'
          ? extractImportedBridgeAlias({ source, relPath, text, declarator, init, importMap, fileHashes, depth, visiting })
          : extractObjectMethods({
          source,
          relPath,
          text,
          init,
          objPath,
          importMap,
          localConstMap,
          depth,
          visiting,
          fileHashes,
        })
        exported.push({
          exportName: declarator.id.type === 'Identifier' ? declarator.id.name : '(pattern-unresolved)',
          domainFromSatisfies,
          anchor: decl.loc ? decl.loc.start.line : null,
          methods,
        })
      }
    },
  })
  return exported
}

// ---------------------------------------------------------------------------
// *-api.ts type-only extraction: `export type XApi = { ... }`
// ---------------------------------------------------------------------------
function extractApiTypeFile(relPath, text) {
  const ast = parseTs(text, relPath)
  const types = []
  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue
    const decl = node.declaration
    if (decl.type !== 'TSTypeAliasDeclaration') continue
    const members = []
    const literal = decl.typeAnnotation
    if (literal.type === 'TSTypeLiteral') {
      for (const member of literal.members) {
        if (member.type === 'TSPropertySignature' || member.type === 'TSMethodSignature') {
          const key = member.key
          if (!member.computed && (key.type === 'Identifier' || key.type === 'StringLiteral')) {
            members.push({
              name: key.type === 'Identifier' ? key.name : key.value,
              anchor: member.loc ? member.loc.start.line : null,
            })
          } else {
            members.push({ name: '(computed-key-unresolved)', anchor: member.loc ? member.loc.start.line : null })
          }
        } else {
          members.push({ name: '(non-signature-member-unresolved)', anchor: member.loc ? member.loc.start.line : null })
        }
      }
    } else {
      members.push({ name: '(non-type-literal-unresolved)', anchor: decl.loc ? decl.loc.start.line : null })
    }
    types.push({ typeName: decl.id.name, anchor: decl.loc ? decl.loc.start.line : null, members })
  }
  return types
}

// ---------------------------------------------------------------------------
// src/preload/api-types.ts: authoritative PreloadApi domain census (G5)
// ---------------------------------------------------------------------------
function extractPreloadApiType(text) {
  const ast = parseTs(text, 'src/preload/api-types.ts')
  const importMap = new Map() // localTypeName -> module specifier
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        importMap.set(spec.local.name, node.source.value)
      }
    }
  }
  let domains = null
  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue
    const decl = node.declaration
    if (decl.type === 'TSTypeAliasDeclaration' && decl.id.name === 'PreloadApi') {
      domains = []
      if (decl.typeAnnotation.type === 'TSTypeLiteral') {
        for (const member of decl.typeAnnotation.members) {
          if (member.type !== 'TSPropertySignature') {
            domains.push({ name: '(non-property-member-unresolved)', anchor: member.loc ? member.loc.start.line : null })
            continue
          }
          const key = member.key
          const name = key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : '(computed-key-unresolved)'
          let typeRef = null
          let typeModule = null
          if (member.typeAnnotation && member.typeAnnotation.typeAnnotation.type === 'TSTypeReference') {
            const tr = member.typeAnnotation.typeAnnotation.typeName
            typeRef = tr.type === 'Identifier' ? tr.name : '(qualified-type-unresolved)'
            typeModule = importMap.get(typeRef) || null
          }
          domains.push({ name, typeRef, typeModule, anchor: member.loc ? member.loc.start.line : null })
        }
      }
    }
  }
  return domains || []
}

// ---------------------------------------------------------------------------
// src/preload/index.ts: assembled `api` object + import map + inline
// top-level flattened functions (e.g. telemetryTrack*Api), which is the
// GROUND TRUTH for domain identity (not each bridge file's own, sometimes
// absent, `satisfies` annotation).
// ---------------------------------------------------------------------------
function extractIndexAssembly(source, text, fileHashes) {
  const relPath = 'src/preload/index.ts'
  const ast = parseTs(text, relPath)
  const importMap = collectImportMap(ast)
  const localConstMap = collectLocalStringConsts(ast)
  const ctx = { source, relPath, importMap, localConstMap, fileHashes }

  // Top-level local (non-imported) const declarations whose initializer is a
  // function — candidates for inline/flattened API values assembled
  // straight into `api`, never routed through a `*-bridge.ts` file.
  const localFunctionConsts = new Map() // name -> declarator path (for ipc-call extraction)
  BABEL.traverse(ast, {
    Program(programPath) {
      for (const [idx, node] of programPath.node.body.entries()) {
        if (node.type !== 'VariableDeclaration') continue
        for (const [dIdx, decl] of node.declarations.entries()) {
          if (decl.id.type !== 'Identifier') continue
          if (!decl.init) continue
          const isFn = decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression'
          if (isFn) {
            localFunctionConsts.set(decl.id.name, programPath.get(`body.${idx}.declarations.${dIdx}.init`))
          }
        }
      }
    },
  })

  const domains = []
  for (const node of ast.program.body) {
    if (node.type !== 'VariableDeclaration') continue
    for (const declarator of node.declarations) {
      if (!(declarator.id.type === 'Identifier' && declarator.id.name === 'api')) continue
      let init = declarator.init
      if (init && init.type === 'TSSatisfiesExpression') init = init.expression
      if (!init || init.type !== 'ObjectExpression') continue
      for (const prop of init.properties) {
        if (prop.type !== 'ObjectProperty') {
          domains.push({ name: '(spread-or-computed-unresolved)', anchor: prop.loc ? prop.loc.start.line : null })
          continue
        }
        const keyResult = extractPropertyKeyName(prop, ctx)
        const value = prop.value
        const localRef = value.type === 'Identifier' ? value.name : null
        const imported = localRef ? importMap.get(localRef) : null
        let inlineIpcCalls = null
        if (localRef && !imported && localFunctionConsts.has(localRef)) {
          // Flattened top-level value (e.g. telemetryTrackApi): walk its own
          // body for ipcRenderer.* calls rather than reporting "present, no
          // channel data" just because it isn't inside a *-bridge.ts file.
          inlineIpcCalls = extractIpcCallsInFunction(localFunctionConsts.get(localRef), text, ctx)
        }
        domains.push({
          name: keyResult.name === null ? `(${keyResult.resolution})` : keyResult.name,
          keyResolution: keyResult.resolution,
          localRef,
          module: imported ? imported.module : null,
          importedName: imported ? imported.importedName : null,
          inline: inlineIpcCalls !== null,
          inlineIpcCalls: inlineIpcCalls || [],
          anchor: prop.loc ? prop.loc.start.line : null,
        })
      }
    }
  }
  return domains
}

// ---------------------------------------------------------------------------
// RPC methods: src/main/runtime/rpc/methods/index.ts + statically imported
// method-group files, followed RECURSIVELY through:
//   - cross-file `...IDENTIFIER` array spreads (aggregator files like
//     terminal.ts / orchestration.ts / github.ts that only re-export other
//     files' arrays),
//   - `defineMethod(...)` AND `defineStreamingMethod(...)` call sites,
//   - factory functions (`export const X = createXMethods()`, where the
//     array is built and returned by a same-file or cross-file function
//     rather than declared as a literal).
// ---------------------------------------------------------------------------
const RPC_DEFINE_CALLEES = new Set(['defineMethod', 'defineStreamingMethod'])
const MAX_METHOD_ARRAY_DEPTH = 12
const MAX_OBJECT_LITERAL_REEXPORT_DEPTH = 8

// Every placeholder name this script ever emits (RPC or otherwise) is
// wrapped in parentheses — `(non-literal-name-unresolved)`,
// `(unresolved-array-element)`, `(computed-key-unresolved)`, etc. This is the
// SINGLE source of truth for "is this a real resolved name or a recorded
// unknown", used both to build the resolved-name census and to gate the
// zero-resolved guard — a name is never allowed to look real just because it
// found ITS WAY into a dedup map.
function isPlaceholderName(name) {
  return typeof name === 'string' && name.startsWith('(') && name.endsWith(')')
}

// Finds `export const <name> = {...}` (optionally wrapped in `as const` /
// `satisfies X`) directly in an already-parsed AST, unwrapping the
// ExportNamedDeclaration the same way findLocalFunctionReturnArray does.
function findObjectLiteralDeclaration(ast, name) {
  for (const rawNode of ast.program.body) {
    const node = rawNode.type === 'ExportNamedDeclaration' && rawNode.declaration ? rawNode.declaration : rawNode
    if (node.type !== 'VariableDeclaration') continue
    for (const decl of node.declarations) {
      if (decl.id.type !== 'Identifier' || decl.id.name !== name) continue
      let init = decl.init
      while (init && (init.type === 'TSAsExpression' || init.type === 'TSSatisfiesExpression')) {
        init = init.expression
      }
      if (init && init.type === 'ObjectExpression') return init
    }
  }
  return null
}

function findStarReexportModules(ast) {
  const modules = []
  for (const node of ast.program.body) {
    if (node.type === 'ExportAllDeclaration') modules.push(node.source.value)
  }
  return modules
}

// Statically (never eval) resolves an object-literal constant declared in
// `relPath` OR reachable from it through a chain of `export * from './x'`
// re-exports (e.g. mentu-recipe-contract.ts re-exporting
// mentu-run-contract.ts's `MENTU_RPC_METHODS`). Depth- and cycle-guarded;
// every followed file is hashed via `fileHashes`.
function resolveObjectLiteralAcrossReexports(source, relPath, name, depth, visiting, fileHashes) {
  const visitKey = `${relPath}::objectLiteral::${name}`
  if (depth >= MAX_OBJECT_LITERAL_REEXPORT_DEPTH || visiting.has(visitKey)) return null
  let read
  try {
    read = readSourceFile(source, relPath, fileHashes)
  } catch {
    return null
  }
  const ast = parseTs(read.text, relPath)
  const direct = findObjectLiteralDeclaration(ast, name)
  if (direct) return { objectNode: direct, file: relPath }
  const nextVisiting = new Set([...visiting, visitKey])
  for (const starModule of findStarReexportModules(ast)) {
    const targetRelPath = moduleToRelPath(path.posix.dirname(relPath), starModule)
    if (!targetRelPath) continue
    const found = resolveObjectLiteralAcrossReexports(source, targetRelPath, name, depth + 1, nextVisiting, fileHashes)
    if (found) return found
  }
  return null
}

// Resolves `SOME_CONST.property` (a MemberExpression `name` field on a
// defineMethod/defineStreamingMethod spec, e.g. mentu.ts's
// `MENTU_RPC_METHODS.capability`) to its literal string value: follows
// `objectName` through the current file's import map (alias-correct, via
// the ORIGINAL exported name) to wherever it's actually declared, including
// through `export * from` re-export chains, then looks up `propertyName` as
// a plain (non-computed) string-valued property. Returns null — never a
// fabricated guess — if the object, the re-export chain, or the property
// can't be statically resolved.
function resolveMemberConstant(ctx, objectName, propertyName) {
  const { source, relPath, importMap, fileHashes } = ctx
  let targetRelPath = relPath
  let searchName = objectName
  const imported = importMap.get(objectName)
  if (imported) {
    const resolved = moduleToRelPath(path.posix.dirname(relPath), imported.module)
    if (!resolved) return null
    targetRelPath = resolved
    searchName = imported.importedName
  }
  const found = resolveObjectLiteralAcrossReexports(source, targetRelPath, searchName, 0, new Set(), fileHashes)
  if (!found) return null
  const prop = found.objectNode.properties.find(
    (p) =>
      p.type === 'ObjectProperty' &&
      !p.computed &&
      ((p.key.type === 'Identifier' && p.key.name === propertyName) || (p.key.type === 'StringLiteral' && p.key.value === propertyName)),
  )
  if (!prop || prop.value.type !== 'StringLiteral') return null
  return { value: prop.value.value, resolvedIn: found.file }
}

function extractMethodNameFromDefineCall(callPath, calleeName, ctx) {
  const arg = callPath.node.arguments[0]
  const anchor = callPath.node.loc ? callPath.node.loc.start.line : null
  if (!arg || arg.type !== 'ObjectExpression') {
    return { name: '(non-object-arg-unresolved)', kind: calleeName, anchor }
  }
  const nameProp = arg.properties.find(
    (p) => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'name',
  )
  if (!nameProp) {
    return { name: '(non-literal-name-unresolved)', kind: calleeName, anchor }
  }
  if (nameProp.value.type === 'StringLiteral') {
    return { name: nameProp.value.value, kind: calleeName, anchor }
  }
  if (
    ctx &&
    nameProp.value.type === 'MemberExpression' &&
    !nameProp.value.computed &&
    nameProp.value.object.type === 'Identifier' &&
    nameProp.value.property.type === 'Identifier'
  ) {
    const resolved = resolveMemberConstant(ctx, nameProp.value.object.name, nameProp.value.property.name)
    if (resolved) {
      return { name: resolved.value, kind: calleeName, anchor, resolvedVia: `${nameProp.value.object.name}.${nameProp.value.property.name}`, resolvedIn: resolved.resolvedIn }
    }
    return {
      name: '(non-literal-name-unresolved)',
      kind: calleeName,
      anchor,
      unresolvedMemberRef: `${nameProp.value.object.name}.${nameProp.value.property.name}`,
    }
  }
  return { name: '(non-literal-name-unresolved)', kind: calleeName, anchor }
}

// Finds a top-level `export const <name> = <ArrayExpression>` OR
// `export const <name> = <call to a same-file factory function that
// `return`s an ArrayExpression>` OR `export function <name>(...) { ... return
// [...] }`, returning the resolved ArrayExpression node (or null +
// diagnostic reason if it can't be found statically).
function findArrayExport(ast, exportedName) {
  let arrayNode = null
  let diagnostic = null
  BABEL.traverse(ast, {
    ExportNamedDeclaration(exportPath) {
      if (arrayNode || diagnostic) return
      const decl = exportPath.node.declaration
      if (!decl) return
      if (decl.type === 'VariableDeclaration') {
        for (const declarator of decl.declarations) {
          if (!(declarator.id.type === 'Identifier' && declarator.id.name === exportedName)) continue
          let init = declarator.init
          if (init && init.type === 'TSAsExpression') init = init.expression
          if (init && init.type === 'ArrayExpression') {
            arrayNode = init
          } else if (init && init.type === 'CallExpression' && init.callee.type === 'Identifier') {
            diagnostic = { kind: 'factory-call', calleeName: init.callee.name, callNode: init }
          } else {
            diagnostic = { kind: 'non-array-non-factory-init', raw: null }
          }
        }
      } else if (decl.type === 'FunctionDeclaration' && decl.id && decl.id.name === exportedName) {
        // export function X(...) { ...; return [...] }
        let returned = null
        BABEL.traverse(decl.body, {
          noScope: true,
          ReturnStatement(returnPath) {
            if (returned) return
            if (returnPath.node.argument && returnPath.node.argument.type === 'ArrayExpression') {
              returned = returnPath.node.argument
            }
          },
        })
        if (returned) arrayNode = returned
        else diagnostic = { kind: 'function-no-array-return' }
      }
    },
  })
  return { arrayNode, diagnostic }
}

// Given a local function DECLARATION node (not import), finds its `return
// [...]` array (same technique as the exported-function case above), used
// for the local factory-function pattern
// (`export const X = createXMethods()` where `createXMethods` is declared
// in the SAME file).
function findLocalFunctionReturnArray(ast, functionName) {
  let arrayNode = null
  for (const rawNode of ast.program.body) {
    // `export function foo() {}` parses as ExportNamedDeclaration wrapping a
    // FunctionDeclaration; unwrap it so an EXPORTED factory function (like
    // browser-network-tunnel.ts's `createBrowserNetworkTunnelMethods`) is
    // found the same as a non-exported one.
    const node = rawNode.type === 'ExportNamedDeclaration' && rawNode.declaration ? rawNode.declaration : rawNode
    if (node.type === 'FunctionDeclaration' && node.id && node.id.name === functionName) {
      BABEL.traverse(node.body, {
        noScope: true,
        ReturnStatement(returnPath) {
          if (arrayNode) return
          if (returnPath.node.argument && returnPath.node.argument.type === 'ArrayExpression') {
            arrayNode = returnPath.node.argument
          }
        },
      })
    }
  }
  return arrayNode
}

// Recursively resolves an ArrayExpression's elements into a flat list of
// `{name, kind, anchor, file}` method entries, following:
//   - `defineMethod(...)` / `defineStreamingMethod(...)` direct calls,
//   - `...IDENTIFIER` spreads (cross-file, alias-correct via importedName;
//     same-file via a same-file array/function lookup),
//   - anything else is recorded unresolved with a raw snippet, never
//     silently dropped and never claimed as zero.
function resolveMethodArray({ source, relPath, text, arrayNode, importMap, depth, visiting, fileHashes }) {
  const methods = []
  const ctx = { source, relPath, importMap, fileHashes }
  for (const el of arrayNode.elements) {
    if (!el) continue
    if (el.type === 'CallExpression' && el.callee.type === 'Identifier' && RPC_DEFINE_CALLEES.has(el.callee.name)) {
      const entry = extractMethodNameFromDefineCall({ node: el }, el.callee.name, ctx)
      // extractMethodNameFromDefineCall expects a NodePath-like {node}; we
      // pass a plain object since we only need `.node` and `.node.loc`.
      methods.push({ ...entry, file: relPath })
      continue
    }
    if (el.type === 'SpreadElement' && el.argument.type === 'Identifier') {
      const localName = el.argument.name
      const resolved = resolveIdentifierArrayMember({ source, relPath, text, importMap, name: localName, depth, visiting, fileHashes })
      for (const m of resolved) methods.push(m)
      continue
    }
    if (el.type === 'Identifier') {
      // A bare (non-spread) identifier array element referencing a single
      // pre-built `const X = defineMethod({...})` value (e.g. linear.ts's
      // `LINEAR_ISSUE_LIST_METHOD` import), not an array to spread.
      const resolved = resolveSingleMethodIdentifier({ source, relPath, importMap, name: el.name, depth, visiting, fileHashes })
      methods.push(resolved)
      continue
    }
    methods.push({
      name: '(unresolved-array-element)',
      kind: 'unresolved',
      anchor: el.loc ? el.loc.start.line : null,
      file: relPath,
      raw: snippet(el, text),
    })
  }
  return methods
}

// Resolves a bare identifier used as an array element/spread target within
// RPC method composition: it may be (a) imported from another file (follow
// via importedName, alias-correct), or (b) declared in the SAME file as
// another `export const ARRAY = [...]`/factory (follow locally without a
// file read). Depth- and cycle-guarded; every followed file is hashed.
// Finds a top-level `const <name> = defineMethod({...})` /
// `defineStreamingMethod({...})` declarator (exported or not) in an
// already-parsed AST.
function findSingleMethodDeclarator(ast, name) {
  for (const rawNode of ast.program.body) {
    const node = rawNode.type === 'ExportNamedDeclaration' && rawNode.declaration ? rawNode.declaration : rawNode
    if (node.type !== 'VariableDeclaration') continue
    for (const declarator of node.declarations) {
      if (declarator.id.type !== 'Identifier' || declarator.id.name !== name) continue
      if (
        declarator.init &&
        declarator.init.type === 'CallExpression' &&
        declarator.init.callee.type === 'Identifier' &&
        RPC_DEFINE_CALLEES.has(declarator.init.callee.name)
      ) {
        return { node: declarator.init, calleeName: declarator.init.callee.name }
      }
    }
  }
  return null
}

function resolveSingleMethodIdentifier({ source, relPath, importMap, name, depth, visiting, fileHashes }) {
  const visitKey = `${relPath}::single::${name}`
  if (depth >= MAX_METHOD_ARRAY_DEPTH || visiting.has(visitKey)) {
    return { name: '(unresolved-single-method-identifier)', kind: 'unresolved-depth-or-cycle', anchor: null, file: relPath, refName: name }
  }
  const imported = importMap.get(name)
  if (!imported) {
    const ast = parseTs(readSourceFile(source, relPath, fileHashes).text, relPath)
    const found = findSingleMethodDeclarator(ast, name)
    if (!found) {
      return { name: '(unresolved-single-method-identifier)', kind: 'unresolved-not-found-in-file', anchor: null, file: relPath, refName: name }
    }
    const entry = extractMethodNameFromDefineCall({ node: found.node }, found.calleeName, { source, relPath, importMap, fileHashes })
    return { ...entry, file: relPath }
  }
  const targetRelPath = moduleToRelPath(path.posix.dirname(relPath), imported.module)
  if (!targetRelPath) {
    return { name: '(unresolved-single-method-identifier)', kind: 'unresolved-non-relative-import', anchor: null, file: relPath, refName: name }
  }
  let targetRead
  try {
    targetRead = readSourceFile(source, targetRelPath, fileHashes)
  } catch {
    return { name: '(unresolved-single-method-identifier)', kind: 'unresolved-read-failure', anchor: null, file: targetRelPath, refName: name }
  }
  const targetAst = parseTs(targetRead.text, targetRelPath)
  const found = findSingleMethodDeclarator(targetAst, imported.importedName)
  if (!found) {
    return { name: '(unresolved-single-method-identifier)', kind: 'unresolved-export-not-found', anchor: null, file: targetRelPath, refName: imported.importedName }
  }
  const targetImportMap = collectImportMap(targetAst)
  const entry = extractMethodNameFromDefineCall({ node: found.node }, found.calleeName, {
    source,
    relPath: targetRelPath,
    importMap: targetImportMap,
    fileHashes,
  })
  return { ...entry, file: targetRelPath }
}

function resolveIdentifierArrayMember({ source, relPath, text, importMap, name, depth, visiting, fileHashes }) {
  const visitKey = `${relPath}::${name}`
  if (depth >= MAX_METHOD_ARRAY_DEPTH || visiting.has(visitKey)) {
    return [{ name: '(unresolved-array-identifier)', kind: 'unresolved-depth-or-cycle', anchor: null, file: relPath, refName: name }]
  }
  const nextVisiting = new Set([...visiting, visitKey])
  const imported = importMap.get(name)
  if (!imported) {
    // Same-file candidate: another exported array, or a locally-declared
    // factory function returning an array.
    const ast = parseTs(text, relPath)
    const { arrayNode, diagnostic } = findArrayExport(ast, name)
    if (arrayNode) {
      const localImportMap = collectImportMap(ast)
      return resolveMethodArray({ source, relPath, text, arrayNode, importMap: localImportMap, depth: depth + 1, visiting: nextVisiting, fileHashes })
    }
    if (diagnostic && diagnostic.kind === 'factory-call') {
      const localArray = findLocalFunctionReturnArray(ast, diagnostic.calleeName)
      if (localArray) {
        const localImportMap = collectImportMap(ast)
        return resolveMethodArray({ source, relPath, text, arrayNode: localArray, importMap: localImportMap, depth: depth + 1, visiting: nextVisiting, fileHashes })
      }
    }
    return [{
      name: '(unresolved-array-identifier)',
      kind: diagnostic ? diagnostic.kind : 'unresolved-not-found-in-file',
      anchor: null,
      file: relPath,
      refName: name,
    }]
  }
  const targetRelPath = moduleToRelPath(path.posix.dirname(relPath), imported.module)
  if (!targetRelPath) {
    return [{ name: '(unresolved-array-identifier)', kind: 'unresolved-non-relative-import', anchor: null, file: relPath, refName: name }]
  }
  let targetRead
  try {
    targetRead = readSourceFile(source, targetRelPath, fileHashes)
  } catch {
    return [{ name: '(unresolved-array-identifier)', kind: 'unresolved-read-failure', anchor: null, file: targetRelPath, refName: name }]
  }
  const targetAst = parseTs(targetRead.text, targetRelPath)
  const { arrayNode, diagnostic } = findArrayExport(targetAst, imported.importedName)
  if (arrayNode) {
    const targetImportMap = collectImportMap(targetAst)
    return resolveMethodArray({
      source,
      relPath: targetRelPath,
      text: targetRead.text,
      arrayNode,
      importMap: targetImportMap,
      depth: depth + 1,
      visiting: nextVisiting,
      fileHashes,
    })
  }
  if (diagnostic && diagnostic.kind === 'factory-call') {
    const localArray = findLocalFunctionReturnArray(targetAst, diagnostic.calleeName)
    if (localArray) {
      const targetImportMap = collectImportMap(targetAst)
      return resolveMethodArray({
        source,
        relPath: targetRelPath,
        text: targetRead.text,
        arrayNode: localArray,
        importMap: targetImportMap,
        depth: depth + 1,
        visiting: nextVisiting,
        fileHashes,
      })
    }
  }
  return [{
    name: '(unresolved-array-identifier)',
    kind: diagnostic ? diagnostic.kind : 'unresolved-export-not-found',
    anchor: null,
    file: targetRelPath,
    refName: imported.importedName,
  }]
}

function extractRpcMethodGroupList(text) {
  const relPath = 'src/main/runtime/rpc/methods/index.ts'
  const ast = parseTs(text, relPath)
  const importMap = collectImportMap(ast)
  let arrayElements = null
  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue
    const decl = node.declaration
    if (decl.type !== 'VariableDeclaration') continue
    for (const declarator of decl.declarations) {
      let init = declarator.init
      if (init && init.type === 'TSAsExpression') init = init.expression
      if (declarator.id.type === 'Identifier' && init && init.type === 'ArrayExpression') {
        arrayElements = init.elements
      }
    }
  }
  const groups = []
  for (const el of arrayElements || []) {
    if (el && el.type === 'SpreadElement' && el.argument.type === 'Identifier') {
      const localName = el.argument.name
      const imported = importMap.get(localName)
      groups.push({
        localName,
        module: imported ? imported.module : null,
        importedName: imported ? imported.importedName : localName,
        resolution: imported ? 'resolved' : 'unresolved-non-local-import',
      })
    } else {
      groups.push({ localName: null, module: null, resolution: 'unresolved-non-spread-element' })
    }
  }
  return { groups, importMap }
}

// ---------------------------------------------------------------------------
// Main-side registrations (read-only evidence gathering; this script's
// WRITE ownership is unchanged — it never writes to src/main), split by
// ROLE so cross-referencing against preload channels never conflates
// direction:
//
//   - `ipcMain.handle(channel, ...)`   -> role 'request-handler': answers a
//     renderer `ipcRenderer.invoke(channel, ...)` call. Matched against
//     preload INVOKE channels only.
//   - `ipcMain.on/once(channel, ...)`  -> role 'fire-and-forget-listener':
//     RECEIVES a renderer `ipcRenderer.send/sendSync(channel, ...)` call.
//     Matched against preload SEND/SENDSYNC channels only — never against
//     preload `on()` channels, which are the OPPOSITE direction.
//   - `<expr>.webContents.send(channel, ...)` -> role 'push-producer':
//     PRODUCES the event a renderer `ipcRenderer.on/once(channel, ...)`
//     subscribes to. Matched against preload ON/ONCE channels only. This is
//     a syntactic heuristic keyed on the literal `.webContents.send(`
//     member-call shape (as used throughout src/main, e.g.
//     `mainWindow.webContents.send(...)`, `win.webContents.send(...)`); a
//     webContents reference reached through other indirection (a renamed
//     local alias with no `.webContents` in the same expression, a stored
//     callback, etc.) is NOT chased and is simply invisible to this pass —
//     an absent producer match is never proof no producer exists.
//   - `ipcMain.removeHandler/removeAllListeners(channel, ...)` -> role
//     'teardown': subscription/handler teardown bookkeeping, recorded as
//     evidence but EXCLUDED from all matching (it answers no preload call
//     and produces no event; treating it as an unmatched "handler" would be
//     as wrong as the direction conflation this fixes).
// ---------------------------------------------------------------------------
const MAIN_REQUEST_HANDLER_METHODS = new Set(['handle'])
const MAIN_FIRE_AND_FORGET_LISTENER_METHODS = new Set(['on', 'once'])
const MAIN_TEARDOWN_METHODS = new Set(['removeHandler', 'removeAllListeners'])
const MAIN_IPC_METHODS = new Set([
  ...MAIN_REQUEST_HANDLER_METHODS,
  ...MAIN_FIRE_AND_FORGET_LISTENER_METHODS,
  ...MAIN_TEARDOWN_METHODS,
])

function roleForRegistration(source, kind) {
  if (source === 'webContents.send') return 'push-producer'
  if (MAIN_REQUEST_HANDLER_METHODS.has(kind)) return 'request-handler'
  if (MAIN_FIRE_AND_FORGET_LISTENER_METHODS.has(kind)) return 'fire-and-forget-listener'
  if (MAIN_TEARDOWN_METHODS.has(kind)) return 'teardown'
  return 'unknown'
}

function extractMainIpcRegistrations(source, relPath, text, fileHashes) {
  const ast = parseTs(text, relPath)
  const importMap = collectImportMap(ast)
  const localConstMap = collectLocalStringConsts(ast)
  const ctx = { source, relPath, importMap, localConstMap, fileHashes }
  const registrations = []
  BABEL.traverse(ast, {
    CallExpression(callPath) {
      const callee = callPath.node.callee
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'ipcMain' &&
        callee.property.type === 'Identifier' &&
        MAIN_IPC_METHODS.has(callee.property.name)
      ) {
        const kind = callee.property.name
        const channel = resolveChannelArg(callPath.node.arguments[0], text, ctx)
        registrations.push({
          file: relPath,
          apiSource: 'ipcMain',
          kind,
          role: roleForRegistration('ipcMain', kind),
          channel,
          anchor: callPath.node.loc ? callPath.node.loc.start.line : null,
        })
        return
      }
      // `<expr>.webContents.send(channel, ...)`: the object of the `.send`
      // call must itself be a MemberExpression ending in `.webContents` —
      // the identifier/call/this-expression the `.webContents` hangs off of
      // is deliberately NOT constrained, since real call sites vary
      // (`win.webContents.send`, `this.mainWindow.webContents.send`,
      // `this.host.getAuthoritativeWindow().webContents.send`, ...).
      if (
        callee.type === 'MemberExpression' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'send' &&
        callee.object.type === 'MemberExpression' &&
        callee.object.property.type === 'Identifier' &&
        callee.object.property.name === 'webContents'
      ) {
        const channel = resolveChannelArg(callPath.node.arguments[0], text, ctx)
        registrations.push({
          file: relPath,
          apiSource: 'webContents.send',
          kind: 'send',
          role: roleForRegistration('webContents.send', 'send'),
          channel,
          anchor: callPath.node.loc ? callPath.node.loc.start.line : null,
        })
      }
    },
  })
  return registrations
}

function collectMainIpcRegistrations(source, fileHashes) {
  const allMainFiles = listSourceFiles(source, 'src/main').filter(
    (p) => p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.spec.ts'),
  )
  const registrations = []
  let filesScanned = 0
  for (const relPath of allMainFiles) {
    const { text } = readSourceFile(source, relPath, fileHashes)
    // Cheap pre-filter (still deterministic and still a full read+hash of
    // the file above): only files that mention `ipcMain` or `webContents`
    // at all are worth an AST traversal; files that don't are recorded as
    // scanned-but-empty, never silently skipped from the file count.
    if (!text.includes('ipcMain') && !text.includes('webContents')) {
      filesScanned += 1
      continue
    }
    filesScanned += 1
    const found = extractMainIpcRegistrations(source, relPath, text, fileHashes)
    for (const r of found) registrations.push(r)
  }
  return { registrations, filesScanned, filesTotal: allMainFiles.length }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function run(args) {
  const { source, expectedSha, knownUntracked } = args
  assert.ok(source, 'pass --source <read-only reference checkout> or set $DROGON_SOURCE_ROOT; no implicit checkout')
  const meta = sourceGitMeta(source, expectedSha, knownUntracked)
  const fileHashes = {}

  const bridgeFiles = listSourceFiles(source, 'src/preload').filter(
    (p) => /(^|\/)[^/]*-bridge\.ts$/.test(p) && !p.endsWith('.test.ts'),
  )
  const apiTypeFiles = listSourceFiles(source, 'src/preload').filter(
    (p) => /(^|\/)[^/]*-api\.ts$/.test(p) && !p.endsWith('.test.ts'),
  )

  if (bridgeFiles.length === 0) fail('empty extraction: zero *-bridge.ts files found')
  if (apiTypeFiles.length === 0) fail('empty extraction: zero *-api.ts files found')

  const bridges = []
  for (const relPath of bridgeFiles) {
    const { text } = readSourceFile(source, relPath, fileHashes)
    const exported = extractBridgeFile(source, relPath, text, fileHashes)
    bridges.push({ file: relPath, exported })
  }

  const apiTypes = []
  for (const relPath of apiTypeFiles) {
    const { text } = readSourceFile(source, relPath, fileHashes)
    apiTypes.push({ file: relPath, types: extractApiTypeFile(relPath, text) })
  }

  const indexPath = 'src/preload/index.ts'
  const indexRead = readSourceFile(source, indexPath, fileHashes)
  const assembledDomains = extractIndexAssembly(source, indexRead.text, fileHashes)

  const apiTypesPath = 'src/preload/api-types.ts'
  const apiTypesRead = readSourceFile(source, apiTypesPath, fileHashes)
  const preloadApiDomains = extractPreloadApiType(apiTypesRead.text)

  if (assembledDomains.length === 0) fail('empty extraction: zero domains assembled in index.ts')
  if (preloadApiDomains.length === 0) fail('empty extraction: zero PreloadApi domains found')

  // Domain identity: ground truth is the index.ts assembly (property name +
  // which bridge file/export it points to). Each bridge export's domain is
  // cross-checked against, not solely derived from, its own `satisfies`
  // annotation (some files, e.g. mentu-bridge.ts, never write one).
  const assemblyByModuleExport = new Map() // `${module}::${importedName}` -> domain name
  for (const d of assembledDomains) {
    if (d.module && d.localRef) {
      assemblyByModuleExport.set(`${moduleToRelPath('src/preload', d.module)}::${d.importedName || d.localRef}`, d.name)
    }
  }
  for (const bridge of bridges) {
    for (const exp of bridge.exported) {
      const assemblyDomain = assemblyByModuleExport.get(`${bridge.file}::${exp.exportName}`) || null
      exp.domainFromAssembly = assemblyDomain
      exp.domain = assemblyDomain || exp.domainFromSatisfies || null
      exp.domainSource =
        assemblyDomain && exp.domainFromSatisfies && assemblyDomain === exp.domainFromSatisfies
          ? 'assembly-and-satisfies-agree'
          : assemblyDomain
            ? exp.domainFromSatisfies
              ? 'assembly-satisfies-mismatch'
              : 'assembly-only (no satisfies annotation)'
            : exp.domainFromSatisfies
              ? 'satisfies-only (not reachable from index.ts assembly)'
              : 'unresolved'
    }
  }

  const unresolvedAssemblyExports = assembledDomains.flatMap((domain) => {
    if (!domain.module || !domain.localRef) return []
    const file = moduleToRelPath('src/preload', domain.module)
    const exportName = domain.importedName || domain.localRef
    const exported = bridges.find((bridge) => bridge.file === file)?.exported
      .find((entry) => entry.exportName === exportName)
    const unresolvedAlias = exported?.methods.find((method) =>
      method.resolution?.startsWith('unresolved-object-alias-'))
    if (exported && !unresolvedAlias) return []
    return [{
      domain: domain.name,
      file,
      exportName,
      assemblyAnchor: domain.anchor,
      resolution: unresolvedAlias?.resolution ?? 'export-not-extracted',
    }]
  })

  const assembledNames = new Set(assembledDomains.map((d) => d.name))
  const preloadApiNames = new Set(preloadApiDomains.map((d) => d.name))
  const domainCrossCheck = {
    inAssemblyOnly: [...assembledNames].filter((n) => !preloadApiNames.has(n)).sort(),
    inPreloadApiOnly: [...preloadApiNames].filter((n) => !assembledNames.has(n)).sort(),
  }
  const domainSourceMismatches = []
  for (const bridge of bridges) {
    for (const exp of bridge.exported) {
      if (exp.domainSource === 'assembly-satisfies-mismatch') {
        domainSourceMismatches.push({ file: bridge.file, exportName: exp.exportName, domainFromAssembly: exp.domainFromAssembly, domainFromSatisfies: exp.domainFromSatisfies })
      }
    }
  }

  // RPC method groups, followed recursively through spreads/factories.
  const rpcIndexPath = 'src/main/runtime/rpc/methods/index.ts'
  const rpcIndexRead = readSourceFile(source, rpcIndexPath, fileHashes)
  const { groups: rpcGroups } = extractRpcMethodGroupList(rpcIndexRead.text)
  if (rpcGroups.length === 0) fail('empty extraction: zero RPC method groups found in methods/index.ts')

  const rpcMethodsByGroup = []
  for (const group of rpcGroups) {
    if (group.resolution !== 'resolved' || !group.module) {
      rpcMethodsByGroup.push({ ...group, methods: [] })
      continue
    }
    const relPath = moduleToRelPath('src/main/runtime/rpc/methods', group.module)
    if (!relPath) {
      rpcMethodsByGroup.push({ ...group, methods: [], resolution: 'unresolved-non-relative-module' })
      continue
    }
    let read
    try {
      read = readSourceFile(source, relPath, fileHashes)
    } catch {
      rpcMethodsByGroup.push({ ...group, methods: [], resolution: 'unresolved-module-read-failure', file: relPath })
      continue
    }
    const ast = parseTs(read.text, relPath)
    const { arrayNode, diagnostic } = findArrayExport(ast, group.importedName)
    let methods
    if (arrayNode) {
      const localImportMap = collectImportMap(ast)
      methods = resolveMethodArray({
        source,
        relPath,
        text: read.text,
        arrayNode,
        importMap: localImportMap,
        depth: 0,
        visiting: new Set(),
        fileHashes,
      })
    } else if (diagnostic && diagnostic.kind === 'factory-call') {
      // `export const X_METHODS = createXMethods()`: the array is built and
      // returned by a same-file factory function (e.g.
      // browser-network-tunnel.ts's `createBrowserNetworkTunnelMethods()`).
      const localArray = findLocalFunctionReturnArray(ast, diagnostic.calleeName)
      if (localArray) {
        const localImportMap = collectImportMap(ast)
        methods = resolveMethodArray({
          source,
          relPath,
          text: read.text,
          arrayNode: localArray,
          importMap: localImportMap,
          depth: 0,
          visiting: new Set(),
          fileHashes,
        })
      }
    }
    if (!methods) {
      rpcMethodsByGroup.push({
        ...group,
        file: relPath,
        methods: [],
        resolution: diagnostic ? `unresolved-${diagnostic.kind}` : 'unresolved-array-not-found',
      })
      continue
    }
    rpcMethodsByGroup.push({ ...group, file: relPath, methods })
  }

  // Deduped OCCURRENCE list: keyed by (file, anchor, name) so a method
  // reached via more than one composition path is counted once as an
  // occurrence identity. This is DELIBERATELY NOT the same thing as the
  // resolved-name census below — an occurrence can be a placeholder
  // (`(non-literal-name-unresolved)` etc.), and two DIFFERENT occurrences
  // can legitimately resolve to the SAME real name (duplicate RPC method
  // registrations), which the occurrence key would keep as two entries.
  const rpcMethodOccurrenceDedup = new Map()
  for (const group of rpcMethodsByGroup) {
    for (const m of group.methods) {
      const key = `${m.file}:${m.anchor}:${m.name}`
      if (!rpcMethodOccurrenceDedup.has(key)) rpcMethodOccurrenceDedup.set(key, m)
    }
  }
  const rpcMethodOccurrences = [...rpcMethodOccurrenceDedup.values()]

  // Resolved-NAME census: every occurrence whose name is a real (non-
  // placeholder) dot-namespaced string, deduped by NAME (not by anchor) —
  // this is the actual "known registered method names" set, distinct from
  // occurrence identities, and it is what the zero-resolved guard checks.
  // An unresolved/placeholder entry can NEVER count toward it, however many
  // occurrence slots it fills.
  const rpcMethodPlaceholderEntries = rpcMethodOccurrences.filter((m) => isPlaceholderName(m.name))
  const rpcResolvedMethodNameSet = new Set(
    rpcMethodOccurrences.filter((m) => !isPlaceholderName(m.name)).map((m) => m.name),
  )
  const rpcMethodNamesResolved = [...rpcResolvedMethodNameSet].sort()
  // Names with more than one distinct occurrence anchor — real duplicate RPC
  // method registrations, surfaced explicitly rather than silently collapsed.
  const rpcNameOccurrenceCounts = new Map()
  for (const m of rpcMethodOccurrences) {
    if (isPlaceholderName(m.name)) continue
    const list = rpcNameOccurrenceCounts.get(m.name) || []
    list.push({ file: m.file, anchor: m.anchor })
    rpcNameOccurrenceCounts.set(m.name, list)
  }
  const rpcDuplicateMethodNames = [...rpcNameOccurrenceCounts.entries()]
    .filter(([, occ]) => occ.length > 1)
    .map(([name, occurrences]) => ({ name, occurrences }))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (rpcMethodNamesResolved.length === 0) {
    fail('empty extraction: zero RESOLVED (non-placeholder) defineMethod()/defineStreamingMethod() names — refusing to pass the zero-resolved guard on placeholder entries alone')
  }

  // Deduped bridge-method list — over ALL bridge exports regardless of
  // whether index.ts's `api` assembly ever references them (an orphan test
  // fixture like widget-extra-bridge.ts still parses and dedupes here).
  // This is explicitly an ALL-EXPORT inventory count, never a public-API-
  // surface claim; `reachableBridgeMethodsDeduped` below is the actual
  // assembly-reachable subset.
  const bridgeMethodDedup = new Map()
  for (const bridge of bridges) {
    for (const exp of bridge.exported) {
      for (const method of exp.methods) {
        const key = `${method.originFile || bridge.file}:${method.originAnchor ?? method.anchor}:${method.name}`
        if (!bridgeMethodDedup.has(key)) bridgeMethodDedup.set(key, method)
      }
    }
  }
  const allBridgeExportMethods = [...bridgeMethodDedup.values()]

  // Reachability: an exported object is reachable if index.ts's `api`
  // assembly references it directly by (file, exportName). Because
  // cross-file object SPREADS are already inlined into the spreading
  // export's own `methods` list (tagged `spreadFrom`) at extraction time,
  // walking only the methods of directly-reachable exports also correctly
  // captures everything reachable transitively through a spread — no
  // separate transitive-closure pass is needed. An export whose OWN name is
  // never referenced by the assembly (like widget-extra-bridge.ts's
  // `widgetExtraApi`, or a `*-bridge.ts` file that is only ever consumed as
  // a spread SOURCE, like widget-list-bridge.ts's own top-level entry) is
  // marked orphan, even if its content happens to duplicate reachable
  // content elsewhere via that spread.
  for (const bridge of bridges) {
    for (const exp of bridge.exported) {
      exp.reachableFromIndexAssembly = assemblyByModuleExport.has(`${bridge.file}::${exp.exportName}`)
    }
  }
  const reachableBridgeMethodDedup = new Map()
  const orphanBridgeExports = []
  for (const bridge of bridges) {
    for (const exp of bridge.exported) {
      if (exp.reachableFromIndexAssembly) {
        for (const method of exp.methods) {
          const key = `${method.originFile || bridge.file}:${method.originAnchor ?? method.anchor}:${method.name}`
          if (!reachableBridgeMethodDedup.has(key)) reachableBridgeMethodDedup.set(key, method)
        }
      } else {
        orphanBridgeExports.push({ file: bridge.file, exportName: exp.exportName, domain: exp.domain, methodCount: exp.methods.length })
      }
    }
  }
  const dedupedBridgeMethods = [...reachableBridgeMethodDedup.values()]

  // Preload channels, deduped AND split by DIRECTION — invoke (request),
  // send/sendSync (fire-and-forget), on/once (push event) — because each
  // direction has a DIFFERENT correct main-side counterpart (see the
  // main-side registration comment above). Never pooled into one undifferentiated
  // set: doing so is exactly the category error a prior pass made (treating
  // an absent `ipcMain.on` match for a push-event channel as equivalent to a
  // missing request handler).
  const requestChannels = new Set() // invoke
  const fireAndForgetChannels = new Set() // send / sendSync
  const pushEventChannels = new Set() // on / once
  let unresolvedChannelCount = 0
  let computedKeyUnresolvedCount = 0
  let onCount = 0
  let invokeCount = 0
  let sendCount = 0
  let sendSyncCount = 0
  let pairedDisposerCount = 0
  let unresolvedDisposerPairingCount = 0
  let delegatedUnresolvedCount = 0
  let syntaxIpcCallOccurrences = 0
  function foldIpcCall(call) {
    syntaxIpcCallOccurrences += 1
    const resolved = call.channel.kind === 'literal' || call.channel.kind === 'resolved-const-ref'
    if (call.kind === 'invoke') {
      invokeCount += 1
      if (resolved) requestChannels.add(call.channel.value)
      else unresolvedChannelCount += 1
    } else if (call.kind === 'send' || call.kind === 'sendSync') {
      if (call.kind === 'send') sendCount += 1
      else sendSyncCount += 1
      if (resolved) fireAndForgetChannels.add(call.channel.value)
      else unresolvedChannelCount += 1
    } else if (call.kind === 'on' || call.kind === 'once') {
      onCount += 1
      if (resolved) pushEventChannels.add(call.channel.value)
      else unresolvedChannelCount += 1
    }
    // `removeListener` is disposer/teardown bookkeeping, not a channel
    // requiring a main-side match — deliberately excluded from all three
    // direction sets (it is still visible via disposerPairing anchors).
  }
  for (const method of dedupedBridgeMethods) {
    if (typeof method.keyResolution === 'string' && method.keyResolution.startsWith('unresolved')) {
      computedKeyUnresolvedCount += 1
    }
    if (method.resolution === 'delegated-unresolved') delegatedUnresolvedCount += 1
    if (method.disposerPairing) {
      if (method.disposerPairing.status === 'paired') pairedDisposerCount += 1
      else if (method.disposerPairing.status === 'unresolved-disposer-pairing') unresolvedDisposerPairingCount += 1
    }
    for (const call of method.ipcCalls || []) foldIpcCall(call)
  }
  // Also fold in the flattened top-level (telemetry-style) inline calls from
  // index.ts assembly, which are NOT inside any bridge file.
  for (const d of assembledDomains) {
    for (const call of d.inlineIpcCalls || []) foldIpcCall(call)
  }
  const preloadChannels = new Set([...requestChannels, ...fireAndForgetChannels, ...pushEventChannels])

  // Explicit domain presence checks the task calls out by name: no domain is
  // ever silently classified as deprecated by omission from this list.
  // `telemetry` is NOT a nested `api.telemetry.*` domain object in the
  // source — it is four flattened top-level `PreloadApi` keys
  // (`telemetryTrack`/`telemetrySetOptIn`/`telemetryGetConsentState`/
  // `telemetryAcknowledgeBanner`), so its presence check matches by prefix
  // rather than by an exact nested-domain key, recorded explicitly so this
  // is never mistaken for an omission.
  const namedDomainChecks = [
    { name: 'mentu', match: (n) => n === 'mentu' },
    { name: 'bots', match: (n) => n === 'bots' },
    { name: 'meetings', match: (n) => n === 'meetings' },
    {
      name: 'telemetry (flattened top-level: telemetryTrack/telemetrySetOptIn/telemetryGetConsentState/telemetryAcknowledgeBanner)',
      match: (n) => n.startsWith('telemetry'),
    },
  ].map(({ name, match }) => {
    const assemblyEntries = assembledDomains.filter((d) => match(d.name))
    // Inline calls (flattened top-level index.ts functions, e.g. telemetry)
    // are CORRECTLY zero for a domain routed through a `*-bridge.ts` file —
    // that is not an omission. The real channel count for a bridge-routed
    // domain (mentu/bots/meetings) lives on the reachable bridge export(s)
    // whose resolved `domain` matches this check, so it's summed separately
    // and reported alongside, never conflated with the inline-only figure.
    const inlineIpcChannelsExtracted = assemblyEntries.reduce((sum, d) => sum + (d.inlineIpcCalls ? d.inlineIpcCalls.length : 0), 0)
    let assembledBridgeIpcChannels = 0
    let reachableBridgeExportCount = 0
    for (const bridge of bridges) {
      for (const exp of bridge.exported) {
        if (!exp.reachableFromIndexAssembly || !exp.domain || !match(exp.domain)) continue
        reachableBridgeExportCount += 1
        for (const method of exp.methods) assembledBridgeIpcChannels += (method.ipcCalls || []).length
      }
    }
    return {
      name,
      presentInAssembly: assemblyEntries.length > 0,
      presentInPreloadApi: [...preloadApiNames].some(match),
      inlineIpcChannelsExtracted,
      reachableBridgeExportCount,
      assembledIpcChannelsExtracted: inlineIpcChannelsExtracted + assembledBridgeIpcChannels,
    }
  })

  // Main-side census (read-only evidence; write ownership unchanged), split
  // into three role-specific indices so each preload direction is matched
  // against its OWN correct counterpart — never ipcMain.on treated as a
  // stand-in for a webContents.send producer, or vice versa.
  let mainCensus = { registrations: [], filesScanned: 0, filesTotal: 0, skipped: true }
  if (!args.skipMainCensus) {
    mainCensus = { ...collectMainIpcRegistrations(source, fileHashes), skipped: false }
  }
  function buildRoleIndex(role) {
    const index = new Map() // resolved channel value -> [{file, kind, apiSource, anchor}]
    for (const reg of mainCensus.registrations) {
      if (reg.role !== role) continue
      if (reg.channel.kind !== 'literal' && reg.channel.kind !== 'resolved-const-ref') continue
      const list = index.get(reg.channel.value) || []
      list.push({ file: reg.file, kind: reg.kind, apiSource: reg.apiSource, anchor: reg.anchor })
      index.set(reg.channel.value, list)
    }
    return index
  }
  const mainRequestHandlerIndex = buildRoleIndex('request-handler')
  const mainFireAndForgetListenerIndex = buildRoleIndex('fire-and-forget-listener')
  const mainPushProducerIndex = buildRoleIndex('push-producer')
  const mainTeardownCount = mainCensus.registrations.filter((r) => r.role === 'teardown').length

  function classifyDirection(channels, index, matchedStatus, unresolvedStatus) {
    return [...channels].sort().map((channel) => {
      const matches = index.get(channel)
      return matches
        ? { channel, status: matchedStatus, mainRegistrations: matches }
        : { channel, status: args.skipMainCensus ? 'unresolved-main-census-skipped' : unresolvedStatus }
    })
  }
  const requestChannelToHandlerMapping = classifyDirection(
    requestChannels,
    mainRequestHandlerIndex,
    'request-handler-matched',
    'request-handler-unresolved',
  )
  const fireAndForgetChannelToListenerMapping = classifyDirection(
    fireAndForgetChannels,
    mainFireAndForgetListenerIndex,
    'fire-and-forget-listener-matched',
    'fire-and-forget-listener-unresolved',
  )
  const pushEventChannelToProducerMapping = classifyDirection(
    pushEventChannels,
    mainPushProducerIndex,
    'push-producer-matched',
    'push-producer-unresolved',
  )
  const countMatched = (mapping) => mapping.filter((m) => m.status.endsWith('-matched')).length

  const dynamicDispatchChannels = ['runtime:call', 'runtime:subscribe', 'runtimeEnvironments:call', 'runtimeEnvironments:subscribe'].filter(
    (c) => preloadChannels.has(c),
  )

  const counts = {
    bridgeFiles: bridgeFiles.length,
    apiTypeFiles: apiTypeFiles.length,
    domainsAssembledInIndex: assembledDomains.length,
    domainsInPreloadApiType: preloadApiDomains.length,
    domainSourceMismatches: domainSourceMismatches.length,
    unresolvedAssemblyExports: unresolvedAssemblyExports.length,
    preloadChannelsDistinct: preloadChannels.size,
    reachableBridgeMethodsDeduped: dedupedBridgeMethods.length,
    allBridgeExportMethodsDeduped: allBridgeExportMethods.length,
    bridgeExportedObjectsTotal: bridges.reduce((sum, b) => sum + b.exported.length, 0),
    bridgeExportedObjectsOrphan: orphanBridgeExports.length,
    syntaxIpcCallOccurrences,
    ipcInvokeCalls: invokeCount,
    ipcSendCalls: sendCount,
    ipcSendSyncCalls: sendSyncCount,
    ipcOnSubscriptions: onCount,
    subscriptionsWithConfirmedDisposerPairing: pairedDisposerCount,
    subscriptionsWithUnresolvedDisposerPairing: unresolvedDisposerPairingCount,
    unresolvedDynamicChannelRefs: unresolvedChannelCount,
    unresolvedComputedMethodKeys: computedKeyUnresolvedCount,
    delegatedUnresolvedMethods: delegatedUnresolvedCount,
    rpcMethodGroups: rpcGroups.length,
    rpcMethodGroupsWithZeroMethods: rpcMethodsByGroup.filter((g) => g.methods.length === 0).length,
    rpcMethodOccurrencesDeduped: rpcMethodOccurrences.length,
    rpcMethodNamesResolvedUnique: rpcMethodNamesResolved.length,
    rpcMethodPlaceholderEntries: rpcMethodPlaceholderEntries.length,
    rpcMethodDuplicateNames: rpcDuplicateMethodNames.length,
    mainFilesTotal: mainCensus.filesTotal,
    mainFilesScanned: mainCensus.filesScanned,
    mainRegistrationsTotal: mainCensus.registrations.length,
    mainTeardownRegistrations: mainTeardownCount,
    requestChannelsTotal: requestChannels.size,
    requestChannelsMatchedToHandler: countMatched(requestChannelToHandlerMapping),
    requestChannelsUnresolvedAgainstHandler: requestChannels.size - countMatched(requestChannelToHandlerMapping),
    fireAndForgetChannelsTotal: fireAndForgetChannels.size,
    fireAndForgetChannelsMatchedToListener: countMatched(fireAndForgetChannelToListenerMapping),
    fireAndForgetChannelsUnresolvedAgainstListener: fireAndForgetChannels.size - countMatched(fireAndForgetChannelToListenerMapping),
    pushEventChannelsTotal: pushEventChannels.size,
    pushEventChannelsMatchedToProducer: countMatched(pushEventChannelToProducerMapping),
    pushEventChannelsUnresolvedAgainstProducer: pushEventChannels.size - countMatched(pushEventChannelToProducerMapping),
    filesHashed: Object.keys(fileHashes).length,
  }

  const gapsRegister = [
    ...(unresolvedAssemblyExports.length
      ? [`${unresolvedAssemblyExports.length} imported assembly export(s) remain unwalked or have unresolved object aliases (see unresolvedAssemblyExports): ${unresolvedAssemblyExports.map((entry) => entry.domain).join(', ')}. Their method/channel counts are unknown, NOT zero. Reachable-method and channel totals are bounded extracted subsets, not a complete API denominator.`]
      : []),
    ...(domainCrossCheck.inAssemblyOnly.length
      ? [`domains in index.ts assembly but absent from PreloadApi type: ${domainCrossCheck.inAssemblyOnly.join(', ')}`]
      : []),
    ...(domainCrossCheck.inPreloadApiOnly.length
      ? [`domains in PreloadApi type but absent from index.ts assembly: ${domainCrossCheck.inPreloadApiOnly.join(', ')}`]
      : []),
    ...(domainSourceMismatches.length
      ? [`${domainSourceMismatches.length} bridge export(s) where the index.ts assembly domain disagrees with the file's own \`satisfies\` annotation (see domainSourceMismatches).`]
      : []),
    `RPC method keys (e.g. "status.get") and preload IPC channels (e.g. "settings:get") are separate identifiers, not a literal-equality coverage join. This pass records dynamic-dispatch channels ${JSON.stringify(dynamicDispatchChannels)} but does not resolve their method arguments or trace all main-handler-to-RPC calls. Such links may be statically resolvable by a more complete analysis; they remain unknown here, not absent or inherently unresolvable.`,
    `${rpcMethodPlaceholderEntries.length} RPC method-array element(s) out of ${rpcMethodOccurrences.length} total occurrences could not be statically resolved to a literal defineMethod/defineStreamingMethod name (factory calls with no discoverable return array, non-identifier spread targets, a "name" field that is neither a string literal nor a statically-resolvable member-constant reference, etc.) — see rpcMethodGroups[].methods entries whose name is wrapped in parentheses (e.g. starts with "(non-" or "(unresolved"); these NEVER count toward rpcMethodNamesResolvedUnique or the zero-resolved guard.`,
    ...(rpcDuplicateMethodNames.length
      ? [`${rpcDuplicateMethodNames.length} RPC method name(s) are registered at more than one distinct source anchor (see rpcMethodDuplicateNames) — recorded as duplicates, not silently collapsed into a single occurrence.`]
      : []),
    `main-side census scanned ${mainCensus.filesScanned}/${mainCensus.filesTotal} src/main/**/*.ts files for ipcMain.handle/on/once/removeHandler/removeAllListeners AND <expr>.webContents.send(...) call sites (read-only evidence; this script's WRITE ownership remains the four docs/scripts paths only), found ${mainCensus.registrations.length} registrations (${mainTeardownCount} of them teardown-only, excluded from matching). Matching is DIRECTION-SPECIFIC, never pooled: invoke channels vs. ipcMain.handle (${counts.requestChannelsMatchedToHandler}/${counts.requestChannelsTotal} matched); send/sendSync channels vs. ipcMain.on/once (${counts.fireAndForgetChannelsMatchedToListener}/${counts.fireAndForgetChannelsTotal} matched); on/once (push-event) channels vs. <expr>.webContents.send(...) producer call sites (${counts.pushEventChannelsMatchedToProducer}/${counts.pushEventChannelsTotal} matched, a syntactic heuristic on the literal ".webContents.send(" shape — a producer reached through other indirection is invisible to this pass, not proof no producer exists). Unresolved entries in any direction are explicit, never treated as coverage or as proof of a missing implementation — see requestChannelToHandlerMapping / fireAndForgetChannelToListenerMapping / pushEventChannelToProducerMapping.`,
    `*-api.ts member extraction records signature NAMES only (no full type resolution of parameter/return shapes); full structural typing remains unresolved by this pass.`,
    `channel identifiers and computed object keys are resolved against same-file AND cross-file imported string constants up to depth ${MAX_CONST_RESOLUTION_DEPTH} (re-export chains beyond that depth, or non-string-literal computed expressions, are recorded unresolved-identifier-ref / unresolved-computed-*-key, not chased further). RPC "name" member-constant references (e.g. MENTU_RPC_METHODS.capability) are resolved the same way, additionally following \`export * from\` re-export chains up to depth ${MAX_OBJECT_LITERAL_REEXPORT_DEPTH}.`,
    `counts distinguish "syntaxIpcCallOccurrences" (every ipcRenderer.* call site parsed, including any duplicate composition paths before dedup) from "reachableBridgeMethodsDeduped" (the (file,anchor,name)-deduped method list belonging ONLY to exported objects index.ts's \`api\` assembly directly references) from "allBridgeExportMethodsDeduped" (the same dedup over EVERY exported bridge object regardless of reachability — an all-export inventory count that is NEVER proof of the public API surface). ${orphanBridgeExports.length} exported bridge object(s) are not referenced by the index.ts assembly at all (see orphanBridgeExports) — their own export is dead from index.ts's perspective even where their content happens to also be reachable via a spread into another, reachable export.`,
  ]

  const artifact = {
    schema: SCHEMA,
    source: {
      path: source,
      fullSha: meta.fullSha,
      trackedDirty: meta.trackedDirty,
      knownUntrackedFiles: [...knownUntracked].sort(),
    },
    provenance: 'source-only Babel AST enumeration; no eval, no import of source app/config, no test execution',
    counts,
    domainCrossCheck,
    domainSourceMismatches,
    unresolvedAssemblyExports,
    namedDomainChecks,
    bridges,
    apiTypes,
    preloadIndexAssembly: assembledDomains,
    preloadApiTypeDomains: preloadApiDomains,
    rpcMethodGroups: rpcMethodsByGroup,
    rpcMethodNamesResolved,
    rpcMethodPlaceholderEntries,
    rpcMethodDuplicateNames: rpcDuplicateMethodNames,
    orphanBridgeExports,
    mainRegistrations: mainCensus.registrations,
    requestChannelToHandlerMapping,
    fireAndForgetChannelToListenerMapping,
    pushEventChannelToProducerMapping,
    dynamicDispatchChannels,
    gapsRegister,
    fileHashesSha256: fileHashes,
  }
  return artifact
}

function renderMarkdown(artifact) {
  const c = artifact.counts
  const lines = []
  lines.push('# Bridge/RPC contract enumeration: renderer/service census')
  lines.push('')
  lines.push(
    'Planning-only, source-AST enumeration closing the "known omission" flagged in ' +
      '`parity-platform-audit.md` §8/§10 (partial ~70 domains / ~150 channels), corrected ' +
      'after coordinator review for recursive RPC method-array resolution, main-side ' +
      'ipcMain registrations, index.ts-assembly-derived domain identity, output-guard ' +
      'hardening, and syntax-occurrence vs. reachable-method accounting. ' +
      'No implementation performed, no daemons/apps started, no Git mutation.',
  )
  lines.push('')
  lines.push(`- **Source:** \`${artifact.source.path}\` at \`${artifact.source.fullSha}\` (frozen; tracked dirty: ${artifact.source.trackedDirty}).`)
  lines.push(`- **Provenance:** ${artifact.provenance}.`)
  lines.push('')
  lines.push('## Extracted counts (bounded; unresolved surfaces are not zero)')
  lines.push('')
  for (const [key, value] of Object.entries(c)) {
    lines.push(`- \`${key}\`: **${value}**`)
  }
  lines.push('')
  lines.push('## Named-domain explicit checks (never "deprecated by omission")')
  lines.push('')
  lines.push('| Domain | In index.ts assembly | In PreloadApi type | Reachable bridge exports | Inline-only channels | Total assembled channels |')
  lines.push('|---|---|---|---|---|---|')
  for (const d of artifact.namedDomainChecks) {
    lines.push(
      `| \`${d.name}\` | ${d.presentInAssembly ? '✅' : '❌'} | ${d.presentInPreloadApi ? '✅' : '❌'} | ${d.reachableBridgeExportCount} | ${d.inlineIpcChannelsExtracted} | ${d.assembledIpcChannelsExtracted} |`,
    )
  }
  lines.push('')
  lines.push('## Domain cross-check (index.ts assembly vs. PreloadApi type)')
  lines.push('')
  lines.push(
    `- In assembly only: ${artifact.domainCrossCheck.inAssemblyOnly.length ? artifact.domainCrossCheck.inAssemblyOnly.map((n) => `\`${n}\``).join(', ') : '(none)'}`,
  )
  lines.push(
    `- In PreloadApi type only: ${artifact.domainCrossCheck.inPreloadApiOnly.length ? artifact.domainCrossCheck.inPreloadApiOnly.map((n) => `\`${n}\``).join(', ') : '(none)'}`,
  )
  lines.push(`- Assembly-vs-satisfies domain mismatches: ${artifact.domainSourceMismatches.length}`)
  for (const m of artifact.domainSourceMismatches) {
    lines.push(`  - \`${m.file}\` export \`${m.exportName}\`: assembly says \`${m.domainFromAssembly}\`, satisfies says \`${m.domainFromSatisfies}\``)
  }
  lines.push('')
  lines.push('## Bridge files enumerated')
  lines.push('')
  lines.push('| File | Exported object(s) | Domain (source) | Methods | Reachable from index.ts assembly |')
  lines.push('|---|---|---|---|---|')
  for (const b of artifact.bridges) {
    for (const e of b.exported) {
      lines.push(
        `| \`${b.file}:${e.anchor}\` | \`${e.exportName}\` | ${e.domain ? `\`${e.domain}\`` : '(unresolved)'} (${e.domainSource}) | ${e.methods.length} | ${e.reachableFromIndexAssembly ? '✅' : '❌ orphan'} |`,
      )
    }
  }
  lines.push('')
  lines.push(
    `${artifact.orphanBridgeExports.length} exported bridge object(s) are ORPHAN — never referenced by index.ts's \`api\` assembly ` +
      '(their own export is dead from index.ts\'s perspective, even where their content is also reachable via a spread into ' +
      'another, reachable export). `allBridgeExportMethodsDeduped` counts every export above; `reachableBridgeMethodsDeduped` ' +
      'counts only the ✅ rows.',
  )
  lines.push('')
  lines.push('## RPC method groups (src/main/runtime/rpc/methods/index.ts), recursively resolved')
  lines.push('')
  lines.push('| Group local name | Module | Resolution | Method count |')
  lines.push('|---|---|---|---|')
  for (const g of artifact.rpcMethodGroups) {
    lines.push(`| \`${g.localName || '(unresolved)'}\` | \`${g.file || g.module || '(unresolved)'}\` | ${g.resolution} | ${g.methods.length} |`)
  }
  lines.push('')
  lines.push(
    `RPC method census: ${c.rpcMethodNamesResolvedUnique} distinct RESOLVED literal names, ${c.rpcMethodPlaceholderEntries} ` +
      `placeholder (unresolved) occurrence(s), ${c.rpcMethodOccurrencesDeduped} total occurrence identities (file+anchor+name ` +
      'deduped) — resolved-name count and occurrence count are DELIBERATELY different measures; see rpcMethodNamesResolved / ' +
      'rpcMethodPlaceholderEntries in the JSON artifact.',
  )
  if (artifact.rpcMethodDuplicateNames.length) {
    lines.push('')
    lines.push(`${artifact.rpcMethodDuplicateNames.length} RPC method name(s) registered at more than one distinct source anchor:`)
    for (const dup of artifact.rpcMethodDuplicateNames) {
      lines.push(`- \`${dup.name}\`: ${dup.occurrences.map((o) => `\`${o.file}:${o.anchor}\``).join(', ')}`)
    }
  }
  lines.push('')
  lines.push('## Main-side census (read-only evidence; write ownership unchanged)')
  lines.push('')
  lines.push(
    `Scanned ${c.mainFilesScanned}/${c.mainFilesTotal} \`src/main/**/*.ts\` files; ` +
      `found ${c.mainRegistrationsTotal} registration call sites (\`ipcMain.handle/on/once/removeHandler/removeAllListeners\` ` +
      `and \`<expr>.webContents.send(...)\`), of which ${c.mainTeardownRegistrations} are teardown-only ` +
      '(`removeHandler`/`removeAllListeners`) and excluded from all matching below.',
  )
  lines.push('')
  lines.push(
    'Matching is **direction-specific** — a preload `on`/`once` (push-event) channel is never matched ' +
      'against an `ipcMain.on` registration (the opposite direction: main RECEIVING from renderer), only ' +
      'against a `webContents.send` producer call site:',
  )
  lines.push('')
  lines.push(
    `- \`invoke\` → \`ipcMain.handle\` (request-handler): ${c.requestChannelsMatchedToHandler}/${c.requestChannelsTotal} matched`,
  )
  lines.push(
    `- \`send\`/\`sendSync\` → \`ipcMain.on\`/\`once\` (fire-and-forget-listener): ${c.fireAndForgetChannelsMatchedToListener}/${c.fireAndForgetChannelsTotal} matched`,
  )
  lines.push(
    `- \`on\`/\`once\` → \`<expr>.webContents.send\` (push-producer): ${c.pushEventChannelsMatchedToProducer}/${c.pushEventChannelsTotal} matched`,
  )
  lines.push('')
  function renderMappingTable(title, mapping) {
    lines.push(`### ${title}`)
    lines.push('')
    lines.push('| Preload channel | Status | Main registration(s) |')
    lines.push('|---|---|---|')
    for (const m of mapping) {
      const regs = m.mainRegistrations
        ? m.mainRegistrations
            .map((r) => `\`${r.file}:${r.anchor}\` (${r.apiSource === 'webContents.send' ? r.apiSource : `${r.apiSource}.${r.kind}`})`)
            .join('; ')
        : '—'
      lines.push(`| \`${m.channel}\` | ${m.status} | ${regs} |`)
    }
    lines.push('')
  }
  renderMappingTable('Request channels (invoke) vs. ipcMain.handle', artifact.requestChannelToHandlerMapping)
  renderMappingTable('Fire-and-forget channels (send/sendSync) vs. ipcMain.on/once', artifact.fireAndForgetChannelToListenerMapping)
  renderMappingTable('Push-event channels (on/once) vs. webContents.send', artifact.pushEventChannelToProducerMapping)
  lines.push('## Gaps register (explicit, not deferred)')
  lines.push('')
  for (const gap of artifact.gapsRegister) {
    lines.push(`- ${gap}`)
  }
  lines.push('')
  lines.push('## Reruns')
  lines.push('')
  lines.push(
    'This document and its paired JSON are regenerated byte-identically for the same ' +
      'frozen source SHA by `node scripts/inventory-source-bridges.mjs`. Raw run records ' +
      'from any single execution (including `.preflight/bridge-audit/*.json`) are fixture ' +
      'evidence of one invocation, never proof of a formal Commitment Protocol record.',
  )
  lines.push('')
  return lines.join('\n')
}

function writeArtifacts(artifact, jsonOutput, mdOutput, allowedRoot, sourceRoot, stagingSuffix) {
  // Guard BEFORE any mkdir/write, per output.
  assertSafeOutputDir(path.dirname(jsonOutput), allowedRoot, sourceRoot)
  assertSafeOutputDir(path.dirname(mdOutput), allowedRoot, sourceRoot)
  const jsonResolved = assertSafeOutputFile(jsonOutput, allowedRoot, sourceRoot)
  const mdResolved = assertSafeOutputFile(mdOutput, allowedRoot, sourceRoot)
  mkdirSync(path.dirname(jsonResolved), { recursive: true })
  mkdirSync(path.dirname(mdResolved), { recursive: true })
  const jsonText = `${JSON.stringify(artifact, null, 2)}\n`
  const mdText = renderMarkdown(artifact)
  stageAndWriteFile(jsonResolved, jsonText, stagingSuffix)
  stageAndWriteFile(mdResolved, mdText, stagingSuffix)
  return { jsonText, mdText }
}

function writeFixtureRecord(artifact, fixtureDir, allowedRoot, sourceRoot, stagingSuffix) {
  const dirResolved = assertSafeOutputDir(fixtureDir, allowedRoot, sourceRoot)
  mkdirSync(dirResolved, { recursive: true })
  const nonce = randomBytes(8).toString('hex')
  const fixturePath = path.join(dirResolved, `run-${nonce}.json`)
  const fixtureResolved = assertSafeOutputFile(fixturePath, allowedRoot, sourceRoot)
  const record = {
    schema: 'drogon.inventory.source-bridges.fixture-run/2',
    note: 'raw run record only — NOT a Commitment Protocol record and NOT proof of parity',
    generatedAtNonce: nonce,
    sourceSha: artifact.source.fullSha,
    counts: artifact.counts,
  }
  stageAndWriteFile(fixtureResolved, `${JSON.stringify(record, null, 2)}\n`, stagingSuffix)
  return fixtureResolved
}

function main() {
  const args = parseArgv(process.argv.slice(2))
  const allowedRoot = path.resolve(args.allowedRoot)
  const artifact = run(args)

  if (args.verify) {
    const priorJson = (() => {
      try {
        return readFileSync(args.jsonOutput, 'utf8')
      } catch {
        return null
      }
    })()
    const priorMd = (() => {
      try {
        return readFileSync(args.mdOutput, 'utf8')
      } catch {
        return null
      }
    })()
    const nextJson = `${JSON.stringify(artifact, null, 2)}\n`
    const nextMd = renderMarkdown(artifact)
    if (priorJson !== nextJson || priorMd !== nextMd) {
      fail('determinism verify failed: rerun does not match artifacts on disk byte-for-byte')
    }
    process.stdout.write('inventory-source-bridges: --verify OK, byte-identical\n')
    return
  }

  writeArtifacts(artifact, args.jsonOutput, args.mdOutput, allowedRoot, args.source, args.stagingSuffix)
  const fixturePath = writeFixtureRecord(artifact, args.fixtureDir, allowedRoot, args.source, args.stagingSuffix)
  process.stdout.write(
    `inventory-source-bridges: wrote ${path.relative(REPO_ROOT, args.jsonOutput)}, ` +
      `${path.relative(REPO_ROOT, args.mdOutput)}, ${path.relative(REPO_ROOT, fixturePath)}\n`,
  )
  process.stdout.write(`counts: ${JSON.stringify(artifact.counts)}\n`)
}

main()
