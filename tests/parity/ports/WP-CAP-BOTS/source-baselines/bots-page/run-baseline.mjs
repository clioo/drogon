import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CapsuleRefusal,
  evaluateExecution,
  loadManifest,
  readManifestDigest,
  stageCapsule
} from '../../../../../../scripts/run-parity-baseline-capsule.mjs'
import { verifyPackageRuntime } from '../../../../../../scripts/capsule-package-runtime.mjs'
import { snapshotTransportPackage } from '../../../../../../scripts/transport-capsule-runtime.mjs'

const sourceRoot = '/Users/carlos/Documents/Drogon-mentu-session'
const nodeBin = '/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
const vitestEntry = '/Users/carlos/Documents/Drogon-mentu-session/node_modules/vitest/vitest.mjs'
const manifestPath = fileURLToPath(new URL('./manifest.json', import.meta.url))
const standinRoot = fileURLToPath(new URL('./standins', import.meta.url))
const standinNames = ['store.ts', 'launch-drogon-bot-session.ts', 'agent-catalog.ts']
const expectedSupplemental = {
  '@testing-library/react': '16.3.2',
  'lucide-react': '0.577.0',
  'class-variance-authority': '0.7.1',
  'radix-ui': '1.6.2',
  'clsx': '2.1.1',
  'tailwind-merge': '3.5.0'
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// Thrown for a malformed CLI invocation only; validated fully before any
// side effect (staging, caching, temp dirs, or process spawns) happens.
class CliRefusal extends Error {}

// Read-only: resolves supplemental package metadata for both --check and
// --execute. Never writes; staging the resolved runtime is a separate step.
// `root` and `expected` are injectable so tests can point this at a
// throwaway fixture tree instead of the real source checkout.
function resolveSupplementalRuntime(root = sourceRoot, expected = expectedSupplemental) {
  return Object.entries(expected).map(([name, expectedVersion]) => {
    const packageRoot = realpathSync(path.join(root, 'node_modules', name))
    const packageFile = path.join(packageRoot, 'package.json')
    const metadata = JSON.parse(readFileSync(packageFile, 'utf8'))
    if (metadata.name !== name || metadata.version !== expectedVersion) {
      throw new Error(`Supplemental runtime mismatch for ${name}`)
    }
    return {
      name,
      version: metadata.version,
      packageRoot,
      packageFile,
      packageSha256: sha256(readFileSync(packageFile)),
      ...snapshotTransportPackage(packageRoot)
    }
  })
}

function stageSupplementalRuntime(runtime, capsuleRoot) {
  for (const entry of runtime) {
    const target = path.join(capsuleRoot, 'node_modules', ...entry.name.split('/'))
    if (existsSync(target)) throw new Error(`Dependency target already exists: ${target}`)
    mkdirSync(path.dirname(target), { recursive: true })
    symlinkSync(entry.packageRoot, target, 'junction')
  }
}

function verifySupplementalRuntime(runtime, capsuleRoot) {
  verifyPackageRuntime(runtime, capsuleRoot)
  for (const entry of runtime) {
    const actual = snapshotTransportPackage(entry.packageRoot)
    if (actual.treeSha256 !== entry.treeSha256 || actual.totalBytes !== entry.totalBytes) {
      throw new Error(`Supplemental runtime changed since staging: ${entry.name}`)
    }
  }
}

function stageStandins(capsuleRoot) {
  const targetRoot = path.join(capsuleRoot, '.capsule-fixtures')
  mkdirSync(targetRoot)
  return standinNames.map((name) => {
    const source = path.join(standinRoot, name)
    const target = path.join(targetRoot, name)
    if (!lstatSync(source).isFile()) throw new Error(`Stand-in is not a regular file: ${name}`)
    copyFileSync(source, target)
    const digest = sha256(readFileSync(target))
    if (digest !== sha256(readFileSync(source))) throw new Error(`Stand-in copy mismatch: ${name}`)
    return { name, source, target, sha256: digest }
  })
}

// Read-only equivalent of stageStandins: confirms each fixture seam exists
// and hashes it, without copying anything into a capsule. `root`/`names`
// are injectable so tests can point this at a throwaway fixture directory.
function readOnlyStandinsCheck(root = standinRoot, names = standinNames) {
  return names.map((name) => {
    const source = path.join(root, name)
    try {
      if (!lstatSync(source).isFile()) throw new Error('not a regular file')
      return { name, source, sha256: sha256(readFileSync(source)), ok: true, problem: null }
    } catch (error) {
      return { name, source, sha256: null, ok: false, problem: error.message }
    }
  })
}

// Read-only equivalent of the source-revision pin stageCapsule enforces
// before it stages anything: `git rev-parse` only, never a write. `root`
// is injectable so tests can point this at a throwaway git fixture.
function readOnlySourceRevisionCheck(expectedRevision, root = sourceRoot) {
  try {
    const actual = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (actual !== expectedRevision) {
      return { ok: false, actual, problem: `Source revision mismatch: manifest pins ${expectedRevision}, source-root HEAD is ${actual}.` }
    }
    return { ok: true, actual, problem: null }
  } catch (error) {
    return { ok: false, actual: null, problem: `Could not read source revision via git: ${error.message}` }
  }
}

// `nodeBinPath`/`vitestEntryPath` are injectable so tests can point this
// at throwaway fixture paths instead of the real runner binaries.
function readOnlyBinaryCheck(nodeBinPath = nodeBin, vitestEntryPath = vitestEntry) {
  return {
    nodeBin: { path: nodeBinPath, exists: existsSync(nodeBinPath) },
    vitestEntry: { path: vitestEntryPath, exists: existsSync(vitestEntryPath) }
  }
}

function writeExecutionConfig(capsuleRoot) {
  const configPath = path.join(capsuleRoot, 'bots-page.vitest.config.mjs')
  const contents = `import path from 'node:path'\n\nconst root = ${JSON.stringify(capsuleRoot)}\nconst renderer = path.join(root, 'src/renderer/src')\nconst fixtures = path.join(root, '.capsule-fixtures')\n\nexport default {\n  cacheDir: path.join(root, '.vitest-cache'),\n  define: { ORCA_FEATURE_WALL_ENABLED: 'true' },\n  esbuild: { jsx: 'automatic' },\n  plugins: [{\n    name: 'wp-cap-bots-unobserved-url-assets',\n    enforce: 'pre',\n    resolveId(id) { return id.endsWith('?url') ? '\\0wp-cap-bots-asset:' + id : null },\n    load(id) { return id.startsWith('\\0wp-cap-bots-asset:') ? 'export default ' + JSON.stringify('capsule://unobserved-asset') : null }\n  }],\n  resolve: { alias: [\n    { find: '@/store', replacement: path.join(fixtures, 'store.ts') },\n    { find: '@/lib/launch-drogon-bot-session', replacement: path.join(fixtures, 'launch-drogon-bot-session.ts') },\n    { find: '@/lib/agent-catalog', replacement: path.join(fixtures, 'agent-catalog.ts') },\n    { find: '@', replacement: renderer }\n  ] },\n  test: {\n    environment: 'node',\n    execArgv: ['--no-experimental-webstorage', '--expose-gc'],\n    setupFiles: [\n      path.join(root, 'config/scripts/happy-dom-offscreen-canvas.ts'),\n      path.join(root, 'config/scripts/happy-dom-mutation-observer-retention.ts')\n    ],\n    include: ['src/renderer/src/components/bots/BotsPage.test.tsx'],\n    hookTimeout: 60000,\n    testTimeout: 30000\n  }\n}\n`
  writeFileSync(configPath, contents, { flag: 'wx' })
  return { configPath, sha256: sha256(readFileSync(configPath)) }
}

// Turns the results file on disk into parsed JSON, never letting either a
// filesystem-read failure or a JSON.parse failure escape as an
// unstructured top-level thrown error. The two failure domains are kept
// distinct and mutually exclusive: `resultsReadError` is a raw fs error
// (e.g. the path exists but is a directory, or is unreadable) that
// prevented reading the bytes at all; `resultsParseError` is a raw
// `JSON.parse` failure (e.g. truncated/corrupted JSON from a child killed
// mid-write) on bytes that *were* read successfully. A missing results
// file is neither: `results`, `resultsReadError`, and `resultsParseError`
// are all null in that case, matching any other missing-result case in
// classification.
function parseResultsFile(resultsPath) {
  if (!existsSync(resultsPath)) return { results: null, resultsReadError: null, resultsParseError: null }
  let rawResultsText
  try {
    rawResultsText = readFileSync(resultsPath, 'utf8')
  } catch (error) {
    return {
      results: null,
      resultsReadError: { message: error.message, code: error.code ?? null, path: resultsPath },
      resultsParseError: null
    }
  }
  try {
    return { results: JSON.parse(rawResultsText), resultsReadError: null, resultsParseError: null }
  } catch (error) {
    return {
      results: null,
      resultsReadError: null,
      resultsParseError: {
        message: error.message,
        path: resultsPath,
        byteLength: Buffer.byteLength(rawResultsText)
      }
    }
  }
}

// Normalizes already-parsed Vitest JSON-reporter `results` into a flat
// list of per-case records, tolerating any wrong-shaped or malformed
// input without ever throwing: a missing/null/non-array `testResults`, a
// null/non-object file entry, a missing/null/non-array `assertionResults`
// list, a null/non-object case entry, or a case whose `status` is
// missing/null/non-string/empty are each recorded as a single structured
// `resultSchemaError` (the first one encountered) instead of becoming a
// TypeError from calling `.flatMap`/`.map` on the wrong shape or
// dereferencing a property of `null`. This is a third, distinct
// diagnostic domain from `resultsReadError` (a filesystem failure) and
// `resultsParseError` (a JSON.parse failure): it only ever fires once
// `results` is already valid, parsed JSON whose *test-result shape* is
// what turns out to be wrong. `results` being null/undefined (already
// covered by resultsReadError/resultsParseError/a missing file) yields no
// cases and no schema error -- there is nothing to validate. A schema
// error never drops evidence: every case that can be safely read (a
// non-null, non-array object, even with an invalid status) is still
// pushed into `cases` with its raw fields preserved, so classifyExecution
// (which independently setup_blocks on a missing/invalid status, an
// incomplete/mismatched case list, or a non-null `resultSchemaError`) has
// the fullest safe view of what was actually reported.
function normalizeResultCases(results) {
  if (results === null || results === undefined) return { cases: [], resultSchemaError: null }

  const problems = []
  const record = (reason, detail) => {
    if (problems.length === 0) problems.push({ reason, detail })
  }
  const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value)
  const isValidStatus = (value) => typeof value === 'string' && value.length > 0

  const testResultsRaw = results.testResults
  if (!Array.isArray(testResultsRaw)) {
    record('results.testResults is not an array', { type: typeOf(testResultsRaw) })
    return { cases: [], resultSchemaError: problems[0] }
  }

  const cases = []
  testResultsRaw.forEach((file, fileIndex) => {
    if (file === null || typeof file !== 'object' || Array.isArray(file)) {
      record(`results.testResults[${fileIndex}] is not a file object`, { type: typeOf(file) })
      return
    }
    const assertionResultsRaw = file.assertionResults
    if (!Array.isArray(assertionResultsRaw)) {
      const reason = assertionResultsRaw === undefined
        ? `results.testResults[${fileIndex}].assertionResults is missing`
        : `results.testResults[${fileIndex}].assertionResults is not an array`
      record(reason, { type: typeOf(assertionResultsRaw) })
      return
    }
    assertionResultsRaw.forEach((testCase, caseIndex) => {
      if (testCase === null || typeof testCase !== 'object' || Array.isArray(testCase)) {
        record(`results.testResults[${fileIndex}].assertionResults[${caseIndex}] is not a case object`, { type: typeOf(testCase) })
        cases.push({ ancestorTitles: null, title: null, fullName: null, status: null, duration: null, failureMessages: [] })
        return
      }
      if (!isValidStatus(testCase.status)) {
        const statusDetail = typeof testCase.status === 'string'
          ? { type: 'string', value: testCase.status }
          : { type: typeOf(testCase.status) }
        record(`results.testResults[${fileIndex}].assertionResults[${caseIndex}].status is missing or invalid`, statusDetail)
      }
      cases.push({
        ancestorTitles: testCase.ancestorTitles,
        title: testCase.title,
        fullName: testCase.fullName,
        status: testCase.status,
        duration: testCase.duration ?? null,
        failureMessages: testCase.failureMessages ?? []
      })
    })
  })

  return { cases, resultSchemaError: problems[0] ?? null }
}

// Verified empirically against this runtime's Node: spawnSync surfaces its
// own configured `timeout` option as `error.code === 'ETIMEDOUT'` on the
// spawn-level error object (in addition to killing the child and setting
// `signal`), while an ordinary externally-delivered signal (early or
// late) leaves that error null and only sets `signal`. `timedOut` is
// keyed strictly to that error code, never inferred from elapsed
// wall-clock time -- an elapsed-time heuristic would be an approximation
// vulnerable to scheduler jitter and could misclassify a genuine external
// signal as a timeout, or vice versa. `spawnError` here is the same
// `{ message, code }` shape runExecute records as raw spawn evidence for
// any spawn-level error, ETIMEDOUT included.
function deriveTimedOut(spawnError) {
  return Boolean(spawnError) && spawnError.code === 'ETIMEDOUT'
}

function packageEvidence(entries) {
  return entries.map(({ name, version, packageFile, packageSha256, treeSha256, totalBytes, files }) => ({
    name,
    version,
    packageFile,
    packageSha256,
    treeSha256: treeSha256 ?? null,
    totalBytes: totalBytes ?? null,
    fileCount: files?.length ?? null
  }))
}

function isFiniteNonNegativeInt(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

// The only classification that may claim a completed source result
// (source_pass or source_behavioral_failure) is a normally spawned,
// unsignaled, non-timeout run with a parseable results file, every
// required count field present and internally coherent, the exact
// manifest-pinned denominator, zero pending/todo tests, and a per-case
// list whose length and pass/fail split agree with the reported counts.
// A spawn error (including a timeout, which Node surfaces as its own
// spawn error code -- see runExecute), a signal, a filesystem-read
// failure on the results file, malformed/unparseable results JSON, a
// wrong-shaped results schema (non-array testResults/assertionResults, a
// null file or case entry -- see normalizeResultCases), a missing result,
// incoherent counts, a denominator mismatch, or an incomplete/mismatched
// per-case list is always setup_block, regardless of how the counts
// otherwise look -- none of that evidence can be trusted as a genuine
// source result. Only inside that verified envelope does at least one
// genuinely failed original assertion become source_behavioral_failure; a
// failed-suite-only report with zero failed assertions is not a
// behavioral failure, it is setup_block (see evaluation.ok below, which
// evaluateExecution already flags as a problem in that case).
function classifyExecution(execution, evaluation, expectedTests) {
  if (execution.spawnError) return 'setup_block'
  if (execution.signal !== null) return 'setup_block'
  if (execution.timedOut) return 'setup_block'
  if (execution.resultsReadError) return 'setup_block'
  if (execution.resultsParseError) return 'setup_block'
  if (execution.resultSchemaError) return 'setup_block'
  if (execution.exitCode === null || execution.exitCode === undefined) return 'setup_block'
  if (!execution.results) return 'setup_block'

  const counts = evaluation?.counts
  if (!counts) return 'setup_block'
  const requiredFields = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests']
  for (const field of requiredFields) {
    if (!isFiniteNonNegativeInt(counts[field])) return 'setup_block'
  }
  const sum = counts.numPassedTests + counts.numFailedTests + counts.numPendingTests + counts.numTodoTests
  if (sum !== counts.numTotalTests) return 'setup_block'
  if (counts.numTotalTests === 0) return 'setup_block'
  if (typeof expectedTests === 'number' && counts.numTotalTests !== expectedTests) return 'setup_block'
  if (counts.numPendingTests > 0 || counts.numTodoTests > 0) return 'setup_block'

  const cases = Array.isArray(execution.cases) ? execution.cases : null
  if (!cases || cases.length !== counts.numTotalTests) return 'setup_block'
  if (cases.some((testCase) => typeof testCase.status !== 'string' || testCase.status.length === 0)) return 'setup_block'
  const failedCases = cases.filter((testCase) => testCase.status === 'failed').length
  const passedCases = cases.filter((testCase) => testCase.status === 'passed').length
  if (failedCases !== counts.numFailedTests || passedCases !== counts.numPassedTests) return 'setup_block'
  if (failedCases + passedCases !== cases.length) return 'setup_block'

  if (counts.numFailedTests > 0) return 'source_behavioral_failure'
  return evaluation.ok === true ? 'source_pass' : 'setup_block'
}

// Parses argv before any side effect runs. No args and --check are the
// same read-only mode; --execute is the only mode that stages or spawns.
// Unknown flags, positionals, duplicate flags, and --check/--execute
// together are all rejected here, before anything below this function
// can touch disk.
function parseCliArgs(argv) {
  let sawCheck = false
  let sawExecute = false
  const positionals = []
  for (const arg of argv) {
    if (arg === '--check') {
      if (sawCheck) throw new CliRefusal('Duplicate flag: --check')
      sawCheck = true
    } else if (arg === '--execute') {
      if (sawExecute) throw new CliRefusal('Duplicate flag: --execute')
      sawExecute = true
    } else if (arg.startsWith('-')) {
      throw new CliRefusal(`Unknown flag: ${arg}`)
    } else {
      positionals.push(arg)
    }
  }
  if (positionals.length > 0) {
    throw new CliRefusal(`Unexpected positional argument(s): ${positionals.join(', ')}`)
  }
  if (sawCheck && sawExecute) {
    throw new CliRefusal('--check and --execute are mutually exclusive')
  }
  return { mode: sawExecute ? 'execute' : 'check' }
}

// Read-only validation: creates no capsule directory, cache, temp
// directory, or test process. This does spawn one read-only child process
// (`git rev-parse`, via readOnlySourceRevisionCheck) to confirm the pinned
// source revision -- that is a read, not a write, and is not the vitest
// test process --execute would spawn. Confirms the manifest, the source
// revision pin, the fixture seams, the supplemental runtime, and the
// runner binaries resolve, without staging or invoking anything.
function runCheck() {
  const problems = []
  const manifest = loadManifest(manifestPath)
  const manifestSha256 = readManifestDigest(manifestPath)

  const revisionCheck = readOnlySourceRevisionCheck(manifest.sourceRevision)
  if (!revisionCheck.ok) problems.push(revisionCheck.problem)

  const standins = readOnlyStandinsCheck()
  for (const standin of standins) {
    if (!standin.ok) problems.push(`Stand-in check failed for ${standin.name}: ${standin.problem}`)
  }

  let supplementalRuntime = null
  try {
    supplementalRuntime = resolveSupplementalRuntime()
  } catch (error) {
    problems.push(`Supplemental runtime resolution failed: ${error.message}`)
  }

  const binaries = readOnlyBinaryCheck()
  if (!binaries.nodeBin.exists) problems.push(`Node binary not found: ${nodeBin}`)
  if (!binaries.vitestEntry.exists) problems.push(`Vitest entry not found: ${vitestEntry}`)

  const report = {
    schemaVersion: 1,
    mode: 'check',
    suite: 'src/renderer/src/components/bots/BotsPage.test.tsx',
    manifestPath,
    manifestSha256,
    manifestCapsuleId: manifest.capsuleId,
    expectedSourceRevision: manifest.sourceRevision,
    observedSourceRevision: revisionCheck.actual,
    expectedTestCounts: manifest.expectedTestCounts ?? null,
    standins: standins.map(({ name, source, sha256: digest, ok, problem }) => ({ name, source, sha256: digest, ok, problem })),
    supplementalRuntime: supplementalRuntime ? packageEvidence(supplementalRuntime) : null,
    binaries,
    ok: problems.length === 0,
    problems,
    sideEffects: 'none: no capsule directory, cache, temp directory, or test process was created',
    note: 'Read-only validation only. This is not a source execution result; pass --execute to stage the capsule and invoke the tests.'
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = report.ok ? 0 : 1
}

// Only mode that stages a capsule, links runtime packages, writes a
// generated Vitest config, and spawns the pinned Vitest entry. Preserves
// the exact full source execution semantics of the original suite.
function runExecute() {
  const manifestSha256 = readManifestDigest(manifestPath)
  const stage = stageCapsule({ manifestPath, sourceRoot, label: 'wp-cap-bots-page' })
  const supplementalRuntime = resolveSupplementalRuntime()
  stageSupplementalRuntime(supplementalRuntime, stage.capsuleRoot)
  verifySupplementalRuntime(supplementalRuntime, stage.capsuleRoot)
  const standins = stageStandins(stage.capsuleRoot)
  const executionConfig = writeExecutionConfig(stage.capsuleRoot)
  const tempRoot = path.join(stage.capsuleRoot, '.tmp')
  mkdirSync(tempRoot)
  const resultsPath = path.join(stage.capsuleRoot, 'bots-page-results.json')
  const args = [
    vitestEntry,
    'run',
    stage.entryTestFile,
    '--root',
    stage.capsuleRoot,
    '--config',
    executionConfig.configPath,
    '--reporter=json',
    `--outputFile=${resultsPath}`
  ]
  const timeoutMs = 120000
  const spawnStartedAt = Date.now()
  const run = spawnSync(nodeBin, args, {
    cwd: stage.capsuleRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      TMPDIR: tempRoot,
      TMP: tempRoot,
      TEMP: tempRoot,
      CI: '1'
    }
  })
  const elapsedMs = Date.now() - spawnStartedAt

  const { results, resultsReadError, resultsParseError } = parseResultsFile(resultsPath)
  const { cases, resultSchemaError } = normalizeResultCases(results)

  const spawnError = run.error ? { message: run.error.message, code: run.error.code ?? null } : null
  const timedOut = deriveTimedOut(spawnError)
  const execution = {
    spawnError,
    timedOut,
    signal: run.signal,
    exitCode: run.status,
    elapsedMs,
    timeoutMs,
    results,
    resultsReadError,
    resultsParseError,
    resultSchemaError,
    cases
  }
  const evaluation = evaluateExecution(execution, stage.expectedTestCounts)
  const classification = classifyExecution(execution, evaluation, stage.expectedTestCounts?.tests)

  const report = {
    schemaVersion: 1,
    mode: 'execute',
    suite: 'src/renderer/src/components/bots/BotsPage.test.tsx',
    sourceRevision: stage.sourceRevision,
    manifestPath,
    manifestSha256,
    capsuleRoot: stage.capsuleRoot,
    sourceVitestConfig: {
      path: 'config/vitest.config.ts',
      sha256: stage.staged.find((entry) => entry.path === 'config/vitest.config.ts').sha256,
      differences: stage.sourceVitestConfigDifferences
    },
    command: {
      cwd: stage.capsuleRoot,
      executable: nodeBin,
      args,
      timeoutMs,
      environment: ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'CI']
    },
    runner: {
      nodeVersion: spawnSync(nodeBin, ['--version'], { encoding: 'utf8' }).stdout.trim(),
      vitestVersion: spawnSync(nodeBin, [vitestEntry, '--version'], { cwd: stage.capsuleRoot, encoding: 'utf8' }).stdout.trim()
    },
    staged: stage.staged.map(({ path: file, sha256: digest }) => ({ path: file, sha256: digest })),
    license: { path: stage.license.path, sha256: stage.license.sha256 },
    runtimePackages: {
      renderer: packageEvidence(stage.rendererRuntime.map((entry) => ({
        ...entry,
        ...snapshotTransportPackage(path.dirname(entry.packageFile))
      }))),
      supplemental: packageEvidence(supplementalRuntime)
    },
    standins,
    executionConfig,
    stdoutSha256: sha256(run.stdout ?? ''),
    stderrSha256: sha256(run.stderr ?? ''),
    classification,
    exitCode: run.status,
    signal: run.signal,
    // Raw spawn evidence, kept distinct from `classification`: a signal
    // and a timeout are never conflated here, and a spawn-level error
    // (e.g. the executable could not be launched at all) is preserved
    // verbatim rather than only being inferred from a missing results file.
    spawn: {
      error: spawnError,
      exitCode: run.status,
      signal: run.signal,
      timedOut,
      elapsedMs,
      timeoutMs
    },
    evaluation,
    // Three distinct, mutually exclusive structured diagnostics, each
    // null unless its specific failure occurred: `resultsReadError` is a
    // filesystem-read failure on the results path; `resultsParseError` is
    // a JSON.parse failure on bytes that were read successfully;
    // `resultSchemaError` is a wrong-shaped (but validly parsed) results
    // JSON -- e.g. a non-array testResults/assertionResults, or a null
    // file/case entry (see normalizeResultCases). All three null with
    // `rawCounts: null` means no results file existed at all.
    resultsReadError,
    resultsParseError,
    resultSchemaError,
    rawCounts: results ? {
      numTotalTestSuites: results.numTotalTestSuites,
      numPassedTestSuites: results.numPassedTestSuites,
      numFailedTestSuites: results.numFailedTestSuites,
      numTotalTests: results.numTotalTests,
      numPassedTests: results.numPassedTests,
      numFailedTests: results.numFailedTests,
      numPendingTests: results.numPendingTests,
      numTodoTests: results.numTodoTests,
      success: results.success
    } : null,
    cases,
    limitations: [
      'This is an original-source baseline only, never candidate parity or GREEN.',
      'The stage uses exact source bytes and genuine installed packages, but the three declared import seams and deterministic unobserved asset URLs qualify environment equivalence.',
      'The reference-build capsule at .preflight/reference-build-Z1ylje is reuse evidence only and was not read as an execution input or modified.'
    ]
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = classification === 'setup_block' ? 2 : 0
}

// `argv` and the `runCheckImpl`/`runExecuteImpl` boundary are injectable
// so cli-contract.test.mjs can prove, entirely in-process and without
// touching any real or throwaway disk location, that an invalid argv or
// a check-mode argv never reaches the write-capable execute path: tests
// substitute a tripwire for `runExecuteImpl` and assert it is never
// called for anything other than an explicit --execute. This replaces
// diffing the real, shared `.preflight/parity-baseline` listing (which is
// mutated concurrently by other capsules and is not an isolated oracle)
// as the way side-effect freedom is verified.
function main(argv = process.argv.slice(2), { runCheckImpl = runCheck, runExecuteImpl = runExecute } = {}) {
  const { mode } = parseCliArgs(argv)
  if (mode === 'check') {
    runCheckImpl()
  } else {
    runExecuteImpl()
  }
}

// Importing this module must never execute or stage anything: everything
// above is a declaration, and the only call into main() is gated on this
// module having been invoked directly as a script.
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)
if (isMainModule) {
  try {
    main()
  } catch (error) {
    if (error instanceof CliRefusal) {
      process.stderr.write(`CLI argument refused: ${error.message}\n`)
      process.exitCode = 2
    } else if (error instanceof CapsuleRefusal) {
      process.stderr.write(`Capsule refused: ${error.message}\n`)
      process.exitCode = 2
    } else {
      process.stderr.write(`Unexpected error: ${error.stack || error.message}\n`)
      process.exitCode = 1
    }
  }
}

// Exported only for this directory's cli-contract.test.mjs to exercise as
// pure, injectable functions; importing this module (whether directly or
// via this export list) never triggers main() -- see the isMainModule
// guard above. `runExecute` is exported only so tests can assert identity
// against it if needed; tests must never call it (that would run the
// real, costly UI baseline).
export {
  CliRefusal,
  classifyExecution,
  deriveTimedOut,
  main,
  normalizeResultCases,
  parseCliArgs,
  parseResultsFile,
  readOnlyBinaryCheck,
  readOnlySourceRevisionCheck,
  readOnlyStandinsCheck,
  resolveSupplementalRuntime,
  runCheck,
  runExecute
}
