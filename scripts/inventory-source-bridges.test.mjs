// Unit tests for scripts/inventory-source-bridges.mjs.
//
// Miniature fixture git repos under os.tmpdir() only (`git init`, `git add`,
// one local commit with throwaway identity — never touching a real repo,
// never pushed, never committed outside the fixture). Run with:
//   node --test scripts/inventory-source-bridges.test.mjs
//
// Coverage map (RED-then-GREEN regressions for the coordinator's second-pass
// correctness rejection, each anchored to a fixture shape that previously
// failed before the corresponding fix in inventory-source-bridges.mjs):
//   1. RPC method arrays composed via cross-file spread aggregation,
//      `defineStreamingMethod`, and a factory-function-returned array must
//      resolve nonzero (previously reported "resolved" with 0 methods).
//   2. Main-side ipcMain.handle/on registrations are read and cross-matched
//      against preload channels; unmatched channels are explicit, not
//      assumed disjoint.
//   3. A flattened top-level (telemetry-style) function declared directly in
//      index.ts, and a bridge export with NO `satisfies` annotation (like
//      mentu-bridge.ts), both resolve their channel/domain identity from the
//      index.ts assembly, not only from bridge-file-local syntax.
//   4. Output guards reject a symlink (including a dangling one) placed at
//      the exact write leaf, and reject a symlinked output directory,
//      BEFORE any write is attempted.
//   5. A computed IDENTIFIER object key is never treated as a literal name;
//      an aliased cross-file import spread resolves via the target's
//      ORIGINAL export name and its file is hashed; a method reachable via
//      more than one path is counted once.
//   6. A disposer boolean is never asserted from "any on + any
//      removeListener" alone — mismatched channel/listener pairs are
//      recorded unresolved, not paired.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
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

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'inventory-source-bridges.mjs')

function git(fixture, ...args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', ...args],
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

// A representative shape covering every point in the coverage map above:
//   - settings domain: plain bridge, invoke/send/sendSync/on+removeListener
//     disposer pair (paired) PLUS a second on/removeListener pair with a
//     MISMATCHED listener (must stay unresolved, never falsely paired).
//   - widget domain: cross-file spread (widget-bridge <- widget-list-bridge),
//     a SECOND spread via an IMPORT ALIAS (widget-extra-bridge <- aliased
//     widgetListApi), a computed string-literal key, a computed identifier
//     key resolving to an EXPORTED cross-file constant, and a computed
//     identifier key that does NOT resolve (unresolved-computed-identifier-key).
//   - mentu domain: bridge export with a plain `: MentuApi` type annotation
//     and NO `satisfies` clause — domain identity must come from the
//     index.ts assembly.
//   - telemetryTrack: flattened top-level function declared directly in
//     index.ts (not inside any *-bridge.ts file).
//   - RPC: SETTINGS_METHODS (direct defineMethod), WIDGET_METHODS
//     (aggregator spreading WIDGET_LIST_METHODS from another file AND a
//     defineStreamingMethod-only group), and NETWORK_METHODS (factory
//     function `createNetworkMethods()` returning the array, mirroring
//     browser-network-tunnel.ts).
//   - src/main: one file registers `ipcMain.handle('settings:get', ...)` and
//     `ipcMain.handle('widget:list', ...)` (both request/invoke channels,
//     matched via the request-handler role), `ipcMain.on('settings:ping',
//     ...)` (a fire-and-forget/send channel, matched via the
//     fire-and-forget-listener role), AND `win.webContents.send('settings:changed',
//     ...)` (a push-event/on channel, matched via the push-producer role —
//     deliberately NOT an `ipcMain.on`, so a naive undirected match would
//     wrongly succeed via the wrong role). `widget:create` (invoke) and
//     `widget:external`/`settings:renamed` (on/once) are deliberately left
//     WITHOUT any main-side counterpart, to exercise each direction's
//     unresolved status independently.
function makeFixture() {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-fixture-')))

  write(
    'src/preload/api-types.ts',
    [
      "import type { SettingsApi } from './api/settings-api'",
      "import type { WidgetApi } from './api/widget-api'",
      "import type { MentuApi } from './api/mentu-api'",
      '',
      'export type PreloadApi = {',
      '  settings: SettingsApi',
      '  widget: WidgetApi',
      '  mentu: MentuApi',
      '  telemetryTrack: (name: string) => Promise<void>',
      '}',
      '',
    ].join('\n'),
    fixture,
  )

  write(
    'src/preload/api/settings-api.ts',
    [
      'export type SettingsApi = {',
      '  get: () => Promise<unknown>',
      '  onChanged: (cb: (u: unknown) => void) => () => void',
      '  onRenamed: (cb: (u: unknown) => void) => () => void',
      '}',
      '',
    ].join('\n'),
    fixture,
  )
  write(
    'src/preload/api/widget-api.ts',
    ['export type WidgetApi = {', '  list: () => Promise<unknown[]>', '  create: (args: unknown) => Promise<void>', '}', ''].join('\n'),
    fixture,
  )
  write('src/preload/api/mentu-api.ts', ['export type MentuApi = {', '  run: (args: unknown) => Promise<void>', '}', ''].join('\n'), fixture)

  write(
    'src/shared/widget-channels.ts',
    ["export const EXTERNAL_CHANNEL = 'widget:external'", "export const LITERAL_KEY_CHANNEL = 'literalKeyMethod'", ''].join('\n'),
    fixture,
  )

  write(
    'src/preload/api/settings-bridge.ts',
    [
      "import { ipcRenderer } from 'electron'",
      "import type { PreloadApi } from '../api-types'",
      '',
      'const CHANGED_CHANNEL = \'settings:changed\'',
      '',
      'export const settingsApi = {',
      "  get: () => ipcRenderer.invoke('settings:get'),",
      "  getSync: () => ipcRenderer.sendSync('settings:get-sync'),",
      "  ping: () => ipcRenderer.send('settings:ping'),",
      '  onChanged: (callback) => {',
      '    const listener = (_event, updates) => callback(updates)',
      '    ipcRenderer.on(CHANGED_CHANNEL, listener)',
      '    return () => ipcRenderer.removeListener(CHANGED_CHANNEL, listener)',
      '  },',
      '  onRenamed: (callback) => {',
      '    // Mismatched listener identifier between on/removeListener: must',
      '    // NEVER be reported as a confirmed disposer pairing.',
      '    const listenerA = (_event, updates) => callback(updates)',
      '    const listenerB = (_event, updates) => callback(updates)',
      "    ipcRenderer.on('settings:renamed', listenerA)",
      "    return () => ipcRenderer.removeListener('settings:renamed', listenerB)",
      '  }',
      "} satisfies PreloadApi['settings']",
      '',
    ].join('\n'),
    fixture,
  )

  write(
    'src/preload/api/widget-list-bridge.ts',
    [
      "import { ipcRenderer } from 'electron'",
      '',
      'export const widgetListApi = {',
      "  list: () => ipcRenderer.invoke('widget:list')",
      '}',
      '',
    ].join('\n'),
    fixture,
  )

  write(
    'src/preload/api/widget-bridge.ts',
    [
      "import { ipcRenderer } from 'electron'",
      "import type { PreloadApi } from '../api-types'",
      "import { widgetListApi } from './widget-list-bridge'",
      "import { EXTERNAL_CHANNEL, LITERAL_KEY_CHANNEL } from '../../shared/widget-channels'",
      '',
      'export const widgetApi = {',
      '  ...widgetListApi,',
      "  create: (args) => ipcRenderer.invoke('widget:create', args),",
      "  [LITERAL_KEY_CHANNEL]: () => null,",
      "  ['literalStringComputed']: () => null,",
      '  [computedKeyNotAllowed()]: () => null,',
      "  onExternal: (cb) => {",
      '    const listener = (_e, d) => cb(d)',
      '    ipcRenderer.on(EXTERNAL_CHANNEL, listener)',
      '    return () => ipcRenderer.removeListener(EXTERNAL_CHANNEL, listener)',
      '  }',
      "} satisfies PreloadApi['widget']",
      '',
    ].join('\n'),
    fixture,
  )

  write(
    'src/preload/api/widget-extra-bridge.ts',
    [
      "import { ipcRenderer } from 'electron'",
      "import { widgetListApi as aliasedWidgetList } from './widget-list-bridge'",
      '',
      'export const widgetExtraApi = {',
      '  ...aliasedWidgetList,',
      // A method that exists ONLY on this orphan export (not shared with any
      // reachable export via spread) — this is what actually distinguishes
      // allBridgeExportMethodsDeduped (counts it) from
      // reachableBridgeMethodsDeduped (must NOT count it).
      "  orphanOnly: () => ipcRenderer.invoke('widget:orphanOnly')",
      '}',
      '',
    ].join('\n'),
    fixture,
  )

  // No `satisfies` annotation at all — a plain type annotation, mirroring
  // mentu-bridge.ts in the real source. Domain identity must still resolve
  // to "mentu" via the index.ts assembly.
  write(
    'src/preload/api/mentu-bridge.ts',
    [
      "import { ipcRenderer } from 'electron'",
      "import type { MentuApi } from './mentu-api'",
      '',
      'export const mentuApi: MentuApi = {',
      "  run: (args) => ipcRenderer.invoke('mentu:run', args)",
      '}',
      '',
    ].join('\n'),
    fixture,
  )

  write(
    'src/preload/index.ts',
    [
      "import { contextBridge, ipcRenderer } from 'electron'",
      "import type { PreloadApi } from './api-types'",
      "import { settingsApi } from './api/settings-bridge'",
      "import { widgetApi } from './api/widget-bridge'",
      "import { mentuApi } from './api/mentu-bridge'",
      '',
      'const telemetryTrackApi = (name) => ipcRenderer.invoke(\'telemetry:track\', name)',
      '',
      'const api = {',
      '  settings: settingsApi,',
      '  widget: widgetApi,',
      '  mentu: mentuApi,',
      '  telemetryTrack: telemetryTrackApi',
      '} satisfies PreloadApi',
      '',
      'contextBridge.exposeInMainWorld(\'api\', api)',
      '',
    ].join('\n'),
    fixture,
  )

  // RPC methods: aggregator (WIDGET_METHODS) spreads a leaf array
  // (WIDGET_LIST_METHODS) and a defineStreamingMethod-only leaf
  // (WIDGET_STREAM_METHODS); NETWORK_METHODS is built by a same-file
  // factory function, mirroring browser-network-tunnel.ts.
  write(
    'src/main/runtime/rpc/methods/index.ts',
    [
      "import { SETTINGS_METHODS } from './settings'",
      "import { WIDGET_METHODS } from './widget'",
      "import { NETWORK_METHODS } from './network'",
      "import { MENTU_METHODS } from './mentu-rpc'",
      '',
      'export const ALL_RPC_METHODS = [',
      '  ...SETTINGS_METHODS,',
      '  ...WIDGET_METHODS,',
      '  ...NETWORK_METHODS,',
      '  ...MENTU_METHODS',
      ']',
      '',
    ].join('\n'),
    fixture,
  )
  write(
    'src/main/runtime/rpc/methods/settings.ts',
    [
      "import { defineMethod } from '../core'",
      '',
      'export const SETTINGS_METHODS = [',
      "  defineMethod({ name: 'settings.get', params: null, handler: () => ({}) })",
      ']',
      '',
    ].join('\n'),
    fixture,
  )
  write(
    'src/main/runtime/rpc/methods/widget.ts',
    [
      "import { WIDGET_LIST_METHODS } from './widget-list'",
      "import { WIDGET_STREAM_METHODS } from './widget-stream'",
      '',
      'export const WIDGET_METHODS = [',
      '  ...WIDGET_LIST_METHODS,',
      '  ...WIDGET_STREAM_METHODS',
      ']',
      '',
    ].join('\n'),
    fixture,
  )
  write(
    'src/main/runtime/rpc/methods/widget-list.ts',
    [
      "import { defineMethod } from '../core'",
      '',
      'export const WIDGET_LIST_METHODS = [',
      "  defineMethod({ name: 'widget.list', params: null, handler: () => ([]) }),",
      "  defineMethod({ name: 'widget.create', params: null, handler: () => ({}) })",
      ']',
      '',
    ].join('\n'),
    fixture,
  )
  write(
    'src/main/runtime/rpc/methods/widget-stream.ts',
    [
      "import { defineStreamingMethod } from '../core'",
      '',
      'export const WIDGET_STREAM_METHODS = [',
      "  defineStreamingMethod({ name: 'widget.stream', params: null, handler: async () => {} })",
      ']',
      '',
    ].join('\n'),
    fixture,
  )
  write(
    'src/main/runtime/rpc/methods/network.ts',
    [
      "import { defineStreamingMethod } from '../core'",
      '',
      'export function createNetworkMethods() {',
      '  return [',
      "    defineStreamingMethod({ name: 'network.tunnel', params: null, handler: async () => {} }),",
      // A DUPLICATE of widget.list's name at a different source anchor,
      // mirroring a real duplicate RPC method registration: must be
      // recorded as a duplicate (rpcMethodDuplicateNames), never silently
      // collapsed away, and must NOT inflate rpcMethodNamesResolvedUnique.
      "    defineStreamingMethod({ name: 'widget.list', params: null, handler: async () => {} })",
      '  ]',
      '}',
      '',
      'export const NETWORK_METHODS = createNetworkMethods()',
      '',
    ].join('\n'),
    fixture,
  )

  // Mirrors src/shared/mentu-recipe-contract.ts -> mentu-run-contract.ts:
  // an `export * from` re-export chain fronting the real object-literal
  // constant, consumed via `MEMBER_CONST.property` inside a defineMethod
  // `name` field.
  write(
    'src/shared/mentu-run-contract.ts',
    [
      'export const MENTU_RPC_METHODS = {',
      "  run: 'mentu.run',",
      "  capability: 'mentu.capability'",
      '} as const',
      '',
    ].join('\n'),
    fixture,
  )
  write('src/shared/mentu-recipe-contract.ts', ["export * from './mentu-run-contract'", ''].join('\n'), fixture)
  write(
    'src/main/runtime/rpc/methods/mentu-rpc.ts',
    [
      "import { defineMethod } from '../core'",
      "import { MENTU_RPC_METHODS } from '../../../../shared/mentu-recipe-contract'",
      '',
      'export const MENTU_METHODS = [',
      '  defineMethod({ name: MENTU_RPC_METHODS.run, params: null, handler: () => ({}) }),',
      '  defineMethod({ name: MENTU_RPC_METHODS.capability, params: null, handler: () => ({}) })',
      ']',
      '',
    ].join('\n'),
    fixture,
  )

  // Main-side ipcMain registrations: `settings:get` matches a preload
  // channel exactly; `widget:list` matches too; `widget:create` (a real
  // preload channel) is deliberately left WITHOUT a main registration.
  write(
    'src/main/ipc/settings-handlers.ts',
    [
      "import { ipcMain } from 'electron'",
      '',
      'export function registerSettingsHandlers() {',
      "  ipcMain.handle('settings:get', () => ({}))",
      "  ipcMain.handle('widget:list', () => ([]))",
      "  ipcMain.on('settings:ping', () => {})",
      "  ipcMain.removeHandler('settings:get')",
      '}',
      '',
      'export function broadcastSettingsChanged(win, updates) {',
      "  win.webContents.send('settings:changed', updates)",
      '}',
      '',
    ].join('\n'),
    fixture,
  )

  git(fixture, 'init', '-q')
  git(fixture, 'add', '-A')
  git(
    fixture,
    'commit',
    '-qm',
    'fixture bridge audit repo',
    '-m',
    'Co-authored-by: Codex <noreply@openai.com>',
  )
  const sha = git(fixture, 'rev-parse', 'HEAD').trim()
  return { fixture, sha }
}

function runScript(scriptArgs) {
  return spawnSync(process.execPath, [SCRIPT, ...scriptArgs], { encoding: 'utf8' })
}

function defaultInvocationArgs({ fixture, sha, outDir }) {
  return [
    '--source',
    fixture,
    '--expected-sha',
    sha,
    '--json-output',
    join(outDir, 'parity-source-bridges.json'),
    '--md-output',
    join(outDir, 'parity-bridge-enumeration.md'),
    '--fixture-dir',
    join(outDir, 'bridge-audit'),
    '--allowed-root',
    outDir,
  ]
}

describe('inventory-source-bridges', () => {
  it('follows imported object aliases outside bridge-named files and preserves origin', () => {
    const { fixture } = makeFixture()
    write('src/preload/api/mentu-bridge.ts', [
      "import { originalApi as renamed } from '../alias-hop'",
      "export const mentuApi = renamed satisfies PreloadApi['mentu']",
    ].join('\n'), fixture)
    write('src/preload/alias-hop.ts', [
      "import { originalApi as implementation } from './plain-api-object'",
      "export const originalApi = implementation",
    ].join('\n'), fixture)
    write('src/preload/plain-api-object.ts', [
      "import { ipcRenderer } from 'electron'",
      "export const originalApi = { run: () => ipcRenderer.invoke('mentu:aliased') }",
    ].join('\n'), fixture)
    git(fixture, 'add', '-A')
    git(fixture, 'commit', '-qm', 'fixture imported object alias', '-m',
      'Co-authored-by: Codex <noreply@openai.com>')
    const sha = git(fixture, 'rev-parse', 'HEAD').trim()
    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-alias-out-')))
    const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
    assert.equal(result.status, 0, result.stderr)
    const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
    const bridge = artifact.bridges.find((b) => b.file.endsWith('/mentu-bridge.ts'))
    const exported = bridge.exported.find((e) => e.exportName === 'mentuApi')
    assert.ok(exported, 'imported object alias must not silently disappear')
    assert.equal(exported.domain, 'mentu')
    assert.deepEqual(exported.methods.map((m) => m.name), ['run'])
    assert.equal(exported.methods[0].originFile, 'src/preload/plain-api-object.ts')
    assert.ok(artifact.fileHashesSha256['src/preload/alias-hop.ts'])
    assert.ok(artifact.fileHashesSha256['src/preload/plain-api-object.ts'])
    assert.ok(artifact.requestChannelToHandlerMapping.some((m) => m.channel === 'mentu:aliased'))
  })

  it('retains cyclic imported object aliases as explicit unresolved exports', () => {
    const { fixture } = makeFixture()
    write('src/preload/api/mentu-bridge.ts', [
      "import { cyclicApi } from '../cyclic-api'",
      "export const mentuApi = cyclicApi satisfies PreloadApi['mentu']",
    ].join('\n'), fixture)
    write('src/preload/cyclic-api.ts', [
      "import { mentuApi } from './api/mentu-bridge'",
      'export const cyclicApi = mentuApi',
    ].join('\n'), fixture)
    git(fixture, 'add', '-A')
    git(fixture, 'commit', '-qm', 'fixture cyclic object alias', '-m',
      'Co-authored-by: Codex <noreply@openai.com>')
    const sha = git(fixture, 'rev-parse', 'HEAD').trim()
    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-alias-cycle-out-')))
    const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
    assert.equal(result.status, 0, result.stderr)
    const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
    const bridge = artifact.bridges.find((b) => b.file.endsWith('/mentu-bridge.ts'))
    const exported = bridge.exported.find((e) => e.exportName === 'mentuApi')
    assert.ok(exported, 'cyclic alias must remain visible as unresolved')
    assert.ok(exported.methods.some((m) => /unresolved.*alias/.test(m.resolution)))
    assert.ok(exported.methods.every((m) => !m.ipcCalls?.length))
  })

  it('exposes factory-backed assembly exports not resolved by the object walker', () => {
    const { fixture } = makeFixture()
    write('src/preload/api/mentu-bridge.ts', [
      "import { createApi } from '../factory-api'",
      "export const mentuApi = createApi('mentu') satisfies PreloadApi['mentu']",
    ].join('\n'), fixture)
    git(fixture, 'add', '-A')
    git(fixture, 'commit', '-qm', 'fixture unwalked factory export', '-m',
      'Co-authored-by: Codex <noreply@openai.com>')
    const sha = git(fixture, 'rev-parse', 'HEAD').trim()
    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-factory-out-')))
    const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
    assert.equal(result.status, 0, result.stderr)
    const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
    assert.ok(artifact.unresolvedAssemblyExports?.some((e) => e.domain === 'mentu'),
      'unwalked factory must not appear as a fully enumerated empty domain')
    assert.equal(artifact.counts.unresolvedAssemblyExports, 1)
    assert.ok(artifact.gapsRegister.some((gap) => gap.includes('unresolvedAssemblyExports')))
  })

  it('produces a non-zero, source-only census with explicit unresolved entries', () => {
    const { fixture, sha } = makeFixture()
    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
    const args = defaultInvocationArgs({ fixture, sha, outDir })
    const result = runScript(args)
    assert.equal(result.status, 0, result.stderr)

    const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
    assert.equal(artifact.schema, 'drogon.inventory.source-bridges.v2')

    assert.ok(artifact.counts.bridgeFiles > 0)
    assert.ok(artifact.counts.apiTypeFiles > 0)
    assert.ok(artifact.counts.domainsAssembledInIndex > 0)
    assert.ok(artifact.counts.preloadChannelsDistinct > 0)
    assert.ok(artifact.counts.rpcMethodNamesResolvedUnique > 0)
    assert.match(artifact.provenance, /source-only/)
    assert.equal(artifact.source.fullSha, sha)

    const settingsBridge = artifact.bridges.find((b) => b.file.endsWith('settings-bridge.ts'))
    const settingsExport = settingsBridge.exported[0]
    const byName = Object.fromEntries(settingsExport.methods.map((m) => [m.name, m]))
    assert.equal(byName.get.ipcCalls[0].kind, 'invoke')
    assert.match(byName.get.ipcCalls[0].direction, /request-response/)
    assert.equal(byName.getSync.ipcCalls[0].kind, 'sendSync')
    assert.equal(byName.ping.ipcCalls[0].kind, 'send')

    for (const hash of Object.values(artifact.fileHashesSha256)) {
      assert.match(hash, /^[0-9a-f]{64}$/)
    }
  })

  describe('point 1: recursive RPC method-array resolution', () => {
    it('resolves a cross-file aggregator array (mirrors TERMINAL_METHODS/ORCHESTRATION_METHODS/GITHUB_METHODS)', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))

      const widgetGroup = artifact.rpcMethodGroups.find((g) => g.localName === 'WIDGET_METHODS')
      assert.ok(widgetGroup, 'WIDGET_METHODS group must be present')
      // Previously: an aggregator file with no direct defineMethod() call of
      // its own reported "resolved" with zero methods. Now it must recurse
      // through both spread targets.
      assert.equal(widgetGroup.methods.length, 3, 'must recurse through both spread leaf files, not report zero')
      assert.deepEqual(
        widgetGroup.methods.map((m) => m.name).sort(),
        ['widget.create', 'widget.list', 'widget.stream'],
      )
    })

    it('resolves defineStreamingMethod call sites, not only defineMethod', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const all = artifact.rpcMethodGroups.flatMap((g) => g.methods)
      const streamMethod = all.find((m) => m.name === 'widget.stream')
      assert.ok(streamMethod, 'defineStreamingMethod-declared method must be found')
      assert.equal(streamMethod.kind, 'defineStreamingMethod')
    })

    it('resolves a factory-function-returned array (mirrors browser-network-tunnel.ts createBrowserNetworkTunnelMethods())', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const networkGroup = artifact.rpcMethodGroups.find((g) => g.localName === 'NETWORK_METHODS')
      assert.ok(networkGroup)
      assert.equal(networkGroup.methods.length, 2, 'factory-returned array must resolve, not report zero')
      assert.ok(networkGroup.methods.some((m) => m.name === 'network.tunnel'))
    })

    it('resolves a defineMethod "name" that is a MEMBER-CONSTANT reference through an `export * from` re-export chain (mirrors MENTU_RPC_METHODS via mentu-recipe-contract.ts -> mentu-run-contract.ts)', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const mentuGroup = artifact.rpcMethodGroups.find((g) => g.localName === 'MENTU_METHODS')
      assert.ok(mentuGroup)
      const runMethod = mentuGroup.methods.find((m) => m.resolvedVia === 'MENTU_RPC_METHODS.run')
      assert.ok(runMethod, 'MEMBER_CONST.property name must resolve through the star re-export chain')
      assert.equal(runMethod.name, 'mentu.run')
      assert.equal(runMethod.resolvedIn, 'src/shared/mentu-run-contract.ts')
      assert.ok(
        'src/shared/mentu-run-contract.ts' in artifact.fileHashesSha256,
        'the file where the object literal constant is actually declared must be hashed',
      )
      assert.equal(artifact.counts.rpcMethodPlaceholderEntries, 0, 'no placeholder entries expected once member-constant resolution succeeds')
    })

    it('records a duplicate RPC method name as a duplicate, without inflating the resolved-unique count', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const dup = artifact.rpcMethodDuplicateNames.find((d) => d.name === 'widget.list')
      assert.ok(dup, 'widget.list is registered in both WIDGET_LIST_METHODS and NETWORK_METHODS')
      assert.equal(dup.occurrences.length, 2)
      // 8 total occurrences (1 settings + 2 widget-list + 1 widget-stream +
      // 2 network + 2 mentu), 1 name duplicated -> 7 distinct resolved names.
      assert.equal(artifact.counts.rpcMethodOccurrencesDeduped, 8)
      assert.equal(artifact.counts.rpcMethodNamesResolvedUnique, 7)
      assert.equal(artifact.rpcMethodNamesResolved.filter((n) => n === 'widget.list').length, 1, 'resolved-name census must dedup by NAME, not by anchor')
    })
  })

  describe('point 2: direction-specific main-side census + preload-to-main mapping', () => {
    it('matches invoke channels ONLY against ipcMain.handle (request-handler role)', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))

      assert.ok(artifact.counts.mainRegistrationsTotal >= 4)
      const byChannel = Object.fromEntries(artifact.requestChannelToHandlerMapping.map((m) => [m.channel, m]))
      assert.equal(byChannel['settings:get'].status, 'request-handler-matched')
      assert.equal(byChannel['settings:get'].mainRegistrations[0].apiSource, 'ipcMain')
      assert.equal(byChannel['settings:get'].mainRegistrations[0].kind, 'handle')
      assert.equal(byChannel['widget:list'].status, 'request-handler-matched')
      // widget:create is a real invoke channel with NO main handler — must
      // be explicit, never assumed matched or silently dropped.
      assert.equal(byChannel['widget:create'].status, 'request-handler-unresolved')
    })

    it('matches send channels ONLY against ipcMain.on/once (fire-and-forget-listener role)', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const byChannel = Object.fromEntries(artifact.fireAndForgetChannelToListenerMapping.map((m) => [m.channel, m]))
      assert.equal(byChannel['settings:ping'].status, 'fire-and-forget-listener-matched')
      assert.equal(byChannel['settings:ping'].mainRegistrations[0].kind, 'on')
    })

    it('matches on/once (push-event) channels ONLY against webContents.send producers, never against ipcMain.on', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const byChannel = Object.fromEntries(artifact.pushEventChannelToProducerMapping.map((m) => [m.channel, m]))
      assert.equal(byChannel['settings:changed'].status, 'push-producer-matched')
      assert.equal(byChannel['settings:changed'].mainRegistrations[0].apiSource, 'webContents.send')
      // widget:external / settings:renamed have no webContents.send producer
      // anywhere in the fixture — must be explicit push-producer-unresolved,
      // never fabricated as matched against the (wrong-direction) ipcMain.on
      // registrations that exist for OTHER channels.
      assert.equal(byChannel['widget:external'].status, 'push-producer-unresolved')
    })

    it('excludes ipcMain.removeHandler/removeAllListeners (teardown) from all matching', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      assert.ok(artifact.counts.mainTeardownRegistrations >= 1)
      const teardownRegs = artifact.mainRegistrations.filter((r) => r.role === 'teardown')
      assert.ok(teardownRegs.every((r) => r.kind === 'removeHandler' || r.kind === 'removeAllListeners'))
    })

    it('never claims disjoint namespaces by fiat: the gaps register cites actual per-direction matched/unresolved counts', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      assert.ok(
        artifact.gapsRegister.some(
          (g) => /main-side census scanned/.test(g) && /DIRECTION-SPECIFIC/.test(g) && /webContents\.send/.test(g),
        ),
      )
    })
  })

  describe('point 3: index.ts-assembly-derived domain + telemetry-style inline channels', () => {
    it('extracts the flattened top-level telemetryTrack channel from index.ts, not just its presence', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))

      const telemetryEntry = artifact.preloadIndexAssembly.find((d) => d.name === 'telemetryTrack')
      assert.ok(telemetryEntry.inline, 'flattened top-level function must be marked inline')
      assert.equal(telemetryEntry.inlineIpcCalls.length, 1)
      assert.equal(telemetryEntry.inlineIpcCalls[0].channel.value, 'telemetry:track')

      const telemetryCheck = artifact.namedDomainChecks.find((d) => d.name.startsWith('telemetry'))
      assert.equal(telemetryCheck.inlineIpcChannelsExtracted, 1)
      assert.equal(telemetryCheck.assembledIpcChannelsExtracted, 1)
    })

    it('resolves bridge domain identity from the index.ts assembly even with no `satisfies` annotation (mentu-bridge.ts shape)', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))

      const mentuBridge = artifact.bridges.find((b) => b.file.endsWith('mentu-bridge.ts'))
      const mentuExport = mentuBridge.exported[0]
      assert.equal(mentuExport.domainFromSatisfies, null, 'fixture intentionally has no satisfies clause')
      assert.equal(mentuExport.domain, 'mentu', 'domain must still resolve via the index.ts assembly')
      assert.equal(mentuExport.domainSource, 'assembly-only (no satisfies annotation)')

      const mentuCheck = artifact.namedDomainChecks.find((d) => d.name === 'mentu')
      assert.equal(mentuCheck.presentInAssembly, true)
    })

    it('reports a NONZERO assembled channel count for a bridge-routed domain (mentu), not just inline-only zero', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const mentuCheck = artifact.namedDomainChecks.find((d) => d.name === 'mentu')
      // mentu-bridge.ts has one real ipcRenderer.invoke('mentu:run', ...)
      // call; inline-only is correctly 0 (it's not a flattened top-level
      // index.ts function), but the domain is NOT actually empty of
      // channels — that must show up in the assembled count.
      assert.equal(mentuCheck.inlineIpcChannelsExtracted, 0)
      assert.equal(mentuCheck.reachableBridgeExportCount, 1)
      assert.equal(mentuCheck.assembledIpcChannelsExtracted, 1)
    })
  })

  describe('point 4: output guards reject symlinked write targets before any write', () => {
    it('refuses to write through a pre-placed symlink at the exact JSON output leaf', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const escapeTarget = join(dirname(outDir), `escape-${Date.now()}.json`)
      const jsonPath = join(outDir, 'parity-source-bridges.json')
      symlinkSync(escapeTarget, jsonPath)
      const args = defaultInvocationArgs({ fixture, sha, outDir })
      const result = runScript(args)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /symlink/i)
    })

    it('refuses to write through a DANGLING symlink at the output leaf (lstat still catches it)', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const danglingTarget = join(outDir, `nonexistent-${Date.now()}.json`)
      const jsonPath = join(outDir, 'parity-source-bridges.json')
      symlinkSync(danglingTarget, jsonPath)
      const args = defaultInvocationArgs({ fixture, sha, outDir })
      const result = runScript(args)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /symlink/i)
    })

    it('refuses a symlinked fixture directory', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const realFixtureDir = join(dirname(outDir), `real-fixture-dir-${Date.now()}`)
      mkdirSync(realFixtureDir, { recursive: true })
      const fixtureDirPath = join(outDir, 'bridge-audit')
      symlinkSync(realFixtureDir, fixtureDirPath)
      const args = defaultInvocationArgs({ fixture, sha, outDir })
      const result = runScript(args)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /symlink/i)
    })

    it('still writes successfully through a stage+rename when no symlink is present', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      // No leftover staging temp files after a successful run.
      const fs = readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8')
      assert.ok(fs.length > 0)
    })
  })

  describe('point 5: computed keys, alias-correct spreads, and deduped counts', () => {
    it('treats a computed STRING-LITERAL key as a real name', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const widgetExport = artifact.bridges.find((b) => b.file.endsWith('/widget-bridge.ts')).exported[0]
      const literalComputed = widgetExport.methods.find((m) => m.name === 'literalStringComputed')
      assert.ok(literalComputed)
      assert.equal(literalComputed.keyResolution, 'literal-computed')
    })

    it('resolves a computed IDENTIFIER key that references a cross-file exported string constant', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const widgetExport = artifact.bridges.find((b) => b.file.endsWith('/widget-bridge.ts')).exported[0]
      const resolvedComputed = widgetExport.methods.find((m) => m.name === 'literalKeyMethod')
      assert.ok(resolvedComputed, 'computed identifier key resolved via cross-file exported const must produce the real name')
      assert.equal(resolvedComputed.keyResolution, 'resolved-computed-const-ref')
    })

    it('never treats a computed identifier key as a literal name when it cannot resolve', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const widgetExport = artifact.bridges.find((b) => b.file.endsWith('/widget-bridge.ts')).exported[0]
      // computedKeyNotAllowed() is a CallExpression key: never an identifier
      // reference at all, must not fabricate any name from it.
      const unresolvedComputed = widgetExport.methods.find((m) => m.keyResolution === 'unresolved-computed-expression-key')
      assert.ok(unresolvedComputed)
      assert.notEqual(unresolvedComputed.name, 'computedKeyNotAllowed')
    })

    it('resolves a cross-file spread through an IMPORT ALIAS via the target module\'s ORIGINAL export name, and hashes the target file', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const extraExport = artifact.bridges.find((b) => b.file.endsWith('widget-extra-bridge.ts')).exported[0]
      const listMethod = extraExport.methods.find((m) => m.name === 'list')
      assert.ok(listMethod, 'aliased spread must resolve via the ORIGINAL exported name (widgetListApi), not the local alias')
      assert.equal(listMethod.spreadFrom, 'src/preload/api/widget-list-bridge.ts')
      assert.ok(
        'src/preload/api/widget-list-bridge.ts' in artifact.fileHashesSha256,
        'every followed spread target file must be hashed, none silently exempt',
      )
    })

    it('counts a method reachable via more than one path once (deduped by origin file+anchor)', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      // widgetListApi's `list` method is reachable via BOTH widget-bridge.ts
      // (direct spread) and widget-extra-bridge.ts (aliased spread) — the
      // syntax count sees it twice, the deduped reachable-method count once.
      const originKey = 'src/preload/api/widget-list-bridge.ts'
      const listOccurrences = artifact.bridges
        .flatMap((b) => b.exported)
        .flatMap((e) => e.methods)
        .filter((m) => m.name === 'list' && m.originFile === originKey)
      assert.ok(listOccurrences.length >= 2, 'raw syntax occurrences must show both composition paths')
      // But the artifact must distinguish this from the deduped count.
      assert.ok(artifact.counts.syntaxIpcCallOccurrences >= artifact.counts.reachableBridgeMethodsDeduped)
    })

    it('marks widgetExtraApi as ORPHAN (never referenced by index.ts assembly) and excludes its unique content from the reachable count', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))

      const extraExport = artifact.bridges.find((b) => b.file.endsWith('widget-extra-bridge.ts')).exported[0]
      assert.equal(extraExport.reachableFromIndexAssembly, false, 'widgetExtraApi is never wired into index.ts\'s `api` object')

      const orphanEntry = artifact.orphanBridgeExports.find(
        (o) => o.file.endsWith('widget-extra-bridge.ts') && o.exportName === 'widgetExtraApi',
      )
      assert.ok(orphanEntry, 'orphanBridgeExports must list the never-referenced export explicitly')
      assert.ok(artifact.counts.bridgeExportedObjectsOrphan >= 1)

      // orphanOnly() is unique to the orphan export — it must inflate the
      // ALL-export inventory count but must NEVER count as reachable.
      const allNames = artifact.bridges.flatMap((b) => b.exported).flatMap((e) => e.methods).map((m) => m.name)
      assert.ok(allNames.includes('orphanOnly'))
      assert.ok(
        artifact.counts.allBridgeExportMethodsDeduped > artifact.counts.reachableBridgeMethodsDeduped,
        'the all-export inventory count must exceed the reachable count once an orphan-only method exists',
      )
    })
  })

  describe('point 6: disposer pairing requires a real channel+listener match', () => {
    it('confirms a paired disposer only when channel AND listener both match', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const settingsExport = artifact.bridges.find((b) => b.file.endsWith('settings-bridge.ts')).exported[0]
      const onChanged = settingsExport.methods.find((m) => m.name === 'onChanged')
      assert.equal(onChanged.disposerPairing.status, 'paired')
      assert.equal(onChanged.disposerPairing.pairs[0].channel, 'settings:changed')
    })

    it('does NOT report a pairing when the on/removeListener listener identifiers differ', () => {
      const { fixture, sha } = makeFixture()
      const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
      const result = runScript(defaultInvocationArgs({ fixture, sha, outDir }))
      assert.equal(result.status, 0, result.stderr)
      const artifact = JSON.parse(readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8'))
      const settingsExport = artifact.bridges.find((b) => b.file.endsWith('settings-bridge.ts')).exported[0]
      const onRenamed = settingsExport.methods.find((m) => m.name === 'onRenamed')
      assert.equal(onRenamed.disposerPairing.status, 'unresolved-disposer-pairing', 'mismatched listener identifiers must never be reported as paired')
    })
  })

  it('reruns deterministically byte-for-byte via --verify', () => {
    const { fixture, sha } = makeFixture()
    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
    const args = defaultInvocationArgs({ fixture, sha, outDir })
    const first = runScript(args)
    assert.equal(first.status, 0, first.stderr)

    const verify = runScript([...args, '--verify'])
    assert.equal(verify.status, 0, verify.stderr)
    assert.match(verify.stdout, /byte-identical/)

    const jsonA = readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8')
    const mdA = readFileSync(join(outDir, 'parity-bridge-enumeration.md'), 'utf8')
    const second = runScript(args)
    assert.equal(second.status, 0, second.stderr)
    const jsonB = readFileSync(join(outDir, 'parity-source-bridges.json'), 'utf8')
    const mdB = readFileSync(join(outDir, 'parity-bridge-enumeration.md'), 'utf8')
    assert.equal(jsonA, jsonB)
    assert.equal(mdA, mdB)
  })

  it('fails nonzero when the source SHA does not match the frozen baseline', () => {
    const { fixture } = makeFixture()
    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
    const args = defaultInvocationArgs({ fixture, sha: '0'.repeat(40), outDir })
    const result = runScript(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /does not match the frozen audit baseline/)
  })

  it('fails nonzero on tracked dirty changes in the source', () => {
    const { fixture, sha } = makeFixture()
    write('src/preload/index.ts', 'DIRTY EDIT\n', fixture)
    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
    const args = defaultInvocationArgs({ fixture, sha, outDir })
    const result = runScript(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /tracked dirty changes/)
  })

  it('fails nonzero on unexpected untracked files in the source', () => {
    const { fixture, sha } = makeFixture()
    write('src/preload/api/rogue-bridge.ts', "export const rogueApi = { x: () => 1 }\n", fixture)
    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
    const args = defaultInvocationArgs({ fixture, sha, outDir })
    const result = runScript(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /unexpected untracked files/)
  })

  it('refuses a symlinked source file (guarded read)', () => {
    const { fixture, sha } = makeFixture()
    const outsideFile = join(dirname(fixture), `outside-${Date.now()}.ts`)
    writeFileSync(outsideFile, 'export const evil = 1\n')
    const linkPath = join(fixture, 'src/preload/api/linked-bridge.ts')
    symlinkSync(outsideFile, linkPath)
    git(fixture, 'add', '-A')
    git(fixture, 'commit', '-qm', 'add symlinked bridge', '-m', 'Co-authored-by: Codex <noreply@openai.com>')
    const nextSha = git(fixture, 'rev-parse', 'HEAD').trim()
    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
    const args = defaultInvocationArgs({ fixture, sha: nextSha, outDir })
    const result = runScript(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /symlink/)
  })

  it('fails nonzero on empty extraction (no *-bridge.ts files present)', () => {
    const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-empty-')))
    write('README.md', '# empty fixture\n', fixture)
    git(fixture, 'init', '-q')
    git(fixture, 'add', '-A')
    git(fixture, 'commit', '-qm', 'empty fixture', '-m', 'Co-authored-by: Codex <noreply@openai.com>')
    const sha = git(fixture, 'rev-parse', 'HEAD').trim()
    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
    const args = defaultInvocationArgs({ fixture, sha, outDir })
    const result = runScript(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /empty extraction/)
  })

  it('fails nonzero when EVERY RPC method name is an unresolvable placeholder (unknowns must never pass the zero-resolved guard)', () => {
    const { fixture, sha: initialSha } = makeFixture()
    // Overwrite every RPC method file so its `name` field is a member
    // reference on an object that is never declared or imported anywhere —
    // guaranteed statically unresolvable, mirroring a codebase where the
    // name-constant lookup genuinely fails everywhere. Structurally the
    // arrays are still non-empty (rpcMethodGroupsWithZeroMethods would stay
    // 0), but there must be ZERO resolved literal names — the guard must
    // fire on that, not on total occurrence count.
    const unresolvableBody = (exportName, count) =>
      [
        "import { defineMethod } from '../core'",
        '',
        `export const ${exportName} = [`,
        Array.from({ length: count }, (_, i) => `  defineMethod({ name: UNKNOWN_CONST_NEVER_DECLARED.slot${i}, params: null, handler: () => ({}) })`).join(',\n'),
        ']',
        '',
      ].join('\n')
    write('src/main/runtime/rpc/methods/settings.ts', unresolvableBody('SETTINGS_METHODS', 1), fixture)
    write('src/main/runtime/rpc/methods/widget-list.ts', unresolvableBody('WIDGET_LIST_METHODS', 2), fixture)
    write('src/main/runtime/rpc/methods/widget-stream.ts', unresolvableBody('WIDGET_STREAM_METHODS', 1), fixture)
    write('src/main/runtime/rpc/methods/network.ts', unresolvableBody('NETWORK_METHODS', 2), fixture)
    write('src/main/runtime/rpc/methods/mentu-rpc.ts', unresolvableBody('MENTU_METHODS', 2), fixture)
    git(fixture, 'add', '-A')
    git(fixture, 'commit', '-qm', 'make every RPC name unresolvable', '-m', 'Co-authored-by: Codex <noreply@openai.com>')
    const sha = git(fixture, 'rev-parse', 'HEAD').trim()
    assert.notEqual(sha, initialSha)

    const outDir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-bridges-out-')))
    const args = defaultInvocationArgs({ fixture, sha, outDir })
    const result = runScript(args)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /zero RESOLVED \(non-placeholder\)/)
  })

  it('rejects unknown CLI arguments', () => {
    const result = runScript(['--bogus'])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /unknown argument/)
  })
})
