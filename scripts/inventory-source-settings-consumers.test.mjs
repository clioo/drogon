import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeModule as analyzeSource, loadBabelParser } from './inventory-source-settings-consumers.mjs'

const analyzeModule = (file, ...args) => analyzeSource(`src/main/test/${file}`, ...args)

const FIELDS = ['workspaceDir', 'theme', 'agentCmdOverrides', 'disabledTuiAgents', 'gitlabProjects']

// Relative to src/main/test, this resolves to src/shared, not just a matching basename.
const CANONICAL_IMPORT = "import type { GlobalSettings } from '../../shared/global-settings-types'\n"

for (const [name, code] of Object.entries({
  'same-basename noncanonical import': "import type {GlobalSettings} from '../../fake/global-settings-types'; function f(s:GlobalSettings){return s.theme}",
  'bare re-export does not create a local binding': "export type {GlobalSettings} from '../../shared/global-settings-types'; function f(s:GlobalSettings){return s.theme}",
  'excluded Pick member': CANONICAL_IMPORT + "function f(s:Pick<GlobalSettings,'workspaceDir'>){return s.theme}",
  'excluded Omit member': CANONICAL_IMPORT + "function f(s:Omit<GlobalSettings,'theme'>){return s.theme}",
  'union member outside guaranteed intersection': CANONICAL_IMPORT + "function f(s:Pick<GlobalSettings,'theme'>|Pick<GlobalSettings,'workspaceDir'>){return s.theme}",
  'generic type shadows canonical import': CANONICAL_IMPORT + 'function f<GlobalSettings>(s:GlobalSettings){return s.theme}',
  'nested type shadows canonical import': CANONICAL_IMPORT + 'function f(){type GlobalSettings={theme:number}; const s:GlobalSettings=other; return s.theme}',
  'local utility type shadows standard Pick': CANONICAL_IMPORT + "type Pick<T,K>={theme:number}; function f(s:Pick<GlobalSettings,'theme'>){return s.theme}",
  'untyped getter param shadows module getter': CANONICAL_IMPORT + 'function getSettings():GlobalSettings{return {} as GlobalSettings} function f(getSettings:()=>any){const s=getSettings();return s.theme}',
  'destructured local shadows settings param': CANONICAL_IMPORT + 'function f(s:GlobalSettings){ {const {s}=other; return s.theme;} }',
  'catch binding shadows settings param': CANONICAL_IMPORT + 'function f(s:GlobalSettings){try{}catch(s){return s.theme}}',
  'excluded literal initializer property': CANONICAL_IMPORT + "const s:Pick<GlobalSettings,'workspaceDir'>={theme:'dark'}",
  'excluded literal return property': CANONICAL_IMPORT + "function f():Pick<GlobalSettings,'workspaceDir'>{return {theme:'dark'}}",
})) {
  test(`coordinator regression: ${name}`, () => {
    const out = analyzeModule('regression.ts', code, loadBabelParser().parse, FIELDS)
    assert.equal(out.parseError, undefined)
    assert.equal(out.references.length, 0)
  })
}

function refsFor(field, out) {
  return out.references.filter((r) => r.field === field)
}

test('direct typed-param member access is recorded as a read (with real canonical import)', () => {
  const { parse } = loadBabelParser()
  const code = CANONICAL_IMPORT + 'function f(settings: GlobalSettings) { return settings.workspaceDir }\n'
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  const refs = refsFor('workspaceDir', out)
  assert.equal(refs.length, 1)
  assert.equal(refs[0].kind, 'read')
  assert.equal(refs[0].receiverEvidence, 'typed-param:GlobalSettings')
})

test('assignment target on a typed variable is recorded as a write', () => {
  const { parse } = loadBabelParser()
  const code = CANONICAL_IMPORT + "function f(settings: GlobalSettings) { settings.workspaceDir = 'x' }\n"
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  const refs = refsFor('workspaceDir', out)
  assert.equal(refs.length, 1)
  assert.equal(refs[0].kind, 'write')
})

test('destructured param off a Pick<GlobalSettings, ...> type is a direct read', () => {
  const { parse } = loadBabelParser()
  const code = CANONICAL_IMPORT + "function f(s: Pick<GlobalSettings, 'workspaceDir' | 'theme'>) { return s.workspaceDir }\n"
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(refsFor('workspaceDir', out).length, 1)
})

test('destructured object param typed via a local props alias resolves through one hop', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    'type Props = { settings: GlobalSettings }',
    'function Comp({ settings }: Props) { return settings.theme }',
    '',
  ].join('\n')
  const out = analyzeModule('a.tsx', code, parse, FIELDS)
  const refs = refsFor('theme', out)
  assert.equal(refs.length, 1)
  assert.match(refs[0].receiverEvidence, /nested-container/)
})

test('typed-variable object-literal initializer records writes for each literal key', () => {
  const { parse } = loadBabelParser()
  const code = CANONICAL_IMPORT + "const DEFAULT: GlobalSettings = { workspaceDir: 'x', theme: 'dark' }\n"
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(refsFor('workspaceDir', out)[0].kind, 'write')
  assert.equal(refsFor('theme', out)[0].kind, 'write')
  assert.equal(refsFor('workspaceDir', out)[0].receiverEvidence, 'typed-variable-object-literal-init')
})

test('typed-return object literal records writes', () => {
  const { parse } = loadBabelParser()
  const code = CANONICAL_IMPORT + "function build(): GlobalSettings { return { workspaceDir: 'x' } }\n"
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(refsFor('workspaceDir', out)[0].kind, 'write')
  assert.equal(refsFor('workspaceDir', out)[0].receiverEvidence, 'typed-return-object-literal')
})

test('same-module getter parameter merely referenced (not called) is not a settings binding', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    'function useIt(deps: { getSettings: () => GlobalSettings }) {',
    '  const settings = deps.getSettings',
    '}',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(out.references.length, 0)
})

test('module-level getter function call resolves same-module return type', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    'function getSettings(): GlobalSettings { return {} as GlobalSettings }',
    'function use() {',
    '  const settings = getSettings()',
    '  return settings.workspaceDir',
    '}',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  const refs = refsFor('workspaceDir', out)
  assert.equal(refs.length, 1)
  assert.match(refs[0].receiverEvidence, /typed-call-return/)
})

test('plain identifier alias without its own annotation is recorded as unresolved, not attributed', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    'function f(settings: GlobalSettings) {',
    '  const s2 = settings',
    '  return s2.workspaceDir',
    '}',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(out.references.length, 0)
  assert.equal(out.unresolved.aliasAccesses.length, 1)
  assert.equal(out.unresolved.aliasAccesses[0].aliasName, 's2')
  assert.equal(out.unresolved.aliasAccesses[0].aliasedFrom, 'settings')
})

test('computed non-literal key on a confirmed receiver is unresolved-dynamic, not attributed', () => {
  const { parse } = loadBabelParser()
  const code = CANONICAL_IMPORT + 'function f(settings: GlobalSettings, key: keyof GlobalSettings) { return settings[key] }\n'
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(out.references.length, 0)
  assert.equal(out.unresolved.computedDynamicAccesses.length, 1)
})

test('computed string-literal bracket access on a confirmed receiver is still a direct read', () => {
  const { parse } = loadBabelParser()
  const code = CANONICAL_IMPORT + "function f(settings: GlobalSettings) { return settings['workspaceDir'] }\n"
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  const refs = refsFor('workspaceDir', out)
  assert.equal(refs.length, 1)
  assert.equal(refs[0].accessForm, 'bracket-literal')
})

test('unknown-receiver access matching a field name is a candidate, never a field reference', () => {
  const { parse } = loadBabelParser()
  const code = 'function f(other: unknown) { return (other as any).workspaceDir }\n'
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(out.references.length, 0)
  assert.equal(out.unresolved.candidateAccesses.length, 1)
  assert.equal(out.unresolved.candidateAccesses[0].propertyName, 'workspaceDir')
})

test('rest destructure element is recorded as unresolved, never expanded to field references', () => {
  const { parse } = loadBabelParser()
  const code = CANONICAL_IMPORT + 'function f({ workspaceDir, ...rest }: GlobalSettings) { return workspaceDir }\n'
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(refsFor('workspaceDir', out).length, 1)
  assert.equal(out.unresolved.destructureRestUnresolved.length, 1)
})

test('renamed GlobalSettings import from the canonical module is still recognized', () => {
  const { parse } = loadBabelParser()
  const code = [
    "import type { GlobalSettings as GS } from '../../shared/global-settings-types'",
    'function f(settings: GS) { return settings.workspaceDir }',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(refsFor('workspaceDir', out).length, 1)
})

test('member access outside the declaring function scope is not attributed (documented limitation), but still surfaces as a candidate', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    'function outer(settings: GlobalSettings) {',
    '  function inner() { return settings.workspaceDir }',
    '  return inner()',
    '}',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(out.references.length, 0)
  assert.equal(out.unresolved.candidateAccesses.length, 1)
  assert.equal(out.unresolved.candidateAccesses[0].receiverText, 'settings')
})

test('a reference inside a describe/it test body records the nearest test title', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    "describe('suite', () => {",
    "  it('reads workspaceDir', () => {",
    '    function f(settings: GlobalSettings) { return settings.workspaceDir }',
    '  })',
    '})',
    '',
  ].join('\n')
  const out = analyzeModule('a.test.ts', code, parse, FIELDS)
  const refs = refsFor('workspaceDir', out)
  assert.equal(refs.length, 1)
  assert.equal(refs[0].testTitle, 'reads workspaceDir')
})

test('a syntax error is reported as a parse failure, not silently skipped', () => {
  const { parse } = loadBabelParser()
  const out = analyzeModule('broken.ts', 'function f( { : }\n', parse, FIELDS)
  assert.ok(out.parseError)
  assert.equal(out.references.length, 0)
})

// ---------------------------------------------------------------------------
// Regression fixtures for the three reviewer-flagged false-positive classes.
// ---------------------------------------------------------------------------

test('[false-positive 1] a locally declared type/interface literally named GlobalSettings, NOT imported from the canonical module, is never confirmed', () => {
  const { parse } = loadBabelParser()
  const code = [
    // No import at all — a bare local declaration reusing the spelling.
    'interface GlobalSettings { workspaceDir: string }',
    'function f(settings: GlobalSettings) { return settings.workspaceDir }',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(out.references.length, 0)
})

test('[false-positive 1] an import of a same-named GlobalSettings type from a NON-canonical module path is never confirmed', () => {
  const { parse } = loadBabelParser()
  const code = [
    "import type { GlobalSettings } from '../../unrelated/some-other-types'",
    'function f(settings: GlobalSettings) { return settings.workspaceDir }',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(out.references.length, 0)
})

test('[valid control] an import of GlobalSettings from the real canonical module path IS confirmed', () => {
  const { parse } = loadBabelParser()
  const code = [
    "import type { GlobalSettings } from '../../shared/global-settings-types'",
    'function f(settings: GlobalSettings) { return settings.workspaceDir }',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(refsFor('workspaceDir', out).length, 1)
})

test('[false-positive 2] an ambiguous union (GlobalSettings | unrelated shape) is never confirmed', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    'type UnrelatedShape = { workspaceDir: number }',
    'function f(x: GlobalSettings | UnrelatedShape) { return x.workspaceDir }',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(out.references.length, 0)
})

test('[valid control] a nullish union (GlobalSettings | null | undefined) is still confirmed', () => {
  const { parse } = loadBabelParser()
  const code = CANONICAL_IMPORT + 'function f(settings: GlobalSettings | null) { return settings.workspaceDir }\n'
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(refsFor('workspaceDir', out).length, 1)
})

test('[valid control] a union where EVERY alternative independently matches attributes the intersection of fields', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    "function f(x: Pick<GlobalSettings, 'workspaceDir'> | Pick<GlobalSettings, 'workspaceDir' | 'theme'>) {",
    '  return x.workspaceDir',
    '}',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(refsFor('workspaceDir', out).length, 1)
})

test('[false-positive 3] a param later shadowed by a differently-typed same-named local marks the whole scope ambiguous', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    'function f(settings: GlobalSettings) {',
    '  if (Math.random() > 0.5) {',
    '    const settings = 42', // unrelated re-declaration of the same name
    '    return settings',
    '  }',
    '  return settings.workspaceDir', // must NOT be attributed: name is ambiguous in this scope
    '}',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  assert.equal(out.references.length, 0)
})

test('[false-positive 3] two sibling blocks each declaring the same name differently are both treated as ambiguous', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    'function f(cond: boolean) {',
    '  if (cond) {',
    '    const settings: GlobalSettings = { workspaceDir: "x" } as GlobalSettings',
    '    return settings.workspaceDir',
    '  } else {',
    '    const settings = "not settings"',
    '    return settings',
    '  }',
    '}',
    '',
  ].join('\n')
  const out = analyzeModule('a.ts', code, parse, FIELDS)
  // Both declarations share the name `settings` within the SAME function
  // scope (this scanner does not do block-level scoping), so neither is
  // trusted — the read that a true block-scoped resolver would allow is
  // conservatively lost here, which is the documented, accepted trade-off.
  assert.equal(out.references.length, 0)
})

test('[false-positive 3] a duplicate module-level type-alias name is excluded from resolution entirely', () => {
  const { parse } = loadBabelParser()
  const code = [
    CANONICAL_IMPORT.trimEnd(),
    'type Props = { settings: GlobalSettings }',
    'type Props = { other: string }', // duplicate name, different (invalid TS, but scanner must not guess)
    'function Comp({ settings }: Props) { return settings }',
    '',
  ].join('\n')
  const out = analyzeModule('a.tsx', code, parse, FIELDS)
  assert.equal(out.references.length, 0)
})
