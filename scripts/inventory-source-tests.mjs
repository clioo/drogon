#!/usr/bin/env node
// Deterministic, read-only inventory of a source checkout's tests.
//
//   node scripts/inventory-source-tests.mjs --source <path> --output <file>
//
// Enumerates EVERY tracked `*.test.*` / `*.spec.*` / `*.e2e.*` filename
// candidate from the current checkout (`git ls-files`, no all-ref scans) and
// records each one — classified, unclassified, unreadable, or symlink-refused,
// never dropped. Runner membership is INFERRED from config bodies read as
// text (vitest `include` lists, playwright `testDir`/`testMatch`, package.json
// `node --test` globs); every membership carries its source anchor and is
// flagged verified:false with recorded limits. `.spec.*` files reached only
// through static imports from runner-matched files are classified
// `imported-spec` with their importers, not as standalone suites.
//
// Hashing is over raw Buffer bytes; text decoding is a separate step, so
// binary fixtures hash correctly. `caseMarkers` are static text occurrences
// only — NOT case counts, and they imply NOTHING about runtime counts in
// either direction (empty tables, comments, and string literals all skew
// them). Status of every entry is "inventory-only": nothing here means a test
// migrated, ran, or passed.
//
// Safety: symlinked files (or files under symlinked ancestor dirs) are
// refused, never followed; outputs inside the source tree, symlinked outputs,
// non-file outputs, and outputs whose resolved parent lands in the source
// tree are refused; staging uses an exclusive random sibling temp file;
// git failures fail closed; CLI parsing is strict. Git paths are POSIX on
// every OS; filesystem access uses platform-native joins.
// INVENTORY_STAGING_SUFFIX pins the staging random part; it is a test-only
// hook so regression tests can stage a preexisting-temp collision.

import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCHEMA = 'drogon.parity-source-tests/2'

function fail(message) {
  process.stderr.write(`inventory-source-tests: ${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const args = { source: null, output: null }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag !== '--source' && flag !== '--output') {
      fail(`unknown argument: ${flag}`)
    }
    const key = flag.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      fail(`missing value for ${flag}`)
    }
    if (args[key] !== null) {
      fail(`duplicate argument: ${flag}`)
    }
    args[key] = value
    index += 1
  }
  if (!args.source || !args.output) {
    fail('usage: --source <checkout> --output <file>')
  }
  return args
}

// Every git invocation fails closed: no silent fallback, no partial output.
function gitText(sourceRoot, ...args) {
  try {
    return execFileSync('git', ['-C', sourceRoot, ...args], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
  } catch (error) {
    fail(`git ${args.join(' ')} failed: ${(error && error.message) || error}`)
  }
}

function sha256Bytes(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

// Minimal glob matcher for textual include lists: `**`, `*`, `?`, `{a,b}`.
// Not a general glob engine — alternation nesting and character classes are
// out of scope and recorded as limits where encountered.
function expandBraces(glob) {
  const open = glob.indexOf('{')
  if (open === -1) {
    return [glob]
  }
  let depth = 0
  let close = -1
  for (let index = open; index < glob.length; index += 1) {
    if (glob[index] === '{') {
      depth += 1
    } else if (glob[index] === '}') {
      depth -= 1
      if (depth === 0) {
        close = index
        break
      }
    }
  }
  if (close === -1) {
    return [glob]
  }
  const parts = []
  let current = ''
  let innerDepth = 0
  for (let index = open + 1; index < close; index += 1) {
    const char = glob[index]
    if (char === '{') {
      innerDepth += 1
      current += char
    } else if (char === '}') {
      innerDepth -= 1
      current += char
    } else if (char === ',' && innerDepth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  const head = glob.slice(0, open)
  const tail = glob.slice(close + 1)
  return parts.flatMap((part) => expandBraces(`${head}${part}${tail}`))
}

function globToRegExpSource(glob) {
  let source = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    if (char === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          source += '(?:.*/)?'
          index += 2
        } else {
          source += '.*'
          index += 1
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else if (/[.+^${}()|[\]\\]/.test(char)) {
      source += `\\${char}`
    } else {
      source += char
    }
  }
  return `^${source}$`
}

function matchGlob(glob, posixPath) {
  if (/[[\]]/.test(glob)) {
    return { matched: false, limited: 'character class in glob; not evaluated' }
  }
  for (const expanded of expandBraces(glob)) {
    if (new RegExp(globToRegExpSource(expanded)).test(posixPath)) {
      return { matched: true, limited: null }
    }
  }
  return { matched: false, limited: null }
}

// Collapse `segment/..` pairs in an include path so globs like
// `cloud/../.github/actions/x.test.mjs` resolve to the tracked POSIX path.
// Leading `..` escaping the repo root is left intact and never matches.
function normalizeDotDot(posixPath) {
  const segments = []
  for (const segment of posixPath.split('/')) {
    if (segment === '..' && segments.length > 0 && segments[segments.length - 1] !== '..') {
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return segments.join('/')
}

const RUNNER_HINT = /\b(vitest|playwright|node\s+--test|pnpm\s+(?:-r\s+)?(?:exec\s+)?run\s+test|pnpm\s+test)\b/
const RELATIVE_RUNNER_HINT = /\b(vitest|playwright|node --test|test)\b/

// Config path (POSIX, repo-root-relative) -> domain/runner labels. This table
// is itself an inference: it names which suite a config's include list feeds.
// Unknown configs fall through to `vitest-unmapped:<path>` rather than being
// forced into a known suite.
const CONFIG_SUITES = {
  'config/vitest.config.ts': {
    domain: 'unit-vitest',
    runner: 'vitest (config/vitest.config.ts)',
  },
  'tests/e2e/vitest.config.ts': {
    domain: 'e2e-computer-vitest',
    runner: 'vitest (tests/e2e/vitest.config.ts)',
  },
  'tests/playwright.config.ts': {
    domain: 'e2e-playwright',
    runner: 'playwright (tests/playwright.config.ts)',
  },
  'mobile/vitest.config.ts': {
    domain: 'mobile-vitest',
    runner: 'vitest (mobile/vitest.config.ts)',
  },
  'cloud/apps/relay/vitest.config.ts': {
    domain: 'cloud-vitest-relay',
    runner: 'vitest (cloud/apps/relay/vitest.config.ts)',
  },
}

// Vitest's documented default include, expanded explicitly because the
// inventory glob engine does not evaluate `?(...)` groups or `[...]` classes.
const VITEST_DEFAULT_INCLUDES = (() => {
  const kinds = ['test', 'spec']
  const extensions = ['ts', 'tsx', 'mts', 'cts', 'mjs', 'cjs', 'js', 'jsx']
  return kinds.flatMap((kind) => extensions.map((extension) => `**/*.${kind}.${extension}`))
})()

// Playwright default testMatch, expanded explicitly for the same reason.
// Verified against the installed stock implementation:
// `node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/lib/common/config.js`
// (`takeFirst(projectConfig.testMatch, config.testMatch,
// "**/*.@(spec|test).?(c|m)[jt]s?(x)")`). The repo's config uses the
// `@stablyai/playwright-test` fork, whose dist bundle was inspected without
// confirming or denying a delta to this default — recorded as a limit on
// every rule that relies on it. It is NOT spec-only: `*.test.*` files under
// the testDir match it too (explicit config includes still outrank it).
const PLAYWRIGHT_DEFAULT_INCLUDES = (() => {
  const kinds = ['spec', 'test']
  const extensions = ['ts', 'tsx', 'mts', 'cts', 'mjs', 'cjs', 'js', 'jsx']
  return kinds.flatMap((kind) => extensions.map((extension) => `**/*.${kind}.${extension}`))
})()

// Package dir (POSIX prefix) -> domain for `node --test` script globs.
const PACKAGE_SCRIPT_SUITES = [
  { prefix: 'docs/site/', domain: 'docs-node', runner: 'node --test (docs/site/package.json)' },
  { prefix: 'cloud/', domain: 'cloud-node', runner: 'node --test / pnpm -r test (cloud/package.json)' },
  { prefix: 'mobile/', domain: 'mobile-node', runner: 'node --test (mobile/package.json)' },
]

// Static text markers in a test file. Occurrence counts, NOT runtime case
// counts, and NOT a lower bound either: `.each` tables may be empty,
// matches may sit in comments or string literals, and conditional
// registration may skip them at runtime.
function staticCaseMarkers(text, isSwift) {
  if (isSwift) {
    return {
      cases: (text.match(/func\s+test\w*\s*\(/g) ?? []).length,
      each: 0,
      skip: (text.match(/XCTSkip/g) ?? []).length,
      todo: 0,
      only: 0,
    }
  }
  return {
    cases: (text.match(/\b(?:it|test)\s*\(\s*['"`]/g) ?? []).length,
    each: (text.match(/\b(?:it|test|describe)\.each\s*\(/g) ?? []).length,
    skip: (text.match(/\b(?:it|test|describe)\.skip\s*\(/g) ?? []).length,
    todo: (text.match(/\b(?:it|test|describe)\.todo\s*\(/g) ?? []).length,
    only: (text.match(/\b(?:it|test|describe)\.only\s*\(/g) ?? []).length,
  }
}

const MARKER_NOTE =
  'static text occurrences of it/test (plus .each/.skip/.todo/.only); NOT runtime case counts and NOT a bound in either direction (empty tables, comments, string literals, conditional registration all skew them)'

// Text-level extraction of a Vitest `include` list. Conditional spreads or
// computed values are recorded as unresolved, never guessed.
function extractVitestIncludes(content) {
  const includeMatch = content.match(/include\s*:\s*\[([^\]]*)\]/s)
  if (!includeMatch) {
    return { includes: [], unresolved: ['include block not found textually'] }
  }
  const rawIncludes = [...includeMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map(
    (match) => match[1] ?? match[2],
  )
  // The `*.test.ts(x)` shorthand means "ts and tsx". Expand it textually so
  // both variants participate; the normalization is recorded on the rule.
  const includes = []
  let shorthandExpanded = false
  for (const raw of rawIncludes) {
    const shorthand = raw.match(/^(.*\.test\.ts)\(x\)$/)
    if (shorthand) {
      includes.push(shorthand[1], `${shorthand[1]}x`)
      shorthandExpanded = true
    } else {
      includes.push(raw)
    }
  }
  const unresolved = []
  if (shorthandExpanded) {
    unresolved.push('`*.test.ts(x)` shorthand expanded textually to .ts + .tsx variants')
  }
  if (/include\s*:\s*\[[^\]]*\]\s*,?\s*\.\.\./.test(content)) {
    unresolved.push('possible conditional spread after include block')
  }
  if (/process\.platform/.test(content)) {
    unresolved.push(
      'config body branches on process.platform; platform-conditional options are not enumerated',
    )
  }
  return { includes, unresolved }
}

// Text-level extraction of a Playwright `testDir`/`testMatch`. When testMatch
// is absent the Playwright documented default (`**/*.spec.ts` under testDir)
// is used as an INFERENCE, flagged defaulted:true with this limit recorded.
function extractPlaywrightDiscovery(content) {
  const dirMatch = content.match(/testDir\s*:\s*['"]([^'"]+)['"]/)
  const testDir = dirMatch ? dirMatch[1] : null
  const matchBlock = content.match(/testMatch\s*:\s*\[([^\]]*)\]/s)
  const patterns = matchBlock
    ? [...matchBlock[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((match) => match[1] ?? match[2])
    : []
  return {
    testDir,
    patterns,
    defaulted: patterns.length === 0,
    unresolved: [
      ...(testDir ? [] : ['testDir not found textually; membership unresolved']),
      ...(patterns.length === 0 ? ['testMatch not found textually'] : []),
      ...(/process\.platform|process\.env/.test(content)
        ? ['config body reads process.platform/env; conditional discovery not enumerated']
        : []),
    ],
  }
}

function extractExcludesFromText(content) {
  return [...content.matchAll(/--exclude=(\S+)/g)].map((match) => match[1])
}

// Relative import specifiers in a module body (`from`, `import()`,
// `require()`), resolved textually — dynamic expressions are not resolved.
function extractRelativeImports(text) {
  const specifiers = new Set()
  for (const match of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
    if (match[1].startsWith('.')) {
      specifiers.add(match[1])
    }
  }
  return [...specifiers]
}

const RESOLVE_EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '.cjs']

function resolveImport(importerPosix, specifier, candidateSet) {
  const base = importerPosix.slice(0, importerPosix.lastIndexOf('/'))
  const segments = `${base}/${specifier}`.split('/')
  const normalized = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      normalized.pop()
      continue
    }
    normalized.push(segment)
  }
  const joined = normalized.join('/')
  for (const extension of RESOLVE_EXTENSIONS) {
    if (candidateSet.has(`${joined}${extension}`)) {
      return `${joined}${extension}`
    }
  }
  for (const extension of RESOLVE_EXTENSIONS.slice(1)) {
    if (candidateSet.has(`${joined}/index${extension}`)) {
      return `${joined}/index${extension}`
    }
  }
  return null
}

function isCandidateName(posixPath) {
  const base = posixPath.slice(posixPath.lastIndexOf('/') + 1)
  return /\.test\.[^./]+$/.test(base) || /\.spec\.[^./]+$/.test(base) || /\.e2e\.[^./]+$/.test(base)
}

function assertOutputParentOutsideSource(outputDir, sourceRoot) {
  let ancestor = outputDir
  const missing = []
  while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
    missing.unshift(basename(ancestor))
    const parent = dirname(ancestor)
    if (parent === ancestor) fail('cannot resolve output ancestry')
    ancestor = parent
  }
  const destination = resolve(realpathSync(ancestor), ...missing)
  if (destination === sourceRoot || destination.startsWith(`${sourceRoot}${sep}`)) {
    fail('refusing to write: output parent resolves inside the source tree')
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const suffixOverride = process.env.INVENTORY_STAGING_SUFFIX
  if (suffixOverride !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(suffixOverride)) {
    fail('INVENTORY_STAGING_SUFFIX must be a safe filename component')
  }

  let sourceRoot
  try {
    sourceRoot = realpathSync(args.source)
    if (!statSync(sourceRoot).isDirectory()) {
      fail(`--source is not a directory: ${args.source}`)
    }
  } catch (error) {
    fail(`--source is not usable: ${error.message}`)
  }

  // Output safety, lexical first: never inside the source tree (or the
  // tree itself), never a symlink leaf, never a directory. The parent chain
  // is then resolved below (after creation) to catch symlinked ancestors and
  // aliases that would redirect the write into the source tree.
  const resolvedOutput = resolve(args.output)
  if (resolvedOutput === sourceRoot || resolvedOutput.startsWith(`${sourceRoot}${sep}`)) {
    fail(`refusing to write output inside the source tree: ${args.output}`)
  }
  try {
    const outputStat = lstatSync(resolvedOutput)
    if (outputStat.isSymbolicLink()) {
      fail(`refusing to write through a symlinked output: ${args.output}`)
    }
    if (outputStat.isDirectory()) {
      fail(`refusing to overwrite a directory: ${args.output}`)
    }
    if (!outputStat.isFile()) {
      fail(`refusing to overwrite non-regular output: ${args.output}`)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      fail(`cannot stat output: ${error.message}`)
    }
  }

  // Git paths are POSIX on every OS: split on '/', never on sep.
  const tracked = gitText(sourceRoot, 'ls-files', '-z').split('\0').filter(Boolean)
  const gitHead = gitText(sourceRoot, 'rev-parse', 'HEAD').trim()
  const gitBranch = gitText(sourceRoot, 'rev-parse', '--abbrev-ref', 'HEAD').trim()
  const porcelain = gitText(sourceRoot, 'status', '--porcelain', '-z').split('\0').filter(Boolean)
  const dirtyTrackedFiles = porcelain.filter((entry) => !entry.startsWith('??')).sort()
  const untrackedCount = porcelain.filter((entry) => entry.startsWith('??')).length

  const files = []
  const gaps = []
  const domains = Object.create(null)
  const symlinkAncestorCache = new Map()

  function ancestorSymlink(posixPath) {
    const segments = posixPath.split('/')
    let prefix = ''
    for (let index = 0; index < segments.length - 1; index += 1) {
      prefix = prefix === '' ? segments[index] : `${prefix}/${segments[index]}`
      if (!symlinkAncestorCache.has(prefix)) {
        let isLink = false
        try {
          isLink = lstatSync(join(sourceRoot, ...prefix.split('/'))).isSymbolicLink()
        } catch {
          isLink = false
        }
        symlinkAncestorCache.set(prefix, isLink)
      }
      if (symlinkAncestorCache.get(prefix)) {
        return prefix
      }
    }
    return null
  }

  // Central safe read: symlinked files and symlinked ancestors are refused,
  // never followed; every outcome is explicit, so no caller can silently
  // follow a link or swallow a read error. Callers must branch on `status`
  // and must never use content from a non-`ok` result as evidence.
  function safeRead(posixPath) {
    const nativePath = join(sourceRoot, ...posixPath.split('/'))
    try {
      if (lstatSync(nativePath).isSymbolicLink()) {
        return { status: 'symlink-self', detail: 'file itself is a symlink' }
      }
    } catch (error) {
      return { status: 'read-error', detail: error.message }
    }
    const badAncestor = ancestorSymlink(posixPath)
    if (badAncestor !== null) {
      return { status: 'ancestor-symlink', detail: `ancestor is a symlink: ${badAncestor}` }
    }
    try {
      return { status: 'ok', buffer: readFileSync(nativePath) }
    } catch (error) {
      return { status: 'read-error', detail: error.message }
    }
  }

  // CI-only excludes, read once through the same refusal policy as safeRead.
  let ciExcludes = []
  let ciExcludeEvidence = null
  try {
    let prefix = sourceRoot
    for (const part of ['.github', 'workflows', 'unit-tests.yml']) {
      prefix = join(prefix, part)
      if (lstatSync(prefix).isSymbolicLink()) {
        throw new Error(`refused: ${part} is a symlink`)
      }
    }
    const unitWorkflow = readFileSync(join(sourceRoot, '.github', 'workflows', 'unit-tests.yml'), 'utf8')
    ciExcludes = extractExcludesFromText(unitWorkflow)
    if (ciExcludes.length > 0) {
      ciExcludeEvidence =
        '.github/workflows/unit-tests.yml (--exclude tokens, sharded CI vitest run)'
    }
  } catch {
    // Workflow absent: recorded as a gap, not fatal.
  }

  // Runner config bodies, read as text. Every tracked vitest/playwright
  // config and every tracked package.json participates; nothing is imported.
  const candidateSet = new Set(tracked.filter(isCandidateName))
  const membershipRules = []
  const packageTestScripts = []
  const runnerConfigPaths = []
  const swiftConfigs = []

  const sortedTracked = [...tracked].sort()
  const configBodies = new Map()
  for (const posixPath of sortedTracked) {
    const base = posixPath.slice(posixPath.lastIndexOf('/') + 1)
    if (
      /(^|\/)(vitest|playwright)\.config\.(ts|mts|js)$/.test(posixPath) ||
      base === 'package.json' ||
      base === 'Package.swift'
    ) {
      const read = safeRead(posixPath)
      if (read.status !== 'ok') {
        gaps.push({
          id: `config:${read.status === 'read-error' ? 'unreadable' : 'symlink-refused'}:${posixPath}`,
          description: `runner config unread via safe read (${read.detail}); its includes/scripts contribute no membership evidence.`,
        })
        continue
      }
      configBodies.set(posixPath, read.buffer.toString('utf8'))
    }
  }

  for (const [posixPath, body] of configBodies) {
    const base = posixPath.slice(posixPath.lastIndexOf('/') + 1)
    if (/(^|\/)(vitest)\.config\.(ts|mts|js)$/.test(posixPath)) {
      const { includes, unresolved } = extractVitestIncludes(body)
      const suite = CONFIG_SUITES[posixPath] ?? {
        domain: `vitest-unmapped:${posixPath}`,
        runner: `vitest (${posixPath})`,
      }
      const configDir = posixPath.includes('/') ? posixPath.slice(0, posixPath.lastIndexOf('/')) : ''
      // Includes resolve against the config's own directory first (the
      // package the config belongs to). Repo-root-relative matching is only
      // a fallback when the scoped interpretation matches nothing at all
      // (e.g. `tests/e2e/vitest.config.ts` run from the repo root) and is
      // flagged as such on every hit it produces.
      membershipRules.push({
        config: posixPath,
        kind: 'vitest-include',
        includes,
        unresolved,
        configDir,
        unmapped: CONFIG_SUITES[posixPath] === undefined,
        ...suite,
      })
      runnerConfigPaths.push(posixPath)
    } else if (/(^|\/)(playwright)\.config\.(ts|mts|js)$/.test(posixPath)) {
      const discovery = extractPlaywrightDiscovery(body)
      if (discovery.defaulted) {
        discovery.patterns = PLAYWRIGHT_DEFAULT_INCLUDES
        discovery.unresolved.push(
          'no testMatch in config body: stock-implementation default used as inference only (fork delta unconfirmed; see header)',
        )
      }
      const suite = CONFIG_SUITES[posixPath] ?? {
        domain: `playwright-unmapped:${posixPath}`,
        runner: `playwright (${posixPath})`,
      }
      const playwrightConfigDir = posixPath.includes('/') ? posixPath.slice(0, posixPath.lastIndexOf('/')) : ''
      const testDirRaw = (discovery.testDir ?? '').replace(/^\.\//, '').replace(/\/$/, '')
      const testDirResolved =
        testDirRaw === '' ? null : normalizeDotDot(playwrightConfigDir === '' ? testDirRaw : `${playwrightConfigDir}/${testDirRaw}`)
      membershipRules.push({
        config: posixPath,
        kind: 'playwright-testDir',
        testDir: discovery.testDir,
        testDirResolved,
        includes: discovery.patterns,
        defaulted: discovery.defaulted,
        unresolved: discovery.unresolved,
        unmapped: CONFIG_SUITES[posixPath] === undefined,
        ...suite,
      })
      runnerConfigPaths.push(posixPath)
    } else if (base === 'package.json') {
      runnerConfigPaths.push(posixPath)
      let scripts = null
      try {
        const parsed = JSON.parse(body)
        scripts = Object.fromEntries(
          Object.entries(parsed.scripts ?? {}).filter(
            ([name, command]) =>
              /(^|[:./-])test/.test(name) || /\b(vitest|playwright|node --test|swift test)\b/.test(String(command)),
          ),
        )
      } catch {
        scripts = null
      }
      packageTestScripts.push({ package: posixPath, scripts })
      if (scripts) {
        const packageDir = posixPath.includes('/') ? posixPath.slice(0, posixPath.lastIndexOf('/') + 1) : ''
        const packagePrefix = packageDir === '' ? '' : packageDir.slice(0, -1)
        for (const [name, command] of Object.entries(scripts)) {
          // Bare `vitest run` (no --config, no file operands): selection is
          // Vitest's documented default include scoped to the package cwd —
          // an inference, flagged defaulted:true with recorded limits.
          if (
            /\bvitest(\s+run)?\b/.test(String(command)) &&
            !/--config/.test(String(command)) &&
            !/\.test\./.test(String(command))
          ) {
            membershipRules.push({
              config: `${posixPath}#${name}`,
              kind: 'vitest-default-include',
              includes: VITEST_DEFAULT_INCLUDES,
              defaulted: true,
              unresolved: [
                'bare `vitest run`: Vitest documented default include used as inference only; actual selection depends on the real cwd and CLI version defaults',
              ],
              configDir: packagePrefix,
              domain: `vitest-default:${packagePrefix || '.'}`,
              runner: `vitest (default include via ${posixPath}#${name}; inferred, unverified)`,
            })
          }
          if (!/\bnode --test\b/.test(String(command))) {
            continue
          }
          const globs = new Set()
          for (const match of String(command).matchAll(/'([^']+)'|"([^"]+)"|(\S+)/g)) {
            const token = match[1] ?? match[2] ?? match[3]
            if (/\.test\.[^/\s]*$/.test(token) || (token.includes('*') && !token.startsWith('-'))) {
              globs.add(token)
            }
          }
          if (globs.size === 0) {
            continue
          }
          const suite =
            PACKAGE_SCRIPT_SUITES.find((entry) => packageDir.startsWith(entry.prefix)) ?? {
              domain: `node-test:${packageDir || '.'}`,
              runner: `node --test (${posixPath})`,
            }
          membershipRules.push({
            config: `${posixPath}#${name}`,
            kind: 'package-node-test',
            includes: [...globs].map((glob) => normalizeDotDot(`${packageDir}${glob}`)),
            unresolved: [
              'shell operators (&&/||/;) split textually; globs are matched as written, not shell-expanded',
              '`..` segments collapsed textually to repo-root-relative form',
            ],
            configDir: '',
            ...suite,
          })
        }
      }
    } else if (base === 'Package.swift') {
      const testTargets = (body.match(/testTarget/g) ?? []).length
      swiftConfigs.push({ path: posixPath, testTargetMentions: testTargets })
      runnerConfigPaths.push(posixPath)
    }
  }

  // Include anchoring, decided per rule GLOBALLY, not per file. A config's
  // includes resolve against its package root: the nearest ancestor dir
  // (starting at the config's own dir) holding a tracked package.json, else
  // the repo root. That root is the primary base (`config/` holds shared
  // configs for the root package; `tests/e2e/vitest.config.ts` belongs to
  // the root package too, which is why its root-relative include works).
  // When the primary base matches nothing globally, the config-dir base is
  // tried and flagged as a fallback; when neither matches, the include is
  // dead (recorded, never silently ignored).
  const trackedSet = new Set(sortedTracked)
  function packageRootFor(configPath) {
    let dir = configPath.includes('/') ? configPath.slice(0, configPath.lastIndexOf('/')) : ''
    for (;;) {
      if (trackedSet.has(dir === '' ? 'package.json' : `${dir}/package.json`)) {
        return dir
      }
      if (dir === '') {
        return ''
      }
      dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
    }
  }
  function baseMatchesAnywhere(prefix, includes) {
    return includes.some((include) => {
      const effective = normalizeDotDot(prefix === '' ? include : `${prefix}/${include}`)
      for (const candidate of candidateSet) {
        if (matchGlob(effective, candidate).matched) {
          return true
        }
      }
      return false
    })
  }
  for (const rule of membershipRules) {
    if (rule.kind === 'vitest-default-include') {
      rule.packageRoot = rule.configDir
      rule.activeBase = rule.configDir
      rule.activeFallback = false
      continue
    }
    if (rule.kind !== 'vitest-include') {
      continue
    }
    rule.packageRoot = packageRootFor(rule.config)
    const configDir = rule.configDir
    if (baseMatchesAnywhere(rule.packageRoot, rule.includes)) {
      rule.activeBase = rule.packageRoot
      rule.activeFallback = false
    } else if (configDir !== '' && configDir !== rule.packageRoot && baseMatchesAnywhere(configDir, rule.includes)) {
      rule.activeBase = configDir
      rule.activeFallback = true
    } else {
      rule.activeBase = rule.packageRoot
      rule.activeFallback = false
      rule.includesDead = true
    }
  }

  // Importer index: for every `.spec.*` candidate missed by include rules,
  // find static importers among runner-reached test files and sibling specs.
  // Reachability through dynamic imports is recorded as unresolved.
  const importerIndex = new Map()
  const importerPool = new Set()
  for (const candidate of candidateSet) {
    if (/\.test\.[^./]+$/.test(candidate) || /\.spec\.[^./]+$/.test(candidate)) {
      importerPool.add(candidate)
    }
  }
  // Importer scan through the central safe read: refused or unreadable
  // files contribute no imports, and their own entries record exactly why
  // (so the skip here is explained, never silent). Binary files are skipped
  // as importers and named in a gap.
  const importerScanSkippedBinary = []
  for (const importer of importerPool) {
    const read = safeRead(importer)
    if (read.status !== 'ok') {
      continue
    }
    if (read.buffer.includes(0)) {
      importerScanSkippedBinary.push(importer)
      continue
    }
    const text = read.buffer.toString('utf8')
    for (const specifier of extractRelativeImports(text)) {
      const target = resolveImport(importer, specifier, candidateSet)
      if (target && target !== importer) {
        if (!importerIndex.has(target)) {
          importerIndex.set(target, [])
        }
        importerIndex.get(target).push(importer)
      }
    }
  }
  if (importerScanSkippedBinary.length > 0) {
    gaps.push({
      id: 'imports:binary-unscanned',
      description: `${importerScanSkippedBinary.length} binary test/spec files skipped as importers (byte content not decoded for import scanning): ${importerScanSkippedBinary.sort().slice(0, 5).join(', ')}${importerScanSkippedBinary.length > 5 ? ', …' : ''}`,
    })
  }

  function matchMembership(posixPath) {
    const hits = []
    const limits = []
    for (const rule of membershipRules) {
      if (rule.kind === 'playwright-testDir') {
        if (!rule.testDirResolved) {
          continue
        }
        for (const include of rule.includes) {
          const effective = normalizeDotDot(`${rule.testDirResolved}/${include}`)
          const { matched, limited } = matchGlob(effective, posixPath)
          if (limited) {
            limits.push(`${rule.config}: glob limit (${limited})`)
          }
          if (matched) {
            hits.push({ rule, include, interpretation: 'config-dir-relative testDir' })
          }
        }
        continue
      }
      // Vitest includes resolve against the rule's active base (package
      // root, or the flagged config-dir fallback). Package-script globs are
      // already repo-root-relative after normalization.
      const prefix =
        (rule.kind === 'vitest-include' || rule.kind === 'vitest-default-include') &&
        rule.activeBase !== ''
          ? `${rule.activeBase}/`
          : ''
      for (const include of rule.includes) {
        const effective = normalizeDotDot(`${prefix}${include}`)
        const { matched, limited } = matchGlob(effective, posixPath)
        if (limited) {
          limits.push(`${rule.config}: glob limit (${limited})`)
        }
        if (matched) {
          let interpretation = 'package-script glob (repo-root-relative after normalization)'
          let fallback = false
          if (rule.kind === 'vitest-default-include') {
            interpretation = 'package-dir-relative (bare `vitest run` default include; inferred, unverified)'
          }
          if (rule.kind === 'vitest-include') {
            fallback = rule.activeFallback === true
            if (fallback) {
              interpretation = 'config-dir-relative fallback (package-root base matched nothing globally)'
            } else if (rule.activeBase === '') {
              interpretation = 'package-root-relative (repo root owns this config)'
            } else {
              interpretation = 'package-root-relative (nearest tracked package.json)'
            }
          }
          hits.push({ rule, include, interpretation, fallback })
        }
      }
    }
    return { hits, limits }
  }

  // Swift test-convention assets are not `.test.`/`.spec.`/`.e2e.` filename
  // candidates, but they are test files by convention (swift `Tests/` dirs,
  // `*Tests.swift` names, `native/` helpers) and stay in the asset
  // denominator explicitly rather than vanishing.
  const swiftConventionSet = new Set(
    sortedTracked.filter(
      (posixPath) =>
        /\.swift$/.test(posixPath) &&
        (/\/Tests\//.test(posixPath) || /Tests\.swift$/.test(posixPath) || posixPath.startsWith('native/')),
    ),
  )

  const recordedPaths = new Set()
  // Decoded texts of readable candidates, reused by the importer scan so no
  // file is read twice and no read error is silently skipped there.
  const readableTexts = new Map()
  for (const posixPath of [...candidateSet].sort()) {
    const entry = { path: posixPath, assetKind: 'filename-candidate' }

    const read = safeRead(posixPath)
    if (read.status !== 'ok') {
      if (read.status === 'read-error') {
        entry.domain = 'unreadable'
        entry.runner = 'unreadable (recorded, never dropped)'
        entry.readError = read.detail
      } else {
        entry.domain = 'symlink-refused'
        entry.runner = 'refused (symlink)'
        entry.symlink = read.detail
        entry.readError = null
      }
      entry.caseMarkers = null
      entry.markerNote = MARKER_NOTE
      files.push(entry)
      recordedPaths.add(posixPath)
      domains[entry.domain] = (domains[entry.domain] ?? 0) + 1
      continue
    }

    // Raw bytes first: hash the Buffer, decode separately for text work.
    const buffer = read.buffer
    entry.bytes = buffer.length
    entry.sha256 = sha256Bytes(buffer)
    const binary = buffer.includes(0)
    entry.binary = binary
    const text = binary ? null : buffer.toString('utf8')
    if (text !== null) {
      readableTexts.set(posixPath, text)
    }

    const base = posixPath.slice(posixPath.lastIndexOf('/') + 1)
    // Scope width for winner selection: narrowest scope owns the file.
    const scopeLength = (hit) => {
      if (hit.rule.kind === 'playwright-testDir') {
        return (hit.rule.testDirResolved ?? '').length
      }
      if (hit.rule.kind === 'vitest-include' || hit.rule.kind === 'vitest-default-include') {
        return (hit.rule.activeBase ?? '').length
      }
      const literal = hit.include.split(/[*?{[]/)[0].replace(/\/$/, '')
      return literal.length
    }
    if (posixPath.includes('__snapshots__/')) {
      entry.domain = 'snapshot'
      entry.runner = 'vitest snapshot assets'
    } else if (posixPath.startsWith('tests/fixtures/') || posixPath.includes('__fixtures__/')) {
      entry.domain = 'fixture'
      entry.runner = 'test fixture asset'
    } else {
      // Membership is path-based: binary content never blocks runner inference.
      const { hits, limits } = matchMembership(posixPath)
      for (const limit of limits) {
        gaps.push({ id: `glob:limit:${posixPath}`, description: limit })
      }
      // `.spec.*` files always take the spec branch below (explicit
      // selection vs import reachability), even when glob hits exist.
      if (hits.length > 0 && !/\.spec\.[^./]+$/.test(base)) {
        // Specificity wins: the narrowest scope owns the file (a package's
        // own `vitest run` beats the root's). Losers stay visible as
        // `alsoMatched` so ambiguous selection is explicit, never silent.
        // Rank: explicit config selection first (an include that names the
        // file beats any default inference — e.g. the root Vitest include
        // `tests/e2e/**/*.unit.test.ts` beats the Playwright default under
        // the same testDir), then narrowest scope, then rule order. Stable
        // and deterministic.
        const rankKey = (item) => [
          item.hit.rule.defaulted === true ? 0 : 1,
          item.scope,
          -item.index,
        ]
        const ranked = hits
          .map((hit, index) => ({ hit, index, scope: scopeLength(hit) }))
          .sort((left, right) => {
            const [le, ls, li] = rankKey(left)
            const [re, rs, ri] = rankKey(right)
            return re - le || rs - ls || ri - li
          })
        const winner = ranked[0].hit
        const losers = ranked.slice(1).map((item) => item.hit)
        entry.domain = winner.rule.domain
        entry.runner = winner.rule.runner
        entry.membership = [{
          config: winner.rule.config,
          kind: winner.rule.kind,
          include: winner.include,
          interpretation: winner.interpretation,
          inference: 'static-glob-match',
          verified: false,
          ...(winner.fallback ? { fallback: true } : {}),
        }]
        if (losers.length > 0) {
          entry.alsoMatched = losers.map((hit) => ({
            config: hit.rule.config,
            kind: hit.rule.kind,
            include: hit.include,
            interpretation: hit.interpretation,
            inference: 'static-glob-match',
            verified: false,
            ...(hit.fallback ? { fallback: true } : {}),
          }))
        }
        if (hits.some((hit) => hit.fallback)) {
          entry.membershipLimits = [
            ...(entry.membershipLimits ?? []),
            'config-dir fallback: include resolved against the config dir because the package-root base matched nothing globally; verify against the real invocation cwd',
          ]
        }
        if (winner.rule.unresolved && winner.rule.unresolved.length > 0) {
          entry.membershipLimits = winner.rule.unresolved
        }
        if (winner.rule.unmapped) {
          entry.membershipLimits = [...(entry.membershipLimits ?? []), 'config has no suite mapping; domain derived from config path']
        }
        if (winner.rule.defaulted) {
          entry.membershipLimits = [...(entry.membershipLimits ?? []), 'include defaulted (see config unresolved notes)']
        }
      } else if (/^(tsconfig|jsconfig)[^/]*\.[^./]+$/.test(base)) {
        entry.domain = 'config-adjacent'
        entry.runner = 'config file colliding with a candidate filename pattern; not a test (kept in the denominator)'
        entry.membership = []
      } else if (/\.spec\.[^./]+$/.test(base)) {
        // Explicit config selection beats import reachability; bare-default
        // selection is recorded alongside (a default-collected spec runs
        // standalone too). Importer-only specs are helpers, not suites.
        const explicit = hits.filter((hit) => hit.rule.kind !== 'vitest-default-include')
        const defaults = hits.filter((hit) => hit.rule.kind === 'vitest-default-include')
        const importers = (importerIndex.get(posixPath) ?? []).sort()
        const toMembership = (hit) => ({
          config: hit.rule.config,
          kind: hit.rule.kind,
          include: hit.include,
          interpretation: hit.interpretation,
          inference: 'static-glob-match',
          verified: false,
          ...(hit.fallback ? { fallback: true } : {}),
        })
        if (explicit.length > 0) {
          const ranked = explicit
            .map((hit, index) => ({ hit, index, scope: scopeLength(hit) }))
            .sort((left, right) => right.scope - left.scope || left.index - right.index)
          const winner = ranked[0].hit
          entry.domain = winner.rule.domain
          entry.runner = winner.rule.runner
          entry.membership = [toMembership(winner)]
          entry.membershipLimits = [...(winner.rule.unresolved ?? [])]
          if (winner.rule.unmapped) {
            entry.membershipLimits.push('config has no suite mapping; domain derived from config path')
          }
          if (winner.rule.defaulted) {
            entry.membershipLimits.push('include defaulted (see config unresolved notes)')
          }
          const rest = [...ranked.slice(1).map((item) => item.hit), ...defaults]
          if (rest.length > 0) {
            entry.alsoMatched = rest.map(toMembership)
          }
          if (importers.length > 0) {
            entry.reachedVia = importers
          }
        } else if (importers.length > 0) {
          entry.domain = 'imported-spec'
          entry.runner = 'reached via static import from a test file (unverified execution)'
          entry.reachedVia = importers
          entry.membership = []
          if (defaults.length > 0) {
            entry.alsoMatched = defaults.map(toMembership)
          }
          entry.membershipLimits = [
            'static relative imports only; dynamic import() expressions are not resolved',
            'inclusion in a runner process is inferred from the importer, not verified by execution',
          ]
        } else if (defaults.length > 0) {
          // Standalone via bare-default selection: no importer, but a
          // default include would collect the file on its own. Assigned as
          // inferred membership, never as unresolved.
          const rankedDefaults = defaults
            .map((hit, index) => ({ hit, index, scope: scopeLength(hit) }))
            .sort((left, right) => right.scope - left.scope || left.index - right.index)
          const winner = rankedDefaults[0].hit
          entry.domain = winner.rule.domain
          entry.runner = winner.rule.runner
          entry.membership = [toMembership(winner)]
          entry.membershipLimits = [
            ...(winner.rule.unresolved ?? []),
            'standalone via bare-default include only (no static importer); inferred, unverified',
          ]
          const rest = rankedDefaults.slice(1).map((item) => item.hit)
          if (rest.length > 0) {
            entry.alsoMatched = rest.map(toMembership)
          }
        } else {
          entry.domain = 'imported-spec-unresolved'
          entry.runner = 'no static importer found; runner reachability unresolved'
          entry.membership = []
          entry.membershipLimits = [
            'may be a direct entrypoint for reliability gates or an orphan; see gaps register',
          ]
        }
      } else if (/\.swift$/.test(base) && /(^|\/)Tests\//.test(posixPath)) {
        entry.domain = 'native-swift'
        entry.runner = 'swift test (Package.swift testTarget; inferred, unverified)'
        entry.membership = []
        entry.membershipLimits = ['matched by Tests-dir convention, not by a resolved swift package graph']
      } else if (/\.swift$/.test(base) && posixPath.startsWith('native/')) {
        entry.domain = 'native-swift'
        entry.runner = 'swift test (Package.swift testTarget; inferred, unverified)'
        entry.membership = []
        entry.membershipLimits = ['matched by native/ prefix convention, not by a resolved swift package graph']
      } else {
        entry.domain = 'unclassified'
        entry.runner = 'no runner inference; reachability unresolved (kept, never dropped)'
        entry.membership = []
      }
    }

    if (ciExcludes.length > 0 && entry.domain && !['snapshot', 'fixture'].includes(entry.domain)) {
      entry.ciExcluded = ciExcludes.some((pattern) => {
        if (pattern.endsWith('/**')) {
          return posixPath.startsWith(pattern.slice(0, -2))
        }
        return posixPath === pattern
      })
    }
    if (text !== null) {
      entry.caseMarkers = staticCaseMarkers(text, (entry.domain ?? '').startsWith('native-swift'))
    } else {
      entry.caseMarkers = null
    }
    entry.markerNote = MARKER_NOTE
    files.push(entry)
    recordedPaths.add(posixPath)
    domains[entry.domain] = (domains[entry.domain] ?? 0) + 1
  }

  for (const posixPath of [...swiftConventionSet].sort()) {
    if (recordedPaths.has(posixPath)) {
      continue
    }
    const entry = { path: posixPath, assetKind: 'swift-convention' }
    const read = safeRead(posixPath)
    if (read.status !== 'ok') {
      if (read.status === 'read-error') {
        entry.domain = 'unreadable'
        entry.runner = 'unreadable (recorded, never dropped)'
        entry.readError = read.detail
      } else {
        entry.domain = 'symlink-refused'
        entry.runner = 'refused (symlink)'
        entry.symlink = read.detail
      }
      entry.caseMarkers = null
      entry.markerNote = MARKER_NOTE
      files.push(entry)
      recordedPaths.add(posixPath)
      domains[entry.domain] = (domains[entry.domain] ?? 0) + 1
      continue
    }
    const buffer = read.buffer
    entry.bytes = buffer.length
    entry.sha256 = sha256Bytes(buffer)
    entry.binary = buffer.includes(0)
    entry.domain = 'native-swift'
    entry.runner = 'swift test (Package.swift testTarget; inferred, unverified)'
    entry.membership = []
    entry.membershipLimits = ['matched by Tests-dir/name/native-prefix convention, not by a resolved swift package graph']
    const text = entry.binary ? null : buffer.toString('utf8')
    entry.caseMarkers = text === null ? null : staticCaseMarkers(text, true)
    entry.markerNote = MARKER_NOTE
    files.push(entry)
    recordedPaths.add(posixPath)
    domains[entry.domain] = (domains[entry.domain] ?? 0) + 1
  }

  // Importer reachability fixpoint, decided globally after classification.
  // Roots are files with rule membership (they run standalone); a spec is
  // reached iff some importer chain bottoms out in a root. Importer cycles
  // and dead ends with no root are NOT runner reachability: they are
  // demoted with their unproven roots recorded explicitly.
  {
    const reached = new Set()
    for (const item of files) {
      if (
        (item.membership?.length ?? 0) > 0 &&
        item.domain !== 'imported-spec' &&
        item.domain !== 'imported-spec-unresolved'
      ) {
        reached.add(item.path)
      }
    }
    let changed = true
    while (changed) {
      changed = false
      for (const item of files) {
        if (reached.has(item.path) || !Array.isArray(item.reachedVia)) {
          continue
        }
        if (item.reachedVia.some((importer) => reached.has(importer))) {
          reached.add(item.path)
          changed = true
        }
      }
    }
    let unproven = 0
    for (const item of files) {
      if (item.domain === 'imported-spec' && !reached.has(item.path)) {
        item.domain = 'imported-spec-unproven-roots'
        item.runner =
          'importers form a cycle or dead end with no runner-reached root; not runner reachability'
        item.unprovenRoots = (item.reachedVia ?? []).filter((importer) => !reached.has(importer)).sort()
        unproven += 1
      }
    }
    if (unproven > 0) {
      gaps.push({
        id: 'candidates:imported-spec-unproven-roots',
        description: `${unproven} .spec files have importers but no chain reaching a runner-selected file; recorded with unprovenRoots, not as reachable suites.`,
      })
    }
  }

  // Non-candidate tracked assets that still matter: runner configs, CI
  // workflows/actions, swift package manifests, package.json test scripts.
  const infraFiles = []
  for (const posixPath of sortedTracked) {
    const base = posixPath.slice(posixPath.lastIndexOf('/') + 1)
    const isRunnerConfig =
      /(^|\/)(vitest|playwright)\.config\.(ts|mts|js)$/.test(posixPath) ||
      base === 'package.json' ||
      base === 'Package.swift'
    const isWorkflow =
      posixPath.startsWith('.github/workflows/') && /\.ya?ml$/.test(posixPath)
    const isAction = /^\.github\/actions\//.test(posixPath) && base === 'action.yml'
    if (!isRunnerConfig && !isWorkflow && !isAction) {
      continue
    }
    if (candidateSet.has(posixPath)) {
      continue
    }
    // Refused or unreadable infra is recorded as a gap stub; its data is
    // never taken as evidence (no includes, no scripts, no invocation flags).
    const infraRead = safeRead(posixPath)
    if (infraRead.status !== 'ok') {
      const kindGuess = /vitest\.config\.|playwright\.config\.|package\.json$/.test(posixPath)
        ? 'runner-config'
        : base === 'Package.swift'
          ? 'native-swift-config'
          : /^\.github\/actions\//.test(posixPath)
            ? 'ci-action'
            : 'ci-workflow'
      files.push({
        path: posixPath,
        assetKind: 'infra-unavailable',
        domain: kindGuess,
        runner: `${kindGuess} (safe-read ${infraRead.status}; recorded as gap, data not taken)`,
        ...(infraRead.status === 'read-error'
          ? { readError: infraRead.detail }
          : { symlink: infraRead.detail, readError: null }),
        markerNote: MARKER_NOTE,
      })
      domains[kindGuess] = (domains[kindGuess] ?? 0) + 1
      gaps.push({
        id: `infra:${infraRead.status === 'read-error' ? 'unreadable' : 'symlink-refused'}:${posixPath}`,
        description: `${posixPath}: ${infraRead.detail}; excluded from all discovery evidence.`,
      })
      continue
    }
    const buffer = infraRead.buffer
    const text = buffer.includes(0) ? null : buffer.toString('utf8')
    const entry = {
      path: posixPath,
      bytes: buffer.length,
      sha256: sha256Bytes(buffer),
      binary: buffer.includes(0),
    }
    if (isRunnerConfig && base !== 'package.json' && base !== 'Package.swift') {
      entry.domain = 'runner-config'
      entry.runner = 'config body inventoried (read as text, never evaluated)'
      if (text !== null && /(^|\/)vitest\.config\.(ts|mts|js)$/.test(posixPath)) {
        entry.vitestIncludes = extractVitestIncludes(text)
      }
      if (text !== null && /(^|\/)playwright\.config\.(ts|mts|js)$/.test(posixPath)) {
        entry.playwrightDiscovery = extractPlaywrightDiscovery(text)
      }
    } else if (base === 'package.json') {
      entry.domain = 'runner-config'
      entry.runner = 'package.json test scripts inventoried (parsed as JSON, never executed)'
      const record = packageTestScripts.find((item) => item.package === posixPath)
      entry.testScripts = record ? record.scripts : null
      if (entry.testScripts === null) {
        gaps.push({
          id: `config-parse:${posixPath}`,
          description: 'package.json did not parse as JSON.',
        })
      }
    } else if (base === 'Package.swift') {
      entry.domain = 'native-swift-config'
      entry.runner = 'swift package manifest (read as text, never built)'
      const record = swiftConfigs.find((item) => item.path === posixPath)
      entry.testTargetMentions = record ? record.testTargetMentions : 0
    } else if (isAction) {
      entry.domain = 'ci-action'
      entry.runner = 'composite action definition (read as text)'
      entry.invokesTestRunner = text !== null && RUNNER_HINT.test(text)
    } else if (isWorkflow && text !== null && (RUNNER_HINT.test(text) || /\btest:e2e\b/.test(text))) {
      entry.domain = 'ci-workflow'
      entry.runner = 'CI workflow invoking test runners (read as text)'
      const excludes = extractExcludesFromText(text)
      if (excludes.length > 0) {
        entry.ciExcludes = excludes
      }
      entry.invokesTestRunner = RELATIVE_RUNNER_HINT.test(text) || /\btest:e2e\b/.test(text)
    } else {
      continue
    }
    entry.markerNote = MARKER_NOTE
    infraFiles.push(entry)
    domains[entry.domain] = (domains[entry.domain] ?? 0) + 1
  }

  // The denominator is frozen by construction: every filename candidate is
  // recorded. Anything else would be an internal error, failed closed here.
  const missing = [...candidateSet].filter((candidate) => !recordedPaths.has(candidate)).sort()
  if (missing.length > 0) {
    fail(`internal error: ${missing.length} candidates unrecorded (e.g. ${missing.slice(0, 3).join(', ')})`)
  }

  const countBy = (predicate) => files.filter(predicate).length
  const census = {
    testNames: [...candidateSet].filter((path) => /\.test\.[^./]+$/.test(path.slice(path.lastIndexOf('/') + 1))).length,
    specNames: [...candidateSet].filter((path) => /\.spec\.[^./]+$/.test(path.slice(path.lastIndexOf('/') + 1))).length,
    e2eNames: [...candidateSet].filter((path) => /\.e2e\.[^./]+$/.test(path.slice(path.lastIndexOf('/') + 1))).length,
  }

  if (ciExcludes.length === 0) {
    gaps.push({
      id: 'ci-excludes:not-found',
      description:
        'No --exclude tokens found in the unit CI workflow; CI-only exclusions could not be verified from text.',
    })
  }
  gaps.push({
    id: 'cases:static-markers-only',
    description:
      'caseMarkers are static text occurrences of it/test (plus .each/.skip/.todo/.only); they are NOT runtime case counts and imply nothing in either direction (empty tables, comments, string literals, conditional registration).',
  })
  gaps.push({
    id: 'workflows:dynamic-matrix',
    description:
      'CI invocations with parameterised matrices (git-version compatibility containers, node-version shards, playwright shards) expand at runtime; per-matrix-case counts are not statically resolvable.',
  })
  gaps.push({
    id: 'cloud:pnpm-recursive',
    description:
      'cloud/package.json `test` runs `pnpm -r test` plus an explicit node --test list; recursive workspace discovery is resolved by pnpm at runtime, not enumerated here beyond tracked cloud test files.',
  })
  gaps.push({
    id: 'reachability:inferred-not-verified',
    description:
      'Every membership entry is a static-glob inference (verified:false) against config bodies read as text; actual runner selection (negations, projects, shard splits, computed includes) is verified only by running the suite, which this inventory never does.',
  })
  for (const rule of membershipRules) {
    if (rule.kind === 'vitest-default-include') {
      gaps.push({
        id: `vitest-include:defaulted:${rule.config}`,
        description: `${rule.config}: bare \`vitest run\` — selection is the documented default include scoped to the package cwd, used as inference only (verified:false on every hit).`,
      })
    }
    if (rule.kind === 'vitest-include' && rule.activeFallback) {
      gaps.push({
        id: `vitest-include:configdir-fallback:${rule.config}`,
        description: `${rule.config}: includes match nothing under the package root, so membership uses the flagged config-dir-relative fallback; verify against the real invocation cwd before trusting selection.`,
      })
    }
    if (rule.kind === 'vitest-include' && rule.includesDead) {
      gaps.push({
        id: `vitest-include:dead:${rule.config}`,
        description: `${rule.config}: includes match no tracked candidate under any base; the include list may be stale, conditional, or satisfied only at runtime.`,
      })
    }
    if (rule.kind === 'vitest-include' && rule.unresolved.length > 0) {
      gaps.push({
        id: `vitest-include:conditional:${rule.config}`,
        description: `${rule.config} has unresolved include aspects: ${rule.unresolved.join('; ')}`,
      })
    }
    if (rule.kind === 'playwright-testDir' && (rule.unresolved.length > 0 || rule.defaulted)) {
      gaps.push({
        id: `playwright-discovery:${rule.config}`,
        description: `${rule.config}: ${(rule.unresolved.join('; ') || 'no unresolved aspects')}; testDir=${rule.testDir ?? 'unknown'}`,
      })
    }
    if (rule.unmapped) {
      gaps.push({
        id: `config:unmapped-suite:${rule.config}`,
        description: `${rule.config} has no suite mapping; matched files use a config-derived domain.`,
      })
    }
  }
  for (const rule of membershipRules) {
    if (rule.kind !== 'vitest-include') {
      continue
    }
    let body = null
    const recheck = safeRead(rule.config)
    if (recheck.status === 'ok' && !recheck.buffer.includes(0)) {
      body = recheck.buffer.toString('utf8')
    } else if (recheck.status !== 'ok') {
      gaps.push({
        id: `config:recheck-unreadable:${rule.config}`,
        description: `${rule.config}: reread for computed-include detection failed (${recheck.detail}); the earlier-parsed body stands, the rescan is skipped.`,
      })
    }
    if (body !== null && /readdirSync|readFileSync/.test(body)) {
      gaps.push({
        id: `vitest-include:computed:${rule.config}`,
        description:
          'config computes part of its discovery at runtime by reading the filesystem; the resolved set is not statically recoverable and was not enumerated.',
      })
    }
  }
  const unclassifiedCount = countBy((entry) => entry.domain === 'unclassified')
  if (unclassifiedCount > 0) {
    gaps.push({
      id: 'candidates:unclassified-present',
      description: `${unclassifiedCount} filename candidates match no runner inference; they are recorded with domain "unclassified" and unresolved reachability — kept in the denominator, never dropped.`,
    })
  }
  const unresolvedSpecCount = countBy((entry) => entry.domain === 'imported-spec-unresolved')
  if (unresolvedSpecCount > 0) {
    gaps.push({
      id: 'candidates:imported-spec-unresolved',
      description: `${unresolvedSpecCount} .spec files have no static importer among test/spec files; they may be reliability-gate entrypoints or orphans — runner reachability unresolved.`,
    })
  }
  const symlinkCount = countBy((entry) => entry.domain === 'symlink-refused')
  if (symlinkCount > 0) {
    gaps.push({
      id: 'candidates:symlink-refused',
      description: `${symlinkCount} candidates refused (symlink file or ancestor); targets never followed or hashed.`,
    })
  }
  const unreadableCount = countBy((entry) => entry.domain === 'unreadable')
  if (unreadableCount > 0) {
    gaps.push({
      id: 'candidates:unreadable',
      description: `${unreadableCount} candidates could not be read; recorded with the error, never dropped.`,
    })
  }

  const allFiles = [...files, ...infraFiles].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )

  const inventory = {
    schema: SCHEMA,
    status: 'inventory-only',
    statusNote:
      'inventory-only: entries record discovered tests and assets, not migrated, executed, or passing work.',
    source: {
      root: sourceRoot,
      gitHead,
      gitBranch,
      dirtyTrackedFiles,
      untrackedCount,
      trackedFileCount: tracked.length,
    },
    stats: {
      candidateCensus: census,
      candidateTotal: candidateSet.size,
      recordedCandidates: files.filter((entry) => entry.assetKind === 'filename-candidate').length,
      extraAssets: files.filter((entry) => entry.assetKind !== 'filename-candidate').length,
      unexplainedMissing: missing.length,
      domains: Object.fromEntries(
        Object.entries(domains).sort(([left], [right]) => (left < right ? -1 : 1)),
      ),
      ciExcludes,
      ciExcludeEvidence,
      runnerConfigs: runnerConfigPaths.sort(),
      packageTestScripts: packageTestScripts
        .map((item) => ({ package: item.package, scripts: item.scripts }))
        .sort((left, right) => (left.package < right.package ? -1 : 1)),
      membershipRules: membershipRules.map((rule) => ({
        config: rule.config,
        kind: rule.kind,
        domain: rule.domain,
        runner: rule.runner,
        includes: rule.includes,
        ...(rule.testDir ? { testDir: rule.testDir } : {}),
        ...(rule.defaulted ? { defaulted: true } : {}),
        unresolved: rule.unresolved,
      })),
    },
    gaps: gaps.sort((left, right) => (left.id < right.id ? -1 : 1)),
    files: allFiles,
  }

  const payload = `${JSON.stringify(inventory, null, 2)}\n`
  const outputDir = dirname(resolvedOutput)
  try {
    assertOutputParentOutsideSource(outputDir, sourceRoot)
    mkdirSync(outputDir, { recursive: true })
  } catch (error) {
    fail(`cannot create output directory: ${error.message}`)
  }
  // Recheck after creation; refusal must also precede the first mkdir.
  try {
    const realParent = realpathSync(outputDir)
    if (realParent === sourceRoot || realParent.startsWith(`${sourceRoot}${sep}`)) {
      fail(`refusing to write: output parent resolves inside the source tree: ${realParent}`)
    }
  } catch (error) {
    fail(`cannot resolve output directory: ${error.message}`)
  }
  // Atomic, exclusive staging: a random sibling name created with `wx`, so
  // a preexisting file or symlink at the temp path fails closed instead of
  // being followed or overwritten. INVENTORY_STAGING_SUFFIX pins the random
  // part; it exists only so tests can stage a preexisting-temp collision.
  let staging = ''
  let stagedFd = null
  let stagedCreated = false
  for (let attempt = 0; attempt < 10 && stagedFd === null; attempt += 1) {
    const tag = suffixOverride ?? `${process.pid}-${randomBytes(8).toString('hex')}`
    staging = join(outputDir, `.inventory-${tag}.tmp`)
    try {
      stagedFd = openSync(staging, 'wx', 0o600)
      stagedCreated = true
    } catch (error) {
      if (error.code !== 'EEXIST') {
        fail(`cannot stage output: ${error.message}`)
      }
      if (suffixOverride !== undefined) {
        fail(`refusing to stage output: temp path already exists: ${staging}`)
      }
    }
  }
  if (stagedFd === null) {
    fail('cannot stage output: no unique temp name after 10 attempts')
  }
  try {
    writeSync(stagedFd, payload, null, 'utf8')
  } catch (error) {
    try {
      closeSync(stagedFd)
    } catch {
      // Best effort cleanup only.
    }
    try {
      if (stagedCreated) {
        unlinkSync(staging)
      }
    } catch {
      // Best effort cleanup only.
    }
    fail(`cannot write output: ${error.message}`)
  }
  try {
    closeSync(stagedFd)
  } catch (error) {
    fail(`cannot write output: ${error.message}`)
  }
  try {
    renameSync(staging, resolvedOutput)
  } catch (error) {
    try {
      unlinkSync(staging)
    } catch {
      // Best effort cleanup only.
    }
    fail(`cannot write output: ${error.message}`)
  }
  const candidateEntries = files.filter((entry) => entry.assetKind === 'filename-candidate').length
  process.stdout.write(
    `inventory: ${candidateEntries} candidates + ${files.length - candidateEntries} swift-convention + ${infraFiles.length} infra from ${tracked.length} tracked files -> ${resolvedOutput}\n`,
  )
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  main()
}
