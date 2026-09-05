// Unit tests for scripts/inventory-source-tests.mjs.
//
// Miniature fixture git repos under os.tmpdir() only (`git init`, `git add`,
// one local commit with throwaway identity — never touching a real repo, never
// pushed, never committed outside the fixture). Run with:
//   node --test scripts/inventory-source-tests.test.mjs

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'inventory-source-tests.mjs')

function git(fixture, ...args) {
  const result = spawnSync('git', ['-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', ...args], {
    cwd: fixture,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

function write(relative, content, fixture) {
  const full = join(fixture, ...relative.split('/'))
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

// Happy-path fixture: config include, importer/spec pair, orphan spec,
// binary asset, symlink, unclassified name, package scripts.
function makeFixture() {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-fixture-')))
  write(
    'config/vitest.config.ts',
    "export default { test: { include: ['src/**/*.test.ts', 'tests/e2e/**/*.unit.test.ts'] } }\n",
    fixture,
  )
  write('tests/e2e/u.unit.test.ts', "import { it } from 'vitest'\nit('u', () => {})\n", fixture)
  write(
    'src/a.test.ts',
    "import './helper.spec'\nimport { describe, it } from 'vitest'\ndescribe('a', () => {\n  it('one', () => {})\n  it.skip('two', () => {})\n})\nit.each([1, 2])('n=%i', () => {})\n",
    fixture,
  )
  write('src/helper.spec.ts', "import { it } from 'vitest'\nit('helper case', () => {})\n", fixture)
  write('src/orphan.spec.ts', "import { it } from 'vitest'\nit('orphan case', () => {})\n", fixture)
  write('odd/thing.test.zzz', 'nothing test-shaped here\n', fixture)
  const binary = Buffer.from([0, 1, 2, 3, 255, 254, 0, 65, 66, 67])
  const binaryFull = join(fixture, 'bin', 'tool.test.bin')
  mkdirSync(dirname(binaryFull), { recursive: true })
  writeFileSync(binaryFull, binary)
  symlinkSync(join(fixture, 'src', 'a.test.ts'), join(fixture, 'src', 'link.test.ts'))
  write(
    'package.json',
    JSON.stringify({
      name: 'fixture',
      scripts: {
        test: 'vitest run --config config/vitest.config.ts',
        'test:docs': 'node --test docs-tests/*.test.mjs',
        'test:shared': 'node --test pkg/../shared/*.test.mjs',
      },
    }),
    fixture,
  )
  write('shared/s.test.mjs', "import test from 'node:test'\ntest('s', () => {})\n", fixture)
  write('pkg2/package.json', JSON.stringify({ name: 'pkg2', scripts: { build: 'tsc' } }), fixture)
  write('pkg2/vitest.config.ts', "export default { test: { include: ['src/**/*.test.ts'] } }\n", fixture)
  write('pkg2/src/w.test.ts', "import { it } from 'vitest'\nit('w', () => {})\n", fixture)
  write('pkg3/src/w2.test.ts', "import { it } from 'vitest'\nit('w2', () => {})\n", fixture)
  write('tests/playwright.config.ts', "export default { testDir: './e2e' }\n", fixture)
  write('tests/e2e/flow.spec.ts', "import { test } from '@playwright/test'\ntest('flow', () => {})\n", fixture)
  write('native/helper.swift', 'func helper() {}\n', fixture)
  write('docs-tests/d.test.mjs', "import test from 'node:test'\ntest('d', () => {})\n", fixture)
  write(
    'docs/site/package.json',
    JSON.stringify({ name: 'docsx', scripts: { test: 'node --test tests/*.test.mjs' } }),
    fixture,
  )
  write('docs/site/tests/d.test.mjs', "import test from 'node:test'\ntest('d', () => {})\n", fixture)
  write('pkg3/package.json', JSON.stringify({ name: 'pkg3', scripts: { test: 'vitest run' } }), fixture)
  write('pkg3/src/lone.spec.ts', "import { it } from 'vitest'\nit('lone', () => {})\n", fixture)
  write('cyc/a.spec.ts', "import './b.spec'\nimport { it } from 'vitest'\nit('a', () => {})\n", fixture)
  write('cyc/b.spec.ts', "import './a.spec'\nimport { it } from 'vitest'\nit('b', () => {})\n", fixture)
  write('src/secret.test.ts', "import { it } from 'vitest'\nit('secret', () => {})\n", fixture)
  git(fixture, 'init', '-q')
  git(fixture, 'add', '-A')
  chmodSync(join(fixture, 'src', 'secret.test.ts'), 0o000)
  git(fixture, 'commit', '-qm', 'fixture', '-m', 'Co-authored-by: Codex <noreply@openai.com>')
  return { fixture, binary }
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', ...options })
}

function runFixture(extraArgs = []) {
  const { fixture, binary } = makeFixture()
  const output = join(fixture, '..', `manifest-${Date.now()}-${process.pid}.json`)
  const result = run(['--source', fixture, '--output', output, ...extraArgs])
  assert.equal(result.status, 0, `expected exit 0, stderr: ${result.stderr}`)
  const manifest = JSON.parse(readFileSync(output, 'utf8'))
  return { fixture, binary, output, manifest }
}

function entryByPath(manifest, path) {
  const entry = manifest.files.find((item) => item.path === path)
  assert.ok(entry, `expected manifest entry for ${path}`)
  return entry
}

describe('inventory-source-tests CLI strictness', () => {
  it('refuses a staging suffix containing path segments', () => {
    const result = run(['--source', '.', '--output', 'unused.json'], {
      env: { ...process.env, INVENTORY_STAGING_SUFFIX: '/../../outside' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /safe filename component/)
  })

  it('rejects unknown arguments', () => {
    const result = run(['--bogus', 'x'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /unknown argument: --bogus/)
  })

  it('rejects a missing flag value', () => {
    const result = run(['--source'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /missing value for --source/)
  })

  it('rejects duplicate flags', () => {
    const result = run(['--source', 'a', '--source', 'b', '--output', 'c'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /duplicate argument: --source/)
  })

  it('rejects missing required flags', () => {
    const result = run(['--source', 'a'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /usage:/)
  })

  it('fails closed on a non-git source root', () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-nogit-')))
    const result = run(['--source', empty, '--output', join(empty, '..', 'out.json')])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /inventory-source-tests: /)
  })

  it('refuses output inside the source tree', () => {
    const { fixture } = makeFixture()
    const result = run(['--source', fixture, '--output', join(fixture, 'manifest.json')])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /inside the source tree/)
  })

  it('refuses a symlinked output path', () => {
    const { fixture } = makeFixture()
    const real = join(fixture, '..', `real-${process.pid}.json`)
    writeFileSync(real, '{}\n')
    const link = join(fixture, '..', `link-${process.pid}.json`)
    symlinkSync(real, link)
    const result = run(['--source', fixture, '--output', link])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /symlinked output/)
  })

  it('refuses an output whose parent resolves into the source tree', () => {
    const { fixture } = makeFixture()
    const aliasDir = mkdtempSync(join(tmpdir(), 'inventory-alias-'))
    const alias = join(aliasDir, 'into-source')
    symlinkSync(fixture, alias)
    const result = run(['--source', fixture, '--output', join(alias, 'out.json')])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /resolves inside the source tree/)
  })

  it('refuses an aliased source parent before creating nested directories', () => {
    const { fixture } = makeFixture()
    const aliasDir = mkdtempSync(join(tmpdir(), 'inventory-alias-nested-'))
    symlinkSync(fixture, join(aliasDir, 'source'))
    const result = run(['--source', fixture, '--output', join(aliasDir, 'source', 'new-output', 'manifest.json')])
    assert.equal(result.status, 1)
    assert.equal(existsSync(join(fixture, 'new-output')), false, 'read-only source must not receive even an empty output directory')
  })

  it('refuses staging through a preexisting temp symlink', () => {
    const { fixture } = makeFixture()
    const outDir = mkdtempSync(join(tmpdir(), 'inventory-staging-'))
    symlinkSync(join(fixture, 'package.json'), join(outDir, '.inventory-pinned.tmp'))
    const result = run(['--source', fixture, '--output', join(outDir, 'out.json')], {
      env: { ...process.env, INVENTORY_STAGING_SUFFIX: 'pinned' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /temp path already exists/)
    assert.ok(
      !readFileSync(join(fixture, 'package.json'), 'utf8').includes('symlink-target-write'),
      'staging must never follow the temp symlink',
    )
  })

  it('refuses an unwritable output directory', { skip: process.geteuid?.() === 0 }, () => {
    const { fixture } = makeFixture()
    const locked = join(fixture, '..', `locked-${process.pid}`)
    mkdirSync(locked)
    chmodSync(locked, 0o555)
    try {
      const result = run(['--source', fixture, '--output', join(locked, 'out.json')])
      assert.equal(result.status, 1)
      assert.match(result.stderr, /cannot (stage|write) output/)
    } finally {
      chmodSync(locked, 0o755)
    }
  })
})

describe('inventory-source-tests happy path', () => {
  it('freezes the denominator: every candidate recorded, zero unexplained missing', () => {
    const { manifest } = runFixture()
    assert.equal(manifest.schema, 'drogon.parity-source-tests/2')
    assert.equal(manifest.status, 'inventory-only')
    assert.equal(manifest.stats.unexplainedMissing, 0)
    assert.equal(manifest.stats.recordedCandidates, manifest.stats.candidateTotal)
    assert.ok(manifest.stats.candidateTotal >= 7)
  })

  it('classifies runner-matched, imported, orphan, symlink, and unclassified files honestly', () => {
    const { manifest } = runFixture()
    assert.equal(entryByPath(manifest, 'src/a.test.ts').domain, 'unit-vitest')
    const helper = entryByPath(manifest, 'src/helper.spec.ts')
    assert.equal(helper.domain, 'imported-spec')
    assert.deepEqual(helper.reachedVia, ['src/a.test.ts'])
    assert.equal(entryByPath(manifest, 'src/orphan.spec.ts').domain, 'imported-spec-unresolved')
    assert.equal(entryByPath(manifest, 'src/link.test.ts').domain, 'symlink-refused')
    assert.equal(entryByPath(manifest, 'odd/thing.test.zzz').domain, 'unclassified')
    assert.equal(entryByPath(manifest, 'docs/site/tests/d.test.mjs').domain, 'docs-node')
  })

  it('flags every membership as inferred, never verified', () => {
    const { manifest } = runFixture()
    for (const entry of manifest.files) {
      for (const membership of entry.membership ?? []) {
        assert.equal(membership.verified, false, `${entry.path}: membership must be verified:false`)
        assert.ok(membership.config, `${entry.path}: membership needs a source anchor`)
      }
    }
    const matched = entryByPath(manifest, 'src/a.test.ts')
    assert.ok(matched.membership.some((item) => item.config === 'config/vitest.config.ts'))
  })

  it('hashes raw bytes so binary fixtures are exact', () => {
    const { binary, manifest } = runFixture()
    const entry = entryByPath(manifest, 'bin/tool.test.bin')
    assert.equal(entry.binary, true)
    assert.equal(entry.bytes, binary.length)
    assert.equal(entry.sha256, createHash('sha256').update(binary).digest('hex'))
    assert.equal(entry.caseMarkers, null)
  })

  it('keeps git paths POSIX and records text markers without implying counts', () => {
    const { manifest } = runFixture()
    for (const entry of manifest.files) {
      assert.ok(!entry.path.includes('\\'), `${entry.path}: must be POSIX`)
    }
    const entry = entryByPath(manifest, 'src/a.test.ts')
    assert.deepEqual(entry.caseMarkers, { cases: 1, each: 1, skip: 1, todo: 0, only: 0 })
    assert.match(entry.markerNote, /NOT runtime case counts/)
  })

  it('records package.json test scripts without executing configs', () => {
    const { manifest } = runFixture()
    const packages = Object.fromEntries(
      manifest.stats.packageTestScripts.map((item) => [item.package, item.scripts]),
    )
    assert.ok(packages['package.json'].test)
    assert.ok(packages['docs/site/package.json'].test)
  })

  it('resolves playwright testDir against the config dir with a defaulted testMatch', () => {
    const { manifest } = runFixture()
    const entry = entryByPath(manifest, 'tests/e2e/flow.spec.ts')
    assert.equal(entry.domain, 'e2e-playwright')
    assert.ok(entry.membership.some((item) => item.config === 'tests/playwright.config.ts'))
    assert.ok(entry.membershipLimits.some((limit) => /defaulted/.test(limit)))
  })

  it('keeps swift-convention assets in the denominator without touching the candidate census', () => {
    const { manifest } = runFixture()
    const entry = entryByPath(manifest, 'native/helper.swift')
    assert.equal(entry.domain, 'native-swift')
    assert.equal(entry.assetKind, 'swift-convention')
    assert.equal(
      manifest.stats.recordedCandidates,
      manifest.stats.candidateTotal,
      'swift assets must not inflate the candidate count',
    )
  })

  it('collapses dot-dot segments in package-script globs', () => {
    const { manifest } = runFixture()
    const entry = entryByPath(manifest, 'shared/s.test.mjs')
    assert.ok(
      entry.membership.some((item) => /test:shared/.test(item.config)),
      `expected package-script membership, got ${JSON.stringify(entry.membership)}`,
    )
  })

  it('maps unmapped configs to config-derived domains with a gap record', () => {
    const { manifest } = runFixture()
    const entry = entryByPath(manifest, 'pkg2/src/w.test.ts')
    assert.equal(entry.domain, 'vitest-unmapped:pkg2/vitest.config.ts')
    assert.equal(entry.membership[0].config, 'pkg2/vitest.config.ts')
    assert.ok(
      manifest.gaps.some((gap) => gap.id === 'config:unmapped-suite:pkg2/vitest.config.ts'),
    )
  })

  it('infers bare `vitest run` packages via the default include, flagged defaulted', () => {
    const { manifest } = runFixture()
    const entry = entryByPath(manifest, 'pkg3/src/w2.test.ts')
    assert.equal(entry.domain, 'vitest-default:pkg3')
    assert.equal(entry.membership[0].config, 'pkg3/package.json#test')
    assert.ok(
      manifest.gaps.some((gap) => gap.id === 'vitest-include:defaulted:pkg3/package.json#test'),
      'default-include inference must leave a gap record',
    )
  })

  it('prefers an explicit include over a broader default (unit-test convention)', () => {
    const { manifest } = runFixture()
    const entry = entryByPath(manifest, 'tests/e2e/u.unit.test.ts')
    assert.equal(entry.domain, 'unit-vitest')
    assert.equal(entry.membership[0].config, 'config/vitest.config.ts')
    assert.ok(
      (entry.alsoMatched ?? []).some((item) => item.config === 'tests/playwright.config.ts'),
      'the overlapping Playwright default must stay visible as alsoMatched',
    )
  })

  it('assigns default-only standalone specs as inferred membership, not unresolved', () => {
    const { manifest } = runFixture()
    const entry = entryByPath(manifest, 'pkg3/src/lone.spec.ts')
    assert.equal(entry.domain, 'vitest-default:pkg3')
    assert.equal(entry.membership[0].config, 'pkg3/package.json#test')
    assert.ok(
      (entry.membershipLimits ?? []).some((limit) => /standalone via bare-default/.test(limit)),
    )
  })

  it('records importer cycles without roots as unproven, not reachable', () => {
    const { manifest } = runFixture()
    for (const path of ['cyc/a.spec.ts', 'cyc/b.spec.ts']) {
      const entry = entryByPath(manifest, path)
      assert.equal(entry.domain, 'imported-spec-unproven-roots')
      assert.ok(entry.unprovenRoots.length > 0)
    }
    assert.ok(
      manifest.gaps.some((gap) => gap.id === 'candidates:imported-spec-unproven-roots'),
    )
  })

  it('keeps unreadable candidates with their error, never dropped', () => {
    const { manifest } = runFixture()
    const entry = entryByPath(manifest, 'src/secret.test.ts')
    assert.equal(entry.domain, 'unreadable')
    assert.ok(entry.readError)
    assert.equal(entry.caseMarkers, null)
  })

  it('reruns byte-identically', () => {
    const { fixture, output } = runFixture()
    const first = readFileSync(output, 'utf8')
    const second = join(fixture, '..', `manifest2-${process.pid}.json`)
    const result = run(['--source', fixture, '--output', second])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(second, 'utf8'), first)
  })
})
