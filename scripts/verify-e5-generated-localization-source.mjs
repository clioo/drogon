import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const sourceRoot = process.argv[2]
assert(sourceRoot, 'Usage: node scripts/verify-e5-generated-localization-source.mjs SOURCE_ROOT')
const reportPath = 'docs/migration/audit-closure/e5-platform/generated-localization-final.json'
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const lines = (value) => value.match(/[^\n]*\n|[^\n]+$/g) ?? []
const readSource = (file) => fs.readFileSync(path.isAbsolute(file) ? file : path.join(sourceRoot, file))
let sourceRanges = 0
for (const evidence of report.sourceEvidence) {
  const bytes = readSource(evidence.path)
  assert.equal(sha(bytes), evidence.sha256, evidence.path)
  assert.equal(bytes.length, evidence.bytes)
  const physical = lines(bytes.toString())
  assert.equal(physical.length, evidence.lineCount)
  for (const range of evidence.ranges) {
    const selected = physical.slice(range.start - 1, range.end).join('')
    assert.equal(sha(selected), range.sha256, `${evidence.path}:${range.start}`)
    assert.equal(Buffer.byteLength(selected), range.bytes)
    sourceRanges++
  }
}
const tracked = report.sourceEvidence.filter((entry) => !path.isAbsolute(entry.path)).map((e) => e.path)
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim(), report.sourceRevision)
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', ...tracked], { cwd: sourceRoot })
assert.equal(execFileSync('git', ['ls-files', '--', ...tracked], { cwd: sourceRoot, encoding: 'utf8' }).trim().split('\n').length, tracked.length)
for (const doc of report.documents) assert.equal(sha(fs.readFileSync(doc.path)), doc.sha256, doc.path)

const flatten = (value, prefix = '', result = {}) => {
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string') result[full] = child
    else {
      assert(child && typeof child === 'object' && !Array.isArray(child), full)
      flatten(child, full, result)
    }
  }
  return result
}
const english = flatten(JSON.parse(readSource(report.localization.catalogs[0].path)))
const keys = Object.keys(english).sort()
assert.equal(sha(JSON.stringify(keys)), report.localization.keySpace.orderedDottedKeysSha256)
const tokens = (value) => [...value.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1].trim()).sort()
let strings = 0
for (const catalog of report.localization.catalogs) {
  const values = flatten(JSON.parse(readSource(catalog.path)))
  const actualKeys = Object.keys(values).sort()
  assert.equal(actualKeys.length, catalog.keys)
  assert.equal(sha(JSON.stringify(actualKeys)), catalog.keySetSha256)
  assert.equal(sha(JSON.stringify(actualKeys.map((key) => [key, values[key]]))), catalog.orderedContentSha256)
  const present = Buffer.alloc(Math.ceil(keys.length / 8))
  const equal = Buffer.alloc(present.length)
  for (const [i, key] of keys.entries()) {
    if (Object.hasOwn(values, key)) present[i >> 3] |= 1 << (i % 8)
    if (values[key] === english[key]) equal[i >> 3] |= 1 << (i % 8)
  }
  assert.equal(present.toString('base64'), catalog.presentMaskBase64)
  assert.equal(equal.toString('base64'), catalog.equalEnglishMaskBase64)
  assert.equal(actualKeys.filter((key) => !Object.hasOwn(english, key)).length, 0)
  for (const key of actualKeys) assert.deepEqual(tokens(values[key]), tokens(english[key]), key)
  strings += actualKeys.length
}
assert.equal(strings, report.localization.keySpace.allResourcesStringLeaves)

function parsePatch(text) {
  const sections = new Map()
  let section, hunk
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const name = line.slice(line.indexOf(' b/') + 3)
      section = { hunks: [], oldLines: new Map(), newLines: new Map() }
      sections.set(name, section)
      hunk = undefined
    } else if (line.startsWith('@@ ')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
      assert(match, line)
      hunk = { oldStart: +match[1], newStart: +match[3], old: [], next: [] }
      section.hunks.push(hunk)
    } else if (hunk && /^[ +\-]/.test(line)) {
      if (line[0] !== '+') {
        section.oldLines.set(hunk.oldStart + hunk.old.length, line.slice(1))
        hunk.old.push(line.slice(1))
      }
      if (line[0] !== '-') {
        section.newLines.set(hunk.newStart + hunk.next.length, line.slice(1))
        hunk.next.push(line.slice(1))
      }
    }
  }
  return sections
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function decodeVlq(segment) {
  const values = []
  let value = 0, shift = 0
  for (const char of segment) {
    const digit = alphabet.indexOf(char)
    assert(digit >= 0, char)
    value += (digit & 31) * 2 ** shift
    if (digit & 32) shift += 5
    else {
      values.push((value & 1 ? -1 : 1) * Math.floor(value / 2))
      value = shift = 0
    }
  }
  assert.equal(shift, 0)
  return values
}
let mapJoins = 0, generatedSpans = 0, decodedSegments = 0, unrepresentedSegments = 0
const reorderedMaps = []
for (const patch of report.generatedEvidence.patches) {
  const sections = parsePatch(readSource(`config/patches/${patch.patch}`).toString())
  for (const map of patch.maps) {
    const section = sections.get(map.path)
    const oldMap = JSON.parse([...section.oldLines.values()].join('\n'))
    const newMap = JSON.parse([...section.newLines.values()].join('\n'))
    assert.deepEqual([...oldMap.sources].sort(), [...newMap.sources].sort())
    if (JSON.stringify(oldMap.sources) !== JSON.stringify(newMap.sources)) reorderedMaps.push(map.path)
    const changedSources = newMap.sources.filter((name, index) =>
      oldMap.sourcesContent[oldMap.sources.indexOf(name)] !== newMap.sourcesContent[index])
    assert.deepEqual([...changedSources].sort(), [...map.changedSources].sort())
    assert.deepEqual([...changedSources].sort(), map.joins.map((join) => join.mapSource).sort())
    for (const join of map.joins) {
      const index = newMap.sources.indexOf(join.mapSource)
      assert(index >= 0)
      const oldIndex = oldMap.sources.indexOf(join.mapSource)
      assert(oldIndex >= 0)
      const before = oldMap.sourcesContent[oldIndex], after = newMap.sourcesContent[index]
      assert.equal(sha(before), join.oldSha256)
      assert.equal(sha(after), join.newSha256)
      const reconstructed = before.split('\n')
      let delta = 0
      for (const hunk of sections.get(join.source).hunks) {
        const offset = hunk.oldStart - 1 + delta
        assert.deepEqual(reconstructed.slice(offset, offset + hunk.old.length), hunk.old, join.source)
        reconstructed.splice(offset, hunk.old.length, ...hunk.next)
        delta += hunk.next.length - hunk.old.length
      }
      assert.equal(reconstructed.join('\n'), after, join.source)
      mapJoins++
    }
    const mapping = report.generatedEvidence.maps.find((m) => m.patch === patch.patch && m.map === map.path)
    const generated = sections.get(map.path.slice(0, -4)).newLines
    const sourceLines = newMap.sourcesContent.map((text) => text.split('\n'))
    let sourceIndex = 0, sourceLine = 0, sourceColumn = 0, nameIndex = 0, count = 0, outside = 0
    for (const [lineIndex, encoded] of newMap.mappings.split(';').entries()) {
      let column = 0
      for (const segment of encoded.split(',').filter(Boolean)) {
        const fields = decodeVlq(segment)
        assert([1, 4, 5].includes(fields.length))
        column += fields[0]
        assert(column >= 0)
        const line = generated.get(lineIndex + 1)
        if (line === undefined) outside++
        else assert(column <= line.length)
        if (fields.length > 1) {
          sourceIndex += fields[1]
          sourceLine += fields[2]
          sourceColumn += fields[3]
          assert(sourceIndex >= 0 && sourceIndex < sourceLines.length)
          assert(sourceLine >= 0 && sourceLine < sourceLines[sourceIndex].length)
          assert(sourceColumn >= 0 && sourceColumn <= sourceLines[sourceIndex][sourceLine].length)
          if (fields.length === 5) {
            nameIndex += fields[4]
            assert(nameIndex >= 0 && nameIndex < newMap.names.length)
          }
        }
        count++
      }
    }
    assert.equal(count, mapping.segmentCount)
    assert.equal(outside, mapping.unrepresentedGeneratedLineSegments)
    decodedSegments += count
    unrepresentedSegments += outside
    for (const source of mapping.changedSourceGeneratedSpans) {
      for (const span of source.spans) {
        const line = generated.get(span.generatedLine)
        assert.equal(typeof line, 'string')
        assert(span.startColumn >= 0 && span.endColumn <= line.length)
        assert.equal(sha(line.slice(span.startColumn, span.endColumn)), span.sha256)
        generatedSpans++
      }
    }
  }
}
assert.equal(mapJoins, report.generatedEvidence.joinCount)
const allocation = JSON.parse(fs.readFileSync('docs/migration/parity-test-work-packages.json'))
for (const pkg of report.retainedTests.packages) {
  const index = Number(pkg.pointer.split('/')[2])
  assert.equal(allocation.packages[index].id, pkg.id)
  assert.equal(allocation.packages[index].files.length, pkg.fileCount)
}
const originals = allocation.packages.flatMap((pkg) => pkg.files)
assert.equal(originals.length, 9037)
assert.equal(new Set(originals).size, 9037)
console.log(JSON.stringify({ reportPath, reportSha256: sha(fs.readFileSync(reportPath)), trackedFiles: tracked.length, installedDependencyFiles: report.sourceEvidence.length - tracked.length, sourceRanges, documentHashes: report.documents.length, catalogResources: report.localization.catalogs.length, strings, canonicalEnglishKeys: keys.length, mapJoins, generatedSpans, decodedSegments, unrepresentedSegments, reorderedMaps, originalPackages: allocation.packages.length, originalFiles: originals.length, testsExecuted: 0, limitations: ['No compiler/package authenticity or reproducible-build proof.', 'No linguistic or rendered/native parity proof.', 'JSON.parse is not an independent duplicate-object-name detector.'] }, null, 2))
