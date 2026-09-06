import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import {
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
  runExecute
} from './run-baseline.mjs'

// This suite never runs the real, costly UI baseline (the `--execute` path
// that stages the legacy source and spawns the real Vitest suite): that
// baseline is admitted evidence already captured in evidence.json and must
// not be silently rerun. `runExecute` is imported only so a tripwire can be
// asserted to be a *different* function from it, never invoked.
//
// Side-effect freedom for the no-args/--check/invalid/import paths is
// proven two ways, neither of which depends on the real, shared
// `.preflight/parity-baseline` directory (a mutable location other
// concurrent capsules write into, so diffing its listing is not an
// isolated oracle and is not concurrency-safe):
//   1. `main()`'s `runCheckImpl`/`runExecuteImpl` boundary is exercised
//      in-process with tripwire substitutes, proving the write-capable
//      execute path is structurally unreachable except via --execute.
//   2. The read-only helper functions (`readOnlyStandinsCheck`,
//      `readOnlySourceRevisionCheck`, `resolveSupplementalRuntime`,
//      `readOnlyBinaryCheck`) are exercised against throwaway fixture
//      roots created and destroyed per test, never the real source
//      checkout or the real standins/ directory.
// A narrow, read-only, concurrency-safe smoke test still spawns the real
// CLI for the default/--check/import cases, to confirm real end-to-end
// wiring; it asserts only exit code and report shape, never a directory
// diff.

const nodeBin = '/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
const runBaselinePath = fileURLToPath(new URL('./run-baseline.mjs', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))

function runCli(args) {
  return spawnSync(nodeBin, [runBaselinePath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 60000
  })
}

function tripwire(name) {
  return () => {
    throw new Error(`${name} must not be called for this argv`)
  }
}

let throwawayDirs = []

function makeThrowawayDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  throwawayDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of throwawayDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  throwawayDirs = []
})

describe('parseCliArgs', () => {
  it('defaults to check mode with no arguments', () => {
    expect(parseCliArgs([])).toEqual({ mode: 'check' })
  })

  it('accepts --check explicitly', () => {
    expect(parseCliArgs(['--check'])).toEqual({ mode: 'check' })
  })

  it('accepts --execute explicitly', () => {
    expect(parseCliArgs(['--execute'])).toEqual({ mode: 'execute' })
  })

  it('rejects an unknown flag', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow(CliRefusal)
  })

  it('rejects a positional argument', () => {
    expect(() => parseCliArgs(['extra'])).toThrow(CliRefusal)
  })

  it('rejects a positional argument even alongside a valid flag', () => {
    expect(() => parseCliArgs(['--check', 'extra'])).toThrow(CliRefusal)
  })

  it('rejects a duplicate --check flag', () => {
    expect(() => parseCliArgs(['--check', '--check'])).toThrow(CliRefusal)
  })

  it('rejects a duplicate --execute flag', () => {
    expect(() => parseCliArgs(['--execute', '--execute'])).toThrow(CliRefusal)
  })

  it('rejects --check and --execute together as mutually exclusive', () => {
    expect(() => parseCliArgs(['--check', '--execute'])).toThrow(CliRefusal)
  })
})

describe('main() dispatch boundary (injected tripwires, no real or throwaway disk touched)', () => {
  it('never reaches the execute boundary for an invalid argv', () => {
    const runExecuteImpl = tripwire('runExecute')
    const runCheckImpl = tripwire('runCheck')
    expect(() => main(['--bogus'], { runCheckImpl, runExecuteImpl })).toThrow(CliRefusal)
  })

  it('never reaches the execute boundary for a positional argument', () => {
    const runExecuteImpl = tripwire('runExecute')
    const runCheckImpl = tripwire('runCheck')
    expect(() => main(['extra'], { runCheckImpl, runExecuteImpl })).toThrow(CliRefusal)
  })

  it('never reaches the execute boundary for duplicate flags', () => {
    const runExecuteImpl = tripwire('runExecute')
    const runCheckImpl = tripwire('runCheck')
    expect(() => main(['--check', '--check'], { runCheckImpl, runExecuteImpl })).toThrow(CliRefusal)
  })

  it('never reaches the execute boundary for --check and --execute together', () => {
    const runExecuteImpl = tripwire('runExecute')
    const runCheckImpl = tripwire('runCheck')
    expect(() => main(['--check', '--execute'], { runCheckImpl, runExecuteImpl })).toThrow(CliRefusal)
  })

  it('routes no-args to the check boundary only', () => {
    let checkCalls = 0
    const runCheckImpl = () => { checkCalls += 1 }
    const runExecuteImpl = tripwire('runExecute')
    main([], { runCheckImpl, runExecuteImpl })
    expect(checkCalls).toBe(1)
  })

  it('routes --check to the check boundary only', () => {
    let checkCalls = 0
    const runCheckImpl = () => { checkCalls += 1 }
    const runExecuteImpl = tripwire('runExecute')
    main(['--check'], { runCheckImpl, runExecuteImpl })
    expect(checkCalls).toBe(1)
  })

  it('routes --execute to the execute boundary only, without invoking the real runExecute', () => {
    let executeCalls = 0
    const runExecuteImpl = () => { executeCalls += 1 }
    const runCheckImpl = tripwire('runCheck')
    main(['--execute'], { runCheckImpl, runExecuteImpl })
    expect(executeCalls).toBe(1)
    expect(runExecuteImpl).not.toBe(runExecute)
  })
})

describe('read-only helpers against injected throwaway roots', () => {
  it('readOnlyStandinsCheck verifies a matching throwaway fixture', () => {
    const dir = makeThrowawayDir('bots-page-standins-ok-')
    writeFileSync(path.join(dir, 'fixture-a.ts'), 'export const a = 1\n')
    const result = readOnlyStandinsCheck(dir, ['fixture-a.ts'])
    expect(result).toEqual([{ name: 'fixture-a.ts', source: path.join(dir, 'fixture-a.ts'), sha256: expect.any(String), ok: true, problem: null }])
  })

  it('readOnlyStandinsCheck reports a missing fixture as not ok, without creating anything', () => {
    const dir = makeThrowawayDir('bots-page-standins-missing-')
    const result = readOnlyStandinsCheck(dir, ['absent.ts'])
    expect(result[0].ok).toBe(false)
    expect(result[0].sha256).toBeNull()
  })

  it('readOnlySourceRevisionCheck matches a throwaway git fixture at its own HEAD', () => {
    const dir = makeThrowawayDir('bots-page-revision-ok-')
    execFileSync('git', ['init', '--quiet', dir])
    writeFileSync(path.join(dir, 'file.txt'), 'content\n')
    execFileSync('git', ['-C', dir, 'add', 'file.txt'])
    execFileSync('git', ['-C', dir, '-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-q', '-m', 'init'])
    const actualSha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const result = readOnlySourceRevisionCheck(actualSha, dir)
    expect(result).toEqual({ ok: true, actual: actualSha, problem: null })
  })

  it('readOnlySourceRevisionCheck reports a mismatch against a throwaway git fixture, without writing to it', () => {
    const dir = makeThrowawayDir('bots-page-revision-mismatch-')
    execFileSync('git', ['init', '--quiet', dir])
    writeFileSync(path.join(dir, 'file.txt'), 'content\n')
    execFileSync('git', ['-C', dir, 'add', 'file.txt'])
    execFileSync('git', ['-C', dir, '-c', 'user.email=test@example.invalid', '-c', 'user.name=Test', 'commit', '-q', '-m', 'init'])
    const wrongSha = '0'.repeat(40)
    const result = readOnlySourceRevisionCheck(wrongSha, dir)
    expect(result.ok).toBe(false)
    expect(result.problem).toMatch(/Source revision mismatch/)
  })

  it('resolveSupplementalRuntime resolves a matching throwaway package fixture', () => {
    const dir = makeThrowawayDir('bots-page-supplemental-ok-')
    const packageDir = path.join(dir, 'node_modules', 'fixture-pkg')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture-pkg', version: '1.2.3' }))
    const runtime = resolveSupplementalRuntime(dir, { 'fixture-pkg': '1.2.3' })
    expect(runtime).toHaveLength(1)
    expect(runtime[0]).toMatchObject({ name: 'fixture-pkg', version: '1.2.3' })
  })

  it('resolveSupplementalRuntime throws on a version mismatch against a throwaway fixture', () => {
    const dir = makeThrowawayDir('bots-page-supplemental-mismatch-')
    const packageDir = path.join(dir, 'node_modules', 'fixture-pkg')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture-pkg', version: '9.9.9' }))
    expect(() => resolveSupplementalRuntime(dir, { 'fixture-pkg': '1.2.3' })).toThrow(/mismatch/)
  })

  it('readOnlyBinaryCheck reports existence against throwaway paths', () => {
    const dir = makeThrowawayDir('bots-page-binaries-')
    const presentPath = path.join(dir, 'present')
    writeFileSync(presentPath, '')
    const absentPath = path.join(dir, 'absent')
    const result = readOnlyBinaryCheck(presentPath, absentPath)
    expect(result).toEqual({
      nodeBin: { path: presentPath, exists: true },
      vitestEntry: { path: absentPath, exists: false }
    })
  })
})

describe('deriveTimedOut (keyed to spawn error code, never elapsed time)', () => {
  it('is true only for an ETIMEDOUT-coded spawn error', () => {
    expect(deriveTimedOut({ message: 'spawnSync node ETIMEDOUT', code: 'ETIMEDOUT' })).toBe(true)
  })

  it('is false for any other spawn error code, e.g. ENOENT', () => {
    expect(deriveTimedOut({ message: 'spawnSync bogus ENOENT', code: 'ENOENT' })).toBe(false)
  })

  it('is false when there is no spawn error at all (the ordinary-signal case)', () => {
    expect(deriveTimedOut(null)).toBe(false)
    expect(deriveTimedOut(undefined)).toBe(false)
  })
})

describe('parseResultsFile (structured diagnostics, never an escaped throw)', () => {
  it('parses a well-formed results file', () => {
    const dir = makeThrowawayDir('bots-page-results-ok-')
    const resultsPath = path.join(dir, 'results.json')
    writeFileSync(resultsPath, JSON.stringify({ numTotalTests: 1 }))
    expect(parseResultsFile(resultsPath)).toEqual({ results: { numTotalTests: 1 }, resultsReadError: null, resultsParseError: null })
  })

  it('catches malformed/truncated JSON into a structured diagnostic instead of throwing', () => {
    const dir = makeThrowawayDir('bots-page-results-malformed-')
    const resultsPath = path.join(dir, 'results.json')
    const malformed = '{"numTotalTests": 8, "testResults": [ // truncated mid-write'
    writeFileSync(resultsPath, malformed)
    let outcome
    expect(() => { outcome = parseResultsFile(resultsPath) }).not.toThrow()
    expect(outcome.results).toBeNull()
    expect(outcome.resultsReadError).toBeNull()
    expect(outcome.resultsParseError).toMatchObject({ path: resultsPath, byteLength: Buffer.byteLength(malformed) })
    expect(typeof outcome.resultsParseError.message).toBe('string')
    expect(outcome.resultsParseError.message.length).toBeGreaterThan(0)
  })

  it('catches a filesystem-read failure (results path is a directory, not a file) into a structured diagnostic distinct from a parse error, instead of throwing', () => {
    const dir = makeThrowawayDir('bots-page-results-unreadable-')
    const resultsPathIsADirectory = path.join(dir, 'looks-like-a-results-file')
    mkdirSync(resultsPathIsADirectory)
    let outcome
    expect(() => { outcome = parseResultsFile(resultsPathIsADirectory) }).not.toThrow()
    expect(outcome.results).toBeNull()
    expect(outcome.resultsParseError).toBeNull()
    expect(outcome.resultsReadError).toMatchObject({ path: resultsPathIsADirectory })
    expect(typeof outcome.resultsReadError.message).toBe('string')
    expect(outcome.resultsReadError.message.length).toBeGreaterThan(0)
  })

  it('reports a missing file as no results, no read error, and no parse error (distinct from a malformed or unreadable file)', () => {
    const dir = makeThrowawayDir('bots-page-results-missing-')
    const resultsPath = path.join(dir, 'never-written.json')
    expect(parseResultsFile(resultsPath)).toEqual({ results: null, resultsReadError: null, resultsParseError: null })
  })
})

describe('normalizeResultCases (result-shape validation, never throws on wrong shapes)', () => {
  it('normalizes a well-formed full-passing shape with no schema error', () => {
    const results = { testResults: [{ assertionResults: [{ status: 'passed' }, { status: 'passed' }] }] }
    const outcome = normalizeResultCases(results)
    expect(outcome.resultSchemaError).toBeNull()
    expect(outcome.cases).toEqual([
      { ancestorTitles: undefined, title: undefined, fullName: undefined, status: 'passed', duration: null, failureMessages: [] },
      { ancestorTitles: undefined, title: undefined, fullName: undefined, status: 'passed', duration: null, failureMessages: [] }
    ])
  })

  it('normalizes a well-formed full-failing shape with no schema error', () => {
    const results = { testResults: [{ assertionResults: [{ status: 'passed' }, { status: 'failed' }] }] }
    const outcome = normalizeResultCases(results)
    expect(outcome.resultSchemaError).toBeNull()
    expect(outcome.cases.map((c) => c.status)).toEqual(['passed', 'failed'])
  })

  it('reports null/undefined results as no cases and no schema error (nothing to validate)', () => {
    expect(normalizeResultCases(null)).toEqual({ cases: [], resultSchemaError: null })
    expect(normalizeResultCases(undefined)).toEqual({ cases: [], resultSchemaError: null })
  })

  it('treats testResults entirely missing (results = {}) as a schema error, never throwing', () => {
    let outcome
    expect(() => { outcome = normalizeResultCases({}) }).not.toThrow()
    expect(outcome.cases).toEqual([])
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults is not an array', detail: { type: 'undefined' } })
  })

  it('treats testResults as an object ({}) as a schema error, never throwing', () => {
    let outcome
    expect(() => { outcome = normalizeResultCases({ testResults: {} }) }).not.toThrow()
    expect(outcome.cases).toEqual([])
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults is not an array', detail: { type: 'object' } })
  })

  it('treats a null file entry inside testResults as a schema error, never throwing', () => {
    let outcome
    expect(() => { outcome = normalizeResultCases({ testResults: [null] }) }).not.toThrow()
    expect(outcome.cases).toEqual([])
    expect(outcome.resultSchemaError.reason).toMatch(/is not a file object/)
  })

  it('treats assertionResults entirely missing from a file object as a schema error, never throwing (previously tolerated silently -- corrected)', () => {
    let outcome
    expect(() => { outcome = normalizeResultCases({ testResults: [{}] }) }).not.toThrow()
    expect(outcome.cases).toEqual([])
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults[0].assertionResults is missing', detail: { type: 'undefined' } })
  })

  it('treats assertionResults as an object ({}) as a schema error, never throwing', () => {
    let outcome
    expect(() => { outcome = normalizeResultCases({ testResults: [{ assertionResults: {} }] }) }).not.toThrow()
    expect(outcome.cases).toEqual([])
    expect(outcome.resultSchemaError.reason).toMatch(/assertionResults is not an array/)
  })

  it('treats a null assertion-case entry as a schema error and substitutes a safe placeholder case, never throwing', () => {
    let outcome
    expect(() => { outcome = normalizeResultCases({ testResults: [{ assertionResults: [null] }] }) }).not.toThrow()
    expect(outcome.resultSchemaError.reason).toMatch(/is not a case object/)
    expect(outcome.cases).toEqual([{ ancestorTitles: null, title: null, fullName: null, status: null, duration: null, failureMessages: [] }])
  })

  it('treats a case missing its required status field as a schema error while preserving the case as safe raw evidence (previously tolerated silently -- corrected)', () => {
    let outcome
    expect(() => { outcome = normalizeResultCases({ testResults: [{ assertionResults: [{ title: 'no status here' }] }] }) }).not.toThrow()
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults[0].assertionResults[0].status is missing or invalid', detail: { type: 'undefined' } })
    expect(outcome.cases).toEqual([{ ancestorTitles: undefined, title: 'no status here', fullName: undefined, status: undefined, duration: null, failureMessages: [] }])
  })

  it('treats a case with a null status as a schema error while preserving the case as safe raw evidence', () => {
    let outcome
    expect(() => { outcome = normalizeResultCases({ testResults: [{ assertionResults: [{ status: null }] }] }) }).not.toThrow()
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults[0].assertionResults[0].status is missing or invalid', detail: { type: 'null' } })
    expect(outcome.cases).toEqual([{ ancestorTitles: undefined, title: undefined, fullName: undefined, status: null, duration: null, failureMessages: [] }])
  })

  it('treats a case with a non-string status as a schema error while preserving the case as safe raw evidence', () => {
    let outcome
    expect(() => { outcome = normalizeResultCases({ testResults: [{ assertionResults: [{ status: 1 }] }] }) }).not.toThrow()
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults[0].assertionResults[0].status is missing or invalid', detail: { type: 'number' } })
    expect(outcome.cases).toEqual([{ ancestorTitles: undefined, title: undefined, fullName: undefined, status: 1, duration: null, failureMessages: [] }])
  })

  it('treats a case with an empty-string status as a schema error while preserving the case as safe raw evidence', () => {
    let outcome
    expect(() => { outcome = normalizeResultCases({ testResults: [{ assertionResults: [{ status: '' }] }] }) }).not.toThrow()
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults[0].assertionResults[0].status is missing or invalid', detail: { type: 'string', value: '' } })
    expect(outcome.cases).toEqual([{ ancestorTitles: undefined, title: undefined, fullName: undefined, status: '', duration: null, failureMessages: [] }])
  })

  it('records only the first schema problem when multiple cases have invalid statuses', () => {
    const outcome = normalizeResultCases({ testResults: [{ assertionResults: [{ status: null }, { status: '' }] }] })
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults[0].assertionResults[0].status is missing or invalid', detail: { type: 'null' } })
    expect(outcome.cases).toHaveLength(2)
  })
})

describe('classifyExecution', () => {
  const passingCounts = (overrides = {}) => ({
    numTotalTests: 8,
    numPassedTests: 8,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numFailedTestSuites: 0,
    success: true,
    ...overrides
  })

  const casesFor = (counts) => {
    const cases = []
    for (let i = 0; i < counts.numPassedTests; i += 1) cases.push({ status: 'passed' })
    for (let i = 0; i < counts.numFailedTests; i += 1) cases.push({ status: 'failed' })
    return cases
  }

  const baseExecution = (overrides = {}) => ({
    spawnError: null,
    signal: null,
    timedOut: false,
    resultsReadError: null,
    resultsParseError: null,
    resultSchemaError: null,
    exitCode: 0,
    results: {},
    cases: [],
    ...overrides
  })

  it('never reports a spawn-level error as a completed source result', () => {
    const execution = baseExecution({ spawnError: { message: 'spawn ENOENT', code: 'ENOENT' }, exitCode: null, results: null })
    const evaluation = { ok: false, problems: ['spawn error'], counts: null }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports a signaled process as a completed source result even with plausible counts', () => {
    const counts = passingCounts()
    // An ordinary external signal (not our own timeout): spawnError stays
    // null (verified empirically -- see run-baseline.mjs), so timedOut
    // must derive to false via deriveTimedOut, never true, and the run is
    // still setup_block purely on the signal check.
    const execution = baseExecution({ signal: 'SIGKILL', timedOut: deriveTimedOut(null), exitCode: null, cases: casesFor(counts) })
    const evaluation = { ok: true, problems: [], counts }
    expect(execution.timedOut).toBe(false)
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports a timed-out spawn as a completed source result, with timedOut keyed to the ETIMEDOUT spawn-error code', () => {
    const spawnError = { message: 'spawnSync node ETIMEDOUT', code: 'ETIMEDOUT' }
    const execution = baseExecution({ spawnError, timedOut: deriveTimedOut(spawnError), signal: 'SIGTERM', exitCode: null, results: null })
    expect(execution.timedOut).toBe(true)
    const evaluation = { ok: false, problems: ['timed out'], counts: null }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('treats an ordinary signal and a genuine ETIMEDOUT timeout as distinct evidence, both still setup_block', () => {
    const counts = passingCounts()
    const timeoutSpawnError = { message: 'spawnSync node ETIMEDOUT', code: 'ETIMEDOUT' }
    const timedOutExecution = baseExecution({ spawnError: timeoutSpawnError, timedOut: deriveTimedOut(timeoutSpawnError), signal: 'SIGTERM', exitCode: null, results: null })
    const signaledExecution = baseExecution({ spawnError: null, timedOut: deriveTimedOut(null), signal: 'SIGTERM', exitCode: null, cases: casesFor(counts) })
    expect(timedOutExecution.timedOut).toBe(true)
    expect(signaledExecution.timedOut).toBe(false)
    expect(classifyExecution(timedOutExecution, { ok: false, problems: ['timed out'], counts: null }, 8)).toBe('setup_block')
    expect(classifyExecution(signaledExecution, { ok: true, problems: [], counts }, 8)).toBe('setup_block')
  })

  it('treats a signal and a timeout as distinct: an untimed, unsignaled run with the same exit code is not auto-blocked by signal/timeout checks', () => {
    const counts = passingCounts()
    const execution = baseExecution({ signal: null, timedOut: deriveTimedOut(null), cases: casesFor(counts) })
    const evaluation = { ok: true, problems: [], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('source_pass')
  })

  it('never reports a spawn failure with no results file as a completed source result', () => {
    const execution = baseExecution({ results: null })
    const evaluation = { ok: false, problems: ['no parseable vitest JSON results file was produced'], counts: null }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports malformed/unparseable results JSON as a completed source result', () => {
    const execution = baseExecution({
      results: null,
      resultsParseError: { message: 'Unexpected token / in JSON at position 40', path: '/throwaway/results.json', byteLength: 58 }
    })
    const evaluation = { ok: false, problems: ['no parseable vitest JSON results file was produced'], counts: null }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports a filesystem-read failure on the results file as a completed source result', () => {
    const execution = baseExecution({
      results: null,
      resultsReadError: { message: 'EISDIR: illegal operation on a directory, read', code: 'EISDIR', path: '/throwaway/results.json' }
    })
    const evaluation = { ok: false, problems: ['no parseable vitest JSON results file was produced'], counts: null }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports a wrong-shaped results schema (e.g. non-array testResults) as a completed source result', () => {
    const counts = passingCounts()
    const execution = baseExecution({
      cases: [],
      resultSchemaError: { reason: 'results.testResults is not an array', detail: { type: 'object' } }
    })
    const evaluation = { ok: false, problems: ['results.testResults is not an array'], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports a partial/incomplete result (count mismatch) as source_pass', () => {
    const counts = passingCounts({ numTotalTests: 5, numPassedTests: 5 })
    const execution = baseExecution({ cases: casesFor(counts) })
    const evaluation = { ok: false, problems: ['expected 8 total test(s), got 5'], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports malformed (non-integer) counts as a completed source result', () => {
    const counts = passingCounts({ numTotalTests: Number.NaN })
    const execution = baseExecution({ cases: [] })
    const evaluation = { ok: false, problems: ['malformed counts'], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports internally incoherent counts (parts do not sum to total) as a completed source result', () => {
    const counts = passingCounts({ numPassedTests: 5, numFailedTests: 1 })
    const execution = baseExecution({ cases: casesFor({ ...counts, numPassedTests: 5, numFailedTests: 1 }) })
    const evaluation = { ok: false, problems: ['incoherent'], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports a pending/skipped full total as a completed source result', () => {
    const counts = passingCounts({ numPassedTests: 0, numFailedTests: 0, numPendingTests: 8 })
    const execution = baseExecution({ cases: [] })
    const evaluation = { ok: false, problems: ['8 pending'], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports incomplete assertionResults (fewer cases than the total) as a completed source result', () => {
    const counts = passingCounts()
    const execution = baseExecution({ cases: casesFor(counts).slice(0, 3) })
    const evaluation = { ok: true, problems: [], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('never reports a per-case/count mismatch (case statuses disagree with reported counts) as a completed source result', () => {
    const counts = passingCounts({ numPassedTests: 6, numFailedTests: 2 })
    const cases = casesFor({ ...counts, numPassedTests: 8, numFailedTests: 0 })
    const execution = baseExecution({ cases })
    const evaluation = { ok: false, problems: ['2 test(s) failed'], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('reports a genuine full-count assertion failure as source_behavioral_failure, not green', () => {
    const counts = passingCounts({ numPassedTests: 6, numFailedTests: 2, success: false })
    const execution = baseExecution({ cases: casesFor(counts) })
    const evaluation = { ok: false, problems: ['2 test(s) failed'], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('source_behavioral_failure')
  })

  it('reports a genuine failure as source_behavioral_failure even when another integrity problem is also present', () => {
    const counts = passingCounts({ numPassedTests: 5, numFailedTests: 2, numPendingTests: 1 })
    const execution = baseExecution({ cases: casesFor(counts) })
    const evaluation = { ok: false, problems: ['2 test(s) failed', '1 pending/skipped test(s) reported'], counts }
    // Zero pending is required for a completed result at all, so this
    // remains setup_block -- pending tests are never waved through just
    // because some other case also genuinely failed.
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('reports a failed test suite with zero failed assertions as setup_block, not a behavioral failure', () => {
    const counts = passingCounts({ numFailedTestSuites: 1, success: false })
    const execution = baseExecution({ cases: casesFor(counts) })
    const evaluation = { ok: false, problems: ['1 test suite(s) failed'], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('reports a genuine full-count all-passing run as source_pass', () => {
    const counts = passingCounts()
    const execution = baseExecution({ cases: casesFor(counts) })
    const evaluation = { ok: true, problems: [], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('source_pass')
  })

  it('does not report source_pass when the full count matches but another integrity problem remains and nothing failed', () => {
    const counts = passingCounts({ success: false })
    const execution = baseExecution({ cases: casesFor(counts) })
    const evaluation = { ok: false, problems: ['vitest reported success=false, expected true'], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  it('treats a missing/zero total-test count as setup_block', () => {
    const counts = passingCounts({ numTotalTests: 0, numPassedTests: 0 })
    const execution = baseExecution({ cases: [] })
    const evaluation = { ok: false, problems: ['zero tests were reported'], counts }
    expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
  })

  // Root's blocking matrix: a genuine full 8-total/6-passed/2-failed
  // results JSON (the same shape as the admitted evidence.json baseline)
  // must classify setup_block whenever the surrounding spawn-level
  // evidence is not clean -- a signal, a spawn error, or a missing exit
  // code -- and must never be laundered into source_behavioral_failure or
  // source_pass just because the assertion-level JSON looks complete. In
  // every case here, the raw failure evidence (evaluation.counts /
  // execution.cases) is asserted to still show the 2 genuine failures:
  // setup_block never hides or zeroes that evidence, it just refuses to
  // certify it as a trustworthy completed source result.
  describe("root's blocking matrix: full 8/6/2 failed JSON under unclean spawn-level evidence", () => {
    const fullFailedCounts = () => passingCounts({ numPassedTests: 6, numFailedTests: 2, success: false })

    it('(1) SIGKILL with a null exitCode still blocks a full 8/6/2 failed-assertion JSON', () => {
      const counts = fullFailedCounts()
      const cases = casesFor(counts)
      const execution = baseExecution({ signal: 'SIGKILL', timedOut: deriveTimedOut(null), exitCode: null, cases })
      const evaluation = { ok: false, problems: ['2 test(s) failed'], counts }
      expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
      expect(evaluation.counts.numFailedTests).toBe(2)
      expect(cases.filter((c) => c.status === 'failed')).toHaveLength(2)
    })

    it('(2) a spawnError (ENOENT) with a null exitCode still blocks the same full 8/6/2 failed-assertion JSON', () => {
      const counts = fullFailedCounts()
      const cases = casesFor(counts)
      const spawnError = { message: 'spawnSync bogus ENOENT', code: 'ENOENT' }
      const execution = baseExecution({ spawnError, signal: null, timedOut: deriveTimedOut(spawnError), exitCode: null, cases })
      const evaluation = { ok: false, problems: ['2 test(s) failed'], counts }
      expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
      expect(evaluation.counts.numFailedTests).toBe(2)
    })

    it('(3a) unsignaled, no spawn error, but a null exitCode still blocks the same full 8/6/2 failed-assertion JSON', () => {
      const counts = fullFailedCounts()
      const cases = casesFor(counts)
      const execution = baseExecution({ spawnError: null, signal: null, timedOut: false, exitCode: null, cases })
      const evaluation = { ok: false, problems: ['2 test(s) failed'], counts }
      expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
      expect(evaluation.counts.numFailedTests).toBe(2)
    })

    it('(3b) unsignaled, no spawn error, exitCode entirely missing (undefined, not merely null) still blocks the same full 8/6/2 failed-assertion JSON', () => {
      const counts = fullFailedCounts()
      const cases = casesFor(counts)
      const execution = baseExecution({ spawnError: null, signal: null, timedOut: false, cases })
      delete execution.exitCode
      expect(execution.exitCode).toBeUndefined()
      const evaluation = { ok: false, problems: ['2 test(s) failed'], counts }
      expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
      expect(evaluation.counts.numFailedTests).toBe(2)
    })

    it('(4) a full total that includes a todo alongside genuine failed assertions still blocks, never waving the todo through', () => {
      const counts = passingCounts({ numPassedTests: 5, numFailedTests: 2, numTodoTests: 1, success: false })
      expect(counts.numPassedTests + counts.numFailedTests + counts.numPendingTests + counts.numTodoTests).toBe(counts.numTotalTests)
      const cases = [...casesFor({ numPassedTests: 5, numFailedTests: 2 }), { status: 'todo' }]
      const execution = baseExecution({ cases })
      const evaluation = { ok: false, problems: ['2 test(s) failed', '1 todo test(s) reported'], counts }
      expect(classifyExecution(execution, evaluation, 8)).toBe('setup_block')
      expect(evaluation.counts.numFailedTests).toBe(2)
    })
  })
})

// This block exercises the exact same helper functions runExecute wires
// together (parseResultsFile -> normalizeResultCases -> classifyExecution)
// against real throwaway fixture files on disk, with no real spawn and
// no reimplementation: it is the actual product code, just fed a
// deliberately malformed results.json instead of a real vitest run. This
// is the direct regression coverage for the bounded defect (a wrong-shaped
// but validly-parsed results JSON reaching `.flatMap`/`.map` and throwing
// a TypeError, or a filesystem-read failure escaping unstructured): every
// case here asserts the real chain never throws and always resolves to a
// classification, never leaving a raw JS error to propagate.
describe('actual helper wiring: parseResultsFile -> normalizeResultCases -> classifyExecution (no real spawn, real fixture files)', () => {
  const writeResults = (dir, value) => {
    const resultsPath = path.join(dir, 'results.json')
    writeFileSync(resultsPath, JSON.stringify(value))
    return resultsPath
  }

  // Returns { classification, resultSchemaError } (not just the
  // classification) so tests can assert both the structured diagnostic
  // and the resulting classification from the one real call chain --
  // exactly the pair the parent review asked to see proven together.
  const runChain = (resultsPath, expectedTests) => {
    const { results, resultsReadError, resultsParseError } = parseResultsFile(resultsPath)
    const { cases, resultSchemaError } = normalizeResultCases(results)
    const execution = {
      spawnError: null,
      signal: null,
      timedOut: false,
      resultsReadError,
      resultsParseError,
      resultSchemaError,
      exitCode: 0,
      results,
      cases
    }
    const counts = results && typeof results === 'object' && !Array.isArray(results)
      ? {
        numTotalTests: results.numTotalTests,
        numPassedTests: results.numPassedTests,
        numFailedTests: results.numFailedTests,
        numPendingTests: results.numPendingTests,
        numTodoTests: results.numTodoTests,
        numFailedTestSuites: results.numFailedTestSuites,
        success: results.success
      }
      : null
    const evaluation = { ok: counts?.success === true, problems: [], counts }
    return { classification: classifyExecution(execution, evaluation, expectedTests), resultSchemaError }
  }

  it('a full valid passing fixture classifies source_pass, never throwing across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-pass-')
    const resultsPath = writeResults(dir, {
      numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numFailedTestSuites: 0, success: true,
      testResults: [{ assertionResults: [{ status: 'passed' }, { status: 'passed' }] }]
    })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 2) }).not.toThrow()
    expect(outcome.classification).toBe('source_pass')
    expect(outcome.resultSchemaError).toBeNull()
  })

  it('a full valid failing fixture classifies source_behavioral_failure, never throwing across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-fail-')
    const resultsPath = writeResults(dir, {
      numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, numPendingTests: 0, numTodoTests: 0, numFailedTestSuites: 0, success: false,
      testResults: [{ assertionResults: [{ status: 'passed' }, { status: 'failed' }] }]
    })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 2) }).not.toThrow()
    expect(outcome.classification).toBe('source_behavioral_failure')
    expect(outcome.resultSchemaError).toBeNull()
  })

  it('an unreadable results path (a directory, not a file) never throws and classifies setup_block across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-unreadable-')
    const resultsPathIsADirectory = path.join(dir, 'not-a-file')
    mkdirSync(resultsPathIsADirectory)
    let outcome
    expect(() => { outcome = runChain(resultsPathIsADirectory, 1) }).not.toThrow()
    expect(outcome.classification).toBe('setup_block')
  })

  it('malformed JSON never throws and classifies setup_block across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-malformed-json-')
    const resultsPath = path.join(dir, 'results.json')
    writeFileSync(resultsPath, '{ this is not valid json')
    let outcome
    expect(() => { outcome = runChain(resultsPath, 1) }).not.toThrow()
    expect(outcome.classification).toBe('setup_block')
  })

  it('testResults entirely missing (results = {}) never throws and classifies setup_block with a resultSchemaError across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-testresults-missing-')
    const resultsPath = writeResults(dir, { numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 2) }).not.toThrow()
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults is not an array', detail: { type: 'undefined' } })
    expect(outcome.classification).toBe('setup_block')
  })

  it('testResults as an object ({}) never throws and classifies setup_block with a resultSchemaError across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-testresults-object-')
    const resultsPath = writeResults(dir, { numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, testResults: {} })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 2) }).not.toThrow()
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults is not an array' })
    expect(outcome.classification).toBe('setup_block')
  })

  it('a null file entry in testResults never throws and classifies setup_block with a resultSchemaError across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-null-file-')
    const resultsPath = writeResults(dir, { numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, testResults: [null] })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 2) }).not.toThrow()
    expect(outcome.resultSchemaError.reason).toMatch(/is not a file object/)
    expect(outcome.classification).toBe('setup_block')
  })

  it('assertionResults entirely missing from a file object never throws and classifies setup_block with a resultSchemaError across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-assertionresults-missing-')
    const resultsPath = writeResults(dir, { numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, testResults: [{}] })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 2) }).not.toThrow()
    expect(outcome.resultSchemaError).toMatchObject({ reason: 'results.testResults[0].assertionResults is missing', detail: { type: 'undefined' } })
    expect(outcome.classification).toBe('setup_block')
  })

  it('assertionResults as an object ({}) never throws and classifies setup_block with a resultSchemaError across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-assertionresults-object-')
    const resultsPath = writeResults(dir, { numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, testResults: [{ assertionResults: {} }] })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 2) }).not.toThrow()
    expect(outcome.resultSchemaError.reason).toMatch(/assertionResults is not an array/)
    expect(outcome.classification).toBe('setup_block')
  })

  it('a null assertion-case entry never throws and classifies setup_block with a resultSchemaError across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-null-case-')
    const resultsPath = writeResults(dir, { numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, testResults: [{ assertionResults: [null] }] })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 1) }).not.toThrow()
    expect(outcome.resultSchemaError.reason).toMatch(/is not a case object/)
    expect(outcome.classification).toBe('setup_block')
  })

  it('a case missing its required status field never throws and classifies setup_block with a resultSchemaError across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-missing-status-')
    const resultsPath = writeResults(dir, { numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, testResults: [{ assertionResults: [{ title: 'no status' }] }] })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 1) }).not.toThrow()
    expect(outcome.resultSchemaError.reason).toMatch(/status is missing or invalid/)
    expect(outcome.classification).toBe('setup_block')
  })

  it('a case with a null status never throws and classifies setup_block with a resultSchemaError across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-null-status-')
    const resultsPath = writeResults(dir, { numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, testResults: [{ assertionResults: [{ status: null }] }] })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 1) }).not.toThrow()
    expect(outcome.resultSchemaError).toMatchObject({ detail: { type: 'null' } })
    expect(outcome.classification).toBe('setup_block')
  })

  it('a case with a non-string status never throws and classifies setup_block with a resultSchemaError across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-nonstring-status-')
    const resultsPath = writeResults(dir, { numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, testResults: [{ assertionResults: [{ status: 1 }] }] })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 1) }).not.toThrow()
    expect(outcome.resultSchemaError).toMatchObject({ detail: { type: 'number' } })
    expect(outcome.classification).toBe('setup_block')
  })

  it('a case with an empty-string status never throws and classifies setup_block with a resultSchemaError across the real chain', () => {
    const dir = makeThrowawayDir('bots-page-wiring-empty-status-')
    const resultsPath = writeResults(dir, { numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, success: true, testResults: [{ assertionResults: [{ status: '' }] }] })
    let outcome
    expect(() => { outcome = runChain(resultsPath, 1) }).not.toThrow()
    expect(outcome.resultSchemaError).toMatchObject({ detail: { type: 'string', value: '' } })
    expect(outcome.classification).toBe('setup_block')
  })
})

describe('narrow real default/check smoke (read-only, concurrency-safe: no directory diffing)', () => {
  it('importing the module executes and stages nothing', () => {
    const result = spawnSync(
      nodeBin,
      ['--input-type=module', '-e', `import(${JSON.stringify(runBaselinePath)})`],
      { cwd: repoRoot, encoding: 'utf8', timeout: 30000 }
    )
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('')
  })

  it('default invocation (no args) is read-only and produces a check-mode report', () => {
    const result = runCli([])
    expect([0, 1]).toContain(result.status)
    const report = JSON.parse(result.stdout)
    expect(report.mode).toBe('check')
    expect(report.sideEffects).toMatch(/no capsule directory/)
  })

  it('--check is read-only and produces the same check-mode report shape as the default', () => {
    const result = runCli(['--check'])
    expect([0, 1]).toContain(result.status)
    const report = JSON.parse(result.stdout)
    expect(report.mode).toBe('check')
  })

  it('rejects an unknown flag before any side effect and prints no report', () => {
    const result = runCli(['--bogus'])
    expect(result.status).toBe(2)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toMatch(/Unknown flag/)
  })

  it('rejects a positional argument before any side effect and prints no report', () => {
    const result = runCli(['extra'])
    expect(result.status).toBe(2)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toMatch(/positional/i)
  })

  it('rejects a duplicate flag before any side effect and prints no report', () => {
    const result = runCli(['--check', '--check'])
    expect(result.status).toBe(2)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toMatch(/Duplicate flag/)
  })

  it('rejects --check and --execute together before any side effect and prints no report', () => {
    const result = runCli(['--check', '--execute'])
    expect(result.status).toBe(2)
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toMatch(/mutually exclusive/)
  })
})
