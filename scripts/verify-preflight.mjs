import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const lane = process.argv[2]
assert.ok(['agy', 'sonnet', 'glm'].includes(lane), 'Unknown preflight lane')
const root = new URL(`../.preflight/${lane}/`, import.meta.url)
const inputBytes = readFileSync(new URL('challenge.json', root))
const input = JSON.parse(inputBytes)
const result = JSON.parse(readFileSync(new URL('result.json', root), 'utf8'))
assert.deepEqual(result, {
  lane,
  nonce: input.nonce,
  uniqueSorted: [...new Set(input.values)].sort((a, b) => a - b),
  sum: input.values.reduce((sum, value) => sum + value, 0),
  inputSha256: createHash('sha256').update(inputBytes).digest('hex')
})
console.log(JSON.stringify({ status: 'PASSED', lane, artifact: fileURLToPath(new URL('result.json', root)) }))
