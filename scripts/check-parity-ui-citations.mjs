import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(process.argv[2] ?? '/Users/carlos/Documents/Drogon-mentu-session')
assert.equal(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), 'c97906287bb7a390b25e2025b600d9fb3c25d9c3')
assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(), '')
function read(file) {
  assert(!path.isAbsolute(file) && !file.split(/[\\/]/).includes('..'), 'Unsafe source path')
  return readFileSync(path.join(root, file))
}
const results = []
for (const name of ['parity-ui-capability-cards', 'parity-ui-remaining-surface-cards']) {
  const doc = JSON.parse(readFileSync(path.join(repo, `docs/migration/${name}.json`)))
  assert.equal(doc.cards.length, doc.counts.cardsTotal)
  let paths = 0, titles = 0, hashes = 0, unquotedPathOnlyNotes = 0
  for (const card of doc.cards) {
    for (const source of card.entrypoint?.sourceHashes ?? []) {
      assert.equal(createHash('sha256').update(read(source.path)).digest('hex'), source.sha256, source.path)
      hashes++
    }
    for (const test of card.originalTests) {
      paths++
      assert.equal(test.executed, false)
      const lines = read(test.path).toString('utf8').split('\n')
      for (const observation of test.assertionsObserved ?? []) {
        const match = observation.match(/^(.*?)\s*\(line (\d+)/)
        if (!match) {
          assert.equal(test.evidenceTier, 'path-existence-only', `Unanchored title: ${observation}`)
          unquotedPathOnlyNotes++
          continue
        }
        const nearby = lines.slice(Number(match[2]) - 1, Number(match[2]) + 3).join(' ').replace(/\s+/g, ' ')
        assert(nearby.includes(match[1].trim()), `${test.path}: ${observation}`)
        titles++
      }
    }
  }
  assert.equal(paths, doc.counts.totalOriginalTestFilesCited ?? doc.counts.totalVerifiedTestFilesCitedAcrossCards)
  if (doc.counts.totalAssertionsQuoted !== undefined) assert.equal(titles, doc.counts.totalAssertionsQuoted)
  results.push({ name, cards: doc.cards.length, paths, titles, hashes, unquotedPathOnlyNotes })
}
console.log(JSON.stringify({ scope: 'Metadata/title-location checks only; no source test or product behavior executed.', results }, null, 2))
