// Unit tests for scripts/inventory-source-contracts.mjs (bounded CLI-only census).
//
// Miniature fixture git repos under os.tmpdir() only (`git init`, one local commit
// with a throwaway identity — never touching the real pinned Drogon-mentu-session
// checkout, never pushed). Run with:
//   node --test scripts/inventory-source-contracts.test.mjs
//
// Coverage map:
//   1. Nonempty extraction: a two-file registry resolves a nonzero command count;
//      an empty COMMAND_SPECS registry fails the run instead of reporting 0.
//   2. Aliases + allowedFlags (incl. a cross-file constant spread) are captured
//      verbatim in the emitted spec record.
//   3. Cross-file registry spreads (COMMAND_SPECS spreading two spec files, and
//      HANDLER_GROUPS spreading browser-handler-groups.ts) resolve and are
//      recorded in `composition`.
//   4. An unresolved registry expression (a non-literal array element) is recorded
//      as an explicit unresolved entry, never silently dropped or miscounted; a
//      handler-group manifest key with no matching command is an explicit
//      unresolved link.
//   5. Deterministic rerun: `--verify` regenerates both artifacts in memory and
//      confirms byte-identical output against what generation just wrote.
//   6. Source SHA mismatch: a fixture repo's HEAD never equals the pinned legacy
//      baseline, so a run without `--allow-sha-mismatch` must fail before any
//      output is written, and a run with the flag must succeed and record the
//      mismatch.
//   7. Output confinement: a path outside the repo root, a symlinked output
//      directory, and a symlinked output leaf are all rejected before any write.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(SCRIPT_DIR, 'inventory-source-contracts.mjs')
const REPO_ROOT = realpathSync(join(SCRIPT_DIR, '..'))

function git(fixture, ...args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture',
      '-c', `core.hooksPath=${join(fixture, '.no-fixture-hooks')}`,
      '-c', 'commit.gpgSign=false', ...args],
    { cwd: fixture, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

function write(relative, content, fixture) {
  const full = join(fixture, ...relative.split('/'))
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function commitFixture(fixture) {
  git(fixture, 'init', '-q')
  git(fixture, 'add', '-A')
  git(fixture, 'commit', '-q', '-m', 'fixture', '-m', 'Co-authored-by: Codex <noreply@openai.com>')
}

// Base fixture:
//   - specs/a.ts: two specs, one with an alias, a positionalArgs literal, and
//     allowedFlags spreading a cross-file GLOBAL_FLAGS constant plus a literal.
//   - specs/b.ts: one spec.
//   - specs/index.ts: COMMAND_SPECS = [...A_SPECS, ...B_SPECS, buildExtra()] — the
//     trailing call expression is a non-literal, unresolved registry element.
//   - handler-group-manifest.ts: HANDLER_GROUPS = [{ groupA keys covering both a.ts
//     commands }, ...BROWSER_HANDLER_GROUPS] where BROWSER_HANDLER_GROUPS (in a
//     separate file) contributes a group whose one key ('ghost thing') matches no
//     command in the registry (an unresolved manifest link).
function makeFixture() {
  return makeFixtureAt(mkdtempSync(join(tmpdir(), 'inventory-cli-fixture-')))
}

function makeFixtureAt(root) {
  const fixture = realpathSync(root)

  write('src/cli/args.ts', ["export const GLOBAL_FLAGS = ['json', 'env']", ''].join('\n'), fixture)

  write(
    'src/cli/specs/a.ts',
    [
      "import { GLOBAL_FLAGS } from '../args'",
      '',
      'export const A_SPECS = [',
      '  {',
      "    path: ['widget', 'list'],",
      "    aliases: [['widget', 'ls']],",
      "    summary: 'List widgets',",
      "    usage: 'orca widget list',",
      "    allowedFlags: [...GLOBAL_FLAGS, 'cursor'],",
      "    positionalArgs: ['id'],",
      '  },',
      '  {',
      "    path: ['widget', 'create'],",
      "    summary: 'Create a widget',",
      "    usage: 'orca widget create',",
      "    destructive: true,",
      "    allowedFlags: ['name'],",
      '  },',
      ']',
      '',
    ].join('\n'),
    fixture,
  )

  write(
    'src/cli/specs/b.ts',
    [
      'export const B_SPECS = [',
      '  {',
      "    path: ['widget', 'remove'],",
      "    summary: 'Remove a widget',",
      "    usage: 'orca widget remove',",
      "    destructive: true,",
      "    allowedFlags: ['id'],",
      '  },',
      ']',
      '',
    ].join('\n'),
    fixture,
  )

  write(
    'src/cli/specs/index.ts',
    [
      "import { A_SPECS } from './a'",
      "import { B_SPECS } from './b'",
      "import { buildExtra } from './extra'",
      '',
      'export const COMMAND_SPECS = [...A_SPECS, ...B_SPECS, buildExtra()]',
      '',
    ].join('\n'),
    fixture,
  )
  write(
    'src/cli/specs/extra.ts',
    ["export function buildExtra() {", "  return { path: ['dynamic'], summary: 'built at runtime' }", '}', ''].join('\n'),
    fixture,
  )

  write(
    'src/cli/browser-handler-groups.ts',
    [
      'export const BROWSER_HANDLER_GROUPS = [',
      '  {',
      "    name: 'browser',",
      "    keys: ['ghost thing'],",
      "    load: async () => ({}),",
      '  },',
      ']',
      '',
    ].join('\n'),
    fixture,
  )
  write(
    'src/cli/handler-group-manifest.ts',
    [
      "import { BROWSER_HANDLER_GROUPS } from './browser-handler-groups'",
      '',
      'export const HANDLER_GROUPS = [',
      '  {',
      "    name: 'widget',",
      "    keys: ['widget list', 'widget create', 'widget remove'],",
      "    load: async () => ({}),",
      '  },',
      '  ...BROWSER_HANDLER_GROUPS,',
      ']',
      '',
    ].join('\n'),
    fixture,
  )

  commitFixture(fixture)
  return fixture
}

// Output confinement is enforced against THIS repo's root (derived from the
// script's own on-disk location), not the fixture's tmpdir — so every test
// that expects a successful write needs its output inside the repo. Each such
// test gets its own scratch dir under .preflight/parity-contracts/, removed
// unconditionally afterward.
function withRepoScratch(fn) {
  const scratchRoot = mkdtempSync(join(REPO_ROOT, '.preflight', 'parity-contracts', 'test-scratch-'))
  try {
    return fn(scratchRoot)
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
}

function runScript(fixture, extraArgs, { jsonOutput, mdOutput } = {}) {
  const jsonPath = jsonOutput ?? join(fixture, 'out', 'contracts.json')
  const mdPath = mdOutput ?? join(fixture, 'out', 'contracts.md')
  // Evidence writing goes through the same repo-confinement guard as the
  // JSON/MD outputs, so it must live next to whichever of them is confined;
  // tests that intentionally point outputs outside the repo skip evidence.
  const args = [
    SCRIPT,
    '--source',
    fixture,
    '--output',
    jsonPath,
    '--md-output',
    mdPath,
    '--evidence-dir',
    join(dirname(jsonPath), 'evidence'),
    ...extraArgs,
  ]
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
  return { result, jsonPath, mdPath }
}

describe('inventory-source-contracts CLI census', () => {
  it('extracts a nonempty registry with aliases, positionals, and a resolved cross-file flag spread', () => {
    withRepoScratch((scratch) => {
      const fixture = makeFixture()
      const { result, jsonPath } = runScript(fixture, ['--allow-sha-mismatch'], {
        jsonOutput: join(scratch, 'contracts.json'),
        mdOutput: join(scratch, 'contracts.md'),
      })
      assert.equal(result.status, 0, result.stderr)
      const doc = JSON.parse(readFileSync(jsonPath, 'utf8'))
      assert.equal(doc.cli.registryCount, 3, 'buildExtra() call is unresolved, not counted')
      const list = doc.cli.specs.find((s) => s.path.join(' ') === 'widget list')
      assert.ok(list, 'widget list spec must be present')
      assert.deepEqual(list.aliases, [['widget', 'ls']])
      assert.deepEqual(list.positionals, ['id'])
      assert.deepEqual(list.allowedFlags, ['cursor', 'env', 'json'], 'GLOBAL_FLAGS spread must resolve')
      assert.equal(list.allowedFlagsUnresolvedSpreads.length, 0)
      const create = doc.cli.specs.find((s) => s.path.join(' ') === 'widget create')
      assert.equal(create.destructive, true)
    })
  })

  it('fails loudly on an empty registry instead of reporting zero', () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-cli-empty-')))
    write('src/cli/specs/index.ts', ['export const COMMAND_SPECS = []', ''].join('\n'), fixture)
    write(
      'src/cli/handler-group-manifest.ts',
      ['export const HANDLER_GROUPS = []', ''].join('\n'),
      fixture,
    )
    commitFixture(fixture)
    const { result } = runScript(fixture, ['--allow-sha-mismatch'])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /empty CLI registry extraction/)
  })

  it('records cross-file registry and handler-group spreads in composition', () => {
    withRepoScratch((scratch) => {
      const fixture = makeFixture()
      const { result, jsonPath } = runScript(fixture, ['--allow-sha-mismatch'], {
        jsonOutput: join(scratch, 'contracts.json'),
        mdOutput: join(scratch, 'contracts.md'),
      })
      assert.equal(result.status, 0, result.stderr)
      const doc = JSON.parse(readFileSync(jsonPath, 'utf8'))
      const specSpreads = doc.cli.composition.filter((c) => c.status === 'resolved').map((c) => c.spread)
      assert.ok(specSpreads.includes('A_SPECS'))
      assert.ok(specSpreads.includes('B_SPECS'))
      const groupSpreads = doc.handlerGroupMembership.groupComposition
        .filter((c) => c.status === 'resolved')
        .map((c) => c.spread)
      assert.ok(groupSpreads.includes('BROWSER_HANDLER_GROUPS'))
    })
  })

  it('records unresolved registry expressions and unmatched manifest keys explicitly', () => {
    withRepoScratch((scratch) => {
      const fixture = makeFixture()
      const { result, jsonPath } = runScript(fixture, ['--allow-sha-mismatch'], {
        jsonOutput: join(scratch, 'contracts.json'),
        mdOutput: join(scratch, 'contracts.md'),
      })
      assert.equal(result.status, 0, result.stderr)
      const doc = JSON.parse(readFileSync(jsonPath, 'utf8'))
      assert.equal(doc.cli.registryUnresolved.length, 1)
      assert.match(doc.cli.registryUnresolved[0].reason, /not-object-literal/)
      assert.ok(doc.handlerGroupMembership.unmatchedManifestKeys.includes('ghost thing'))
    })
  })

  it('is byte-identical on a deterministic rerun via --verify', () => {
    withRepoScratch((scratch) => {
      const fixture = makeFixture()
      const jsonOutput = join(scratch, 'contracts.json')
      const mdOutput = join(scratch, 'contracts.md')
      const { result: gen } = runScript(fixture, ['--allow-sha-mismatch'], { jsonOutput, mdOutput })
      assert.equal(gen.status, 0, gen.stderr)
      const { result: verify } = runScript(fixture, ['--allow-sha-mismatch', '--verify'], {
        jsonOutput,
        mdOutput,
      })
      assert.equal(verify.status, 0, verify.stderr)
      assert.match(verify.stdout, /verify: OK/)
    })
  })

  it('fails on a source HEAD sha mismatch unless explicitly allowed', () => {
    withRepoScratch((scratch) => {
      const fixture = makeFixture()
      const strictJson = join(scratch, 'strict.json')
      const strict = runScript(fixture, [], { jsonOutput: strictJson, mdOutput: join(scratch, 'strict.md') })
      assert.notEqual(strict.result.status, 0)
      assert.match(strict.result.stderr, /does not match pinned baseline/)
      assert.equal(existsSync(strictJson), false, 'must not write output on a rejected run')

      const allowed = runScript(fixture, ['--allow-sha-mismatch'], {
        jsonOutput: join(scratch, 'allowed.json'),
        mdOutput: join(scratch, 'allowed.md'),
      })
      assert.equal(allowed.result.status, 0, allowed.result.stderr)
      const doc = JSON.parse(readFileSync(allowed.jsonPath, 'utf8'))
      assert.equal(doc.source.shaMismatch, true)
    })
  })

  it('rejects an output path outside the repo root', () => {
    const fixture = makeFixture()
    const outside = join(tmpdir(), `inventory-cli-outside-${Date.now()}.json`)
    const { result } = runScript(fixture, ['--allow-sha-mismatch'], {
      jsonOutput: outside,
      mdOutput: join(tmpdir(), `inventory-cli-outside-${Date.now()}.md`),
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /escapes allowed root/)
    assert.equal(existsSync(outside), false)
  })

  it('rejects a symlinked output directory before writing', () => {
    const fixture = makeFixture()
    const scratchRoot = mkdtempSync(join(REPO_ROOT, '.preflight', 'parity-contracts', 'test-scratch-'))
    try {
      const outsideTarget = mkdtempSync(join(tmpdir(), 'inventory-cli-symlink-target-'))
      const symlinkedDir = join(scratchRoot, 'linked')
      symlinkSync(outsideTarget, symlinkedDir)
      const jsonOutput = join(symlinkedDir, 'contracts.json')
      const { result } = runScript(fixture, ['--allow-sha-mismatch'], {
        jsonOutput,
        mdOutput: join(symlinkedDir, 'contracts.md'),
      })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /symlink/)
      assert.equal(existsSync(jsonOutput), false)
    } finally {
      rmSync(scratchRoot, { recursive: true, force: true })
    }
  })

  it('refuses to write through an existing symlinked output leaf', () => {
    const fixture = makeFixture()
    const scratchRoot = mkdtempSync(join(REPO_ROOT, '.preflight', 'parity-contracts', 'test-scratch-'))
    try {
      const decoyTarget = join(scratchRoot, 'decoy.json')
      writeFileSync(decoyTarget, '{}')
      const jsonOutput = join(scratchRoot, 'contracts.json')
      symlinkSync(decoyTarget, jsonOutput)
      const { result } = runScript(fixture, ['--allow-sha-mismatch'], {
        jsonOutput,
        mdOutput: join(scratchRoot, 'contracts.md'),
      })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /existing symlink/)
      assert.equal(readFileSync(decoyTarget, 'utf8'), '{}', 'decoy target must be untouched')
    } finally {
      rmSync(scratchRoot, { recursive: true, force: true })
    }
  })

  // --- Acceptance-correction regressions (added before the corresponding fix) ---

  it('rejects a DANGLING symlink source path component instead of treating it as merely missing', () => {
    const fixture = makeFixture()
    // existsSync() returns false for a dangling symlink (it follows the link
    // and finds nothing) — a guard gated on existsSync before lstat never
    // even inspects the link, so a dangling symlink swapped in for a real
    // spec file must be caught by an lstat-first walk, not silently reported
    // as "file missing".
    const danglingTarget = join(fixture, 'src', 'cli', 'specs', 'does-not-exist-target.ts')
    const danglingLink = join(fixture, 'src', 'cli', 'specs', 'c.ts')
    symlinkSync(danglingTarget, danglingLink)
    withRepoScratch((scratch) => {
      const { result } = runScript(fixture, ['--allow-sha-mismatch'], {
        jsonOutput: join(scratch, 'contracts.json'),
        mdOutput: join(scratch, 'contracts.md'),
      })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /symlink/i)
      assert.doesNotMatch(result.stderr, /is not iterable|Cannot read prop/i)
    })
  })

  it('rejects a DANGLING symlink at the output leaf before any write', () => {
    const fixture = makeFixture()
    withRepoScratch((scratch) => {
      const jsonOutput = join(scratch, 'contracts.json')
      symlinkSync(join(scratch, 'nowhere.json'), jsonOutput)
      const { result } = runScript(fixture, ['--allow-sha-mismatch'], {
        jsonOutput,
        mdOutput: join(scratch, 'contracts.md'),
      })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /symlink/i)
    })
  })

  it('rejects an output path that lands inside the actual --source root, even nested under .preflight', () => {
    // The confinement check must key off the ACTUAL resolved --source
    // argument, not the script's DEFAULT_SOURCE constant — otherwise
    // pointing --source at some other path (including one nested inside
    // this repo's own .preflight/ directory) would let an output path land
    // inside the "source" tree undetected.
    withRepoScratch((scratch) => {
      const nestedSourceRoot = join(scratch, 'nested-source')
      mkdirSync(nestedSourceRoot, { recursive: true })
      // Build the fixture directly under the nested (in-repo, under
      // .preflight/) source root.
      const realFixture = makeFixtureAt(nestedSourceRoot)
      const jsonOutput = join(realFixture, 'src', 'cli', 'leaked-contracts.json')
      const { result } = runScript(realFixture, ['--allow-sha-mismatch'], {
        jsonOutput,
        mdOutput: join(realFixture, 'src', 'cli', 'leaked-contracts.md'),
      })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /source tree|escapes/i)
      assert.equal(existsSync(jsonOutput), false)
    })
  })

  it('fails a SHA mismatch even under --verify (no silent bypass)', () => {
    const fixture = makeFixture()
    withRepoScratch((scratch) => {
      const jsonOutput = join(scratch, 'contracts.json')
      const mdOutput = join(scratch, 'contracts.md')
      const { result } = runScript(fixture, ['--verify'], { jsonOutput, mdOutput })
      assert.notEqual(result.status, 0, 'a mismatched sha must fail --verify too, not skip the gate')
      assert.match(result.stderr, /does not match pinned baseline/)
    })
  })

  it('fails on a tracked-dirty legacy source instead of silently recording it', () => {
    const fixture = makeFixture()
    write('src/cli/specs/a.ts', readFileSync(join(fixture, 'src/cli/specs/a.ts'), 'utf8') + '\n// dirty edit\n', fixture)
    withRepoScratch((scratch) => {
      const { result } = runScript(fixture, ['--allow-sha-mismatch'], {
        jsonOutput: join(scratch, 'contracts.json'),
        mdOutput: join(scratch, 'contracts.md'),
      })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /tracked dirty/i)
    })
  })

  it('records the ACTUAL resolved --source root in the document, not a hardcoded default', () => {
    withRepoScratch((scratch) => {
      const fixture = makeFixture()
      const jsonOutput = join(scratch, 'contracts.json')
      const { result, jsonPath } = runScript(fixture, ['--allow-sha-mismatch'], {
        jsonOutput,
        mdOutput: join(scratch, 'contracts.md'),
      })
      assert.equal(result.status, 0, result.stderr)
      const doc = JSON.parse(readFileSync(jsonPath, 'utf8'))
      assert.equal(doc.source.root, realpathSync(fixture))
      assert.doesNotMatch(doc.source.root, /Drogon-mentu-session/)
    })
  })
})
