import assert from 'node:assert/strict'
import { test } from 'node:test'
import { staticBindings } from './inventory-source-skill-providers.mjs'

test('reads exported typed literal arrays without evaluating unrelated calls', () => {
  const bindings = staticBindings("const ignored = danger(); export const X: readonly string[] = ['a', 'b'] as const")
  assert.deepEqual(bindings.get('X').value, ['a', 'b'])
  assert.equal(bindings.get('X').line, 1)
})
test('resolves referenced constants and satisfies syntax', () => {
  const bindings = staticBindings("const BODY = 'text'; export const X = [{name:'a', markdown:BODY, aliases:[], enabled:true, missing:null}] satisfies unknown")
  assert.equal(bindings.get('X').value[0].markdown, 'text')
  assert.equal(bindings.get('X').value[0].missing, null)
})
test('refuses functions, computed keys and spreads', () => {
  for (const expression of ['fetch("url")', '{["a"]: 1}', '[...A]', '{...A}', '() => 1']) {
    assert.throws(() => staticBindings(`const A = []; const X = ${expression}`).get('X'))
  }
})
test('rejects cyclic and unknown references', () => {
  assert.throws(() => staticBindings('const A = B; const B = A').get('A'), /Cyclic/)
  assert.throws(() => staticBindings('const A = B').get('A'), /Unknown/)
})
test('rejects duplicate keys and preserves prototype-looking data as data', () => {
  assert.throws(() => staticBindings('const X = {a:1,a:2}').get('X'), /duplicate/)
  const { value } = staticBindings("const X = {'__proto__': 'data'}").get('X')
  assert.equal(Object.getPrototypeOf(value), null)
  assert.equal(value.__proto__, 'data')
})
test('refuses array holes rather than inventing values', () => {
  assert.throws(() => staticBindings('const X = [,1]').get('X'), /Missing/)
})
