import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { createContext, SourceTextModule } from 'node:vm'

// Source characterization only: these tests do not mount the composed web app.
const sourceRoot = process.env.DROGON_PARITY_SOURCE_ROOT
assert.ok(sourceRoot && path.isAbsolute(sourceRoot), 'Set an absolute DROGON_PARITY_SOURCE_ROOT')
const fallbackPath = 'src/renderer/src/web/preload-api/web-fallback-api.ts'
const storagePath = 'src/renderer/src/web/preload-api/web-storage.ts'
const coalescerPath = 'src/renderer/src/components/mentu/mentu-session-request-coalescer.ts'
const expected = new Map([
  [fallbackPath, '5ed6381db73e1daff84df9fb28d34161711c2383c1e322fe14f95c743a65af6a'],
  [storagePath, '6685b487960bfcc1de233bc3b62857cb686b59b5ac7c940320e96e92e67cc867'],
  [coalescerPath, 'effbaec8dc6f9a4cd802b27a1decc87f8548e97c825ba9a477827fa4692868ef']
])
const context = createContext({})
const modules = new Map()

for (const [relativePath, digest] of expected) {
  const source = await readFile(path.join(sourceRoot, relativePath), 'utf8')
  assert.equal(createHash('sha256').update(source).digest('hex'), digest, relativePath)
  modules.set(relativePath, new SourceTextModule(stripTypeScriptTypes(source), {
    context,
    identifier: relativePath
  }))
}

const fallback = modules.get(fallbackPath)
await fallback.link((specifier, referencing) => {
  assert.equal(referencing.identifier, fallbackPath)
  assert.equal(specifier, './web-storage')
  return modules.get(storagePath)
})
await fallback.evaluate({ timeout: 1000 })
const coalescer = modules.get(coalescerPath)
await coalescer.link(() => { throw new Error('Unexpected runtime dependency') })
await coalescer.evaluate({ timeout: 1000 })

test('absent namespaces become truthy proxies instead of unavailable values', () => {
  const api = fallback.namespace.withFallback({}, [])
  assert.equal(Object.hasOwn(api, 'meetings'), false)
  assert.equal(Object.hasOwn(api, 'mentu'), false)
  assert.equal(typeof api.meetings, 'function')
  assert.equal(typeof api.mentu, 'function')
  assert.ok(api.meetings)
  assert.ok(api.mentu)
})

test('list fallback is an array, so nullish unavailable-snapshot fallback is bypassed', async () => {
  const api = fallback.namespace.withFallback({}, [])
  const unavailable = { meetings: [], availability: { status: 'unavailable' } }
  const snapshot = (await api.meetings.list({ harnessPolicy: {} })) ?? unavailable
  assert.ok(Array.isArray(snapshot))
  assert.notEqual(snapshot, unavailable)
  assert.equal(snapshot.meetings, undefined)
  // Mirrors the reviewed MeetingsPage expression, not execution of that component.
  assert.throws(() => snapshot?.meetings.length ?? 0, /length/)
})

test('actual Mentu coalescer fulfills undefined capability; its catch does not help', async () => {
  const api = fallback.namespace.withFallback({}, [])
  const result = await coalescer.namespace.discoveryRequestForScope('isolated-fallback', api.mentu, {})
  assert.equal(result.capabilityResult, undefined)
  assert.ok(Array.isArray(result.catalogResult))
  // Mirrors the reviewed loading hook expression; no React/store lifecycle is run.
  assert.throws(() => 'label' in result.capabilityResult, /in.*undefined/)
})

test('explicit unavailable API remains distinct from generic success-shaped fallbacks', async () => {
  const api = fallback.namespace.withFallback({
    mentu: {
      capability: async () => { throw new Error('fixture unavailable') },
      listRecipes: async () => { throw new Error('fixture unavailable') }
    }
  }, [])
  const result = await coalescer.namespace.discoveryRequestForScope('isolated-rejection', api.mentu, {})
  assert.equal(result.capabilityResult.status, 'unavailable')
  assert.equal(result.catalogResult, null)
})
