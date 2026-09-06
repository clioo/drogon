import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkFrozenPorts, compareFrozenTest, splitTestHeader } from './check-frozen-test-ports.mjs'

const hash = text => createHash('sha256').update(text).digest('hex')
const original = "import { it, expect } from 'vitest'\nimport { value } from './source'\n\nit('works', () => { expect(value()).toBe(7) })\n"
const migrated = '// Port provenance: upstream MIT.\n// Original: source.\n' + original.replace("'./source'", "'./candidate'")

test('allows only a leading import/provenance migration without claiming execution', () => {
  const result = compareFrozenTest(Buffer.from(original), Buffer.from(migrated), hash(original))
  assert.equal(result.ok, true)
  assert.equal(result.importRegionChanged, true)
  assert.equal(compareFrozenTest(Buffer.from(original), Buffer.from(original), hash(original)).importRegionChanged, false)
})

for (const [name, candidate, expected] of [
  ['weakened assertion', migrated.replace('toBe(7)', 'toBeTruthy()'), /test body differs/],
  ['skipped case', migrated.replace("it('works'", "it.skip('works'"), /test body differs/],
  ['hidden test in provenance', migrated.replace("it('works'", "// Original: it('works'"), /test body differs/],
  ['new executable header', "const bypass = true\n" + migrated, /test body differs/],
  ['new dynamic import', "import('./setup')\n" + migrated, /test body differs/],
  ['runner directive change', '// @vitest-environment happy-dom\n' + migrated, /runner directives differ/],
  ['directive hidden in provenance', '// Original: @vitest-environment happy-dom\n' + migrated, /runner directives differ/],
  ['trailing executable code', migrated + 'process.exit(0)\n', /test body differs/]
]) {
  test(`rejects ${name}`, () => {
    const result = compareFrozenTest(Buffer.from(original), Buffer.from(candidate), hash(original))
    assert.equal(result.ok, false)
    assert.match(result.errors.join('\n'), expected)
  })
}

test('checks the source digest even when source and candidate were weakened together', () => {
  const changed = original.replace('toBe(7)', 'toBeTruthy()')
  const result = compareFrozenTest(Buffer.from(changed), Buffer.from(changed), hash(original))
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /SHA256 mismatch/)
})

test('preserves renderer directives and supports multiline/default/type imports', () => {
  const before = "// @vitest-environment happy-dom\nimport type { Bot } from './types'\nimport Page from './Page'\nimport {\n  expect,\n  it\n} from 'vitest'\nconst fixture = {}\n"
  const after = "// @vitest-environment happy-dom\n// Port provenance: upstream MIT.\nimport Page, { type Bot } from './binding'\nimport {\n  expect,\n  it\n} from 'vitest'\nconst fixture = {}\n"
  assert.equal(compareFrozenTest(Buffer.from(before), Buffer.from(after), hash(before)).ok, true)
  assert.equal(splitTestHeader(before).imports.length, 3)
})

test('does not remove imports or comments inside test bodies', () => {
  const before = original + "// Original: retained body comment\nimport './body-module'\n"
  const after = original + "// Original: changed body comment\nimport './different-module'\n"
  assert.equal(compareFrozenTest(Buffer.from(before), Buffer.from(after), hash(before)).ok, false)
})

test('rejects an empty body', () => {
  const text = "import 'vitest'\n"
  assert.equal(compareFrozenTest(Buffer.from(text), Buffer.from(text), hash(text)).ok, false)
})

test('rejects malformed UTF-8 instead of normalizing different bytes', () => {
  assert.throws(() => compareFrozenTest(Buffer.from(original), Buffer.from([0xff]), hash(original)))
})

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'drogon-frozen-port-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sourceRoot = join(root, 'source')
  const candidateRoot = join(root, 'candidate')
  mkdirSync(sourceRoot)
  mkdirSync(join(candidateRoot, 'tests/parity/ports/WP-A'), { recursive: true })
  writeFileSync(join(sourceRoot, 'a.test.ts'), original)
  writeFileSync(join(candidateRoot, 'tests/parity/ports/WP-A/a.test.ts'), migrated)
  const manifest = { schema: 'drogon.frozen-test-ports/1', sourceRevision: 'a'.repeat(40), suites: [
    { sourcePath: 'a.test.ts', sourceSha256: hash(original), portPath: 'tests/parity/ports/WP-A/a.test.ts' }
  ] }
  return { root, sourceRoot, candidateRoot, manifest }
}

test('reads scoped files and reports literal preservation separately', t => {
  const f = fixture(t)
  const result = checkFrozenPorts(f.manifest, f.sourceRoot, f.candidateRoot)
  assert.equal(result.ok, true)
  assert.equal(result.preserved, 1)
  assert.equal(result.bindingReviewRequired, true)
  assert.match(result.scope, /NOT import binding equivalence/)
})

for (const [name, change, expected] of [
  ['duplicate entry', m => m.suites.push({ ...m.suites[0] }), /duplicate/],
  ['source traversal', m => { m.suites[0].sourcePath = '../escape' }, /relative path/],
  ['absolute source', m => { m.suites[0].sourcePath = '/tmp/escape' }, /relative path/],
  ['backslash path', m => { m.suites[0].sourcePath = '..\\escape' }, /relative path/],
  ['product port', m => { m.suites[0].portPath = 'apps/file.ts' }, /port outside/],
  ['missing source', m => { m.suites[0].sourcePath = 'missing.ts' }, /ENOENT/],
  ['invalid digest', m => { m.suites[0].sourceSha256 = '' }, /invalid source digest/]
]) {
  test(`fails closed on ${name}`, t => {
    const f = fixture(t)
    change(f.manifest)
    const result = checkFrozenPorts(f.manifest, f.sourceRoot, f.candidateRoot)
    assert.equal(result.ok, false)
    assert.match(result.results.flatMap(row => row.errors).join('\n'), expected)
  })
}

test('rejects symlinks escaping the reference root', t => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'outside.ts'), original)
  symlinkSync(join(f.root, 'outside.ts'), join(f.sourceRoot, 'escape.ts'))
  f.manifest.suites[0].sourcePath = 'escape.ts'
  assert.match(checkFrozenPorts(f.manifest, f.sourceRoot, f.candidateRoot).results[0].errors[0], /outside/)
})

test('rejects malformed or empty manifests', () => {
  for (const value of [null, {}, { schema: 'drogon.frozen-test-ports/1', sourceRevision: 'a'.repeat(40), suites: [] }]) {
    assert.throws(() => checkFrozenPorts(value, '.', '.'), /invalid frozen-test manifest/)
  }
})
