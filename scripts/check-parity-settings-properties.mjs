import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
assert.ok(process.argv.length <= 3, 'usage: node scripts/check-parity-settings-properties.mjs [source]')
const doc = JSON.parse(readFileSync(join(repo, 'docs/migration/parity-settings-properties.json')))
const source = realpathSync(process.argv[2] ?? '/Users/carlos/Documents/Drogon-mentu-session')
assert.equal(doc.source.gitHead, 'c97906287bb7a390b25e2025b600d9fb3c25d9c3')
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim()
assert.equal(git('rev-parse', 'HEAD'), doc.source.gitHead)
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '')
const readSource = file => {
  const full = realpathSync(resolve(source, file))
  const rel = relative(source, full)
  assert.ok(rel && rel !== '..' && !rel.startsWith('..' + sep) && full.startsWith(source + sep), file)
  return readFileSync(full, 'utf8')
}
for (const [file, record] of Object.entries(doc.files)) {
  assert.equal(createHash('sha256').update(readSource(file)).digest('hex'), record.sha256, file)
}
const requireDesktop = createRequire(join(repo, 'apps/desktop/package.json'))
const requirePlugin = createRequire(requireDesktop.resolve('@vitejs/plugin-react'))
const { parse } = requirePlugin('@babel/parser')
const parsed = file => parse(readSource(file), { sourceType: 'module', plugins: ['typescript'] })
const typesFile = 'src/shared/global-settings-types.ts'
const defaultsFile = 'src/shared/default-global-settings.ts'
const members = parsed(typesFile).program.body.find(node => node.declaration?.id?.name === 'GlobalSettings').declaration.typeAnnotation.members
const properties = parsed(defaultsFile).program.body.find(node => node.declaration?.id?.name === 'buildDefaultSettings').declaration.body.body.find(node => node.type === 'ReturnStatement').argument.properties
assert.ok(properties.every(node => node.type === 'ObjectProperty'))
assert.deepEqual(members.map(node => node.key.name).sort(), doc.fields.map(row => row.name).sort())
assert.equal(new Set(doc.fields.map(row => row.name)).size, doc.fields.length)
const sourceDefaults = readSource(defaultsFile)
const kinds = {}
for (const row of doc.fields) {
  const member = members.find(node => node.key.name === row.name)
  assert.equal(row.anchor, `${typesFile}:${member.loc.start.line}`, row.name)
  assert.equal(row.optional, Boolean(member.optional), row.name)
  assert.ok(!Object.hasOwn(row, 'target'), 'name-based guesses must not become verified UI targets')
  const property = properties.find(node => node.key.name === row.name)
  if (!property) {
    assert.equal(row.default.kind, 'absent-no-builder-default', row.name)
    continue
  }
  const value = property.value
  assert.equal(row.default.anchor, `${defaultsFile}:${property.loc.start.line}`, row.name)
  assert.equal(row.default.kind, value.type, row.name)
  assert.equal(row.default.sourceExpression, sourceDefaults.slice(value.start, value.end), row.name)
  assert.equal(row.default.evaluated, false, row.name)
  if (['StringLiteral', 'BooleanLiteral', 'NumericLiteral', 'NullLiteral'].includes(value.type)) {
    assert.equal(row.default.literalValue, value.type === 'NullLiteral' ? null : value.value, row.name)
  } else assert.ok(!Object.hasOwn(row.default, 'literalValue'), row.name)
  kinds[value.type] = (kinds[value.type] ?? 0) + 1
}
assert.equal(doc.counts.declaredFields, members.length)
assert.equal(doc.counts.withBuilderDefault, properties.length)
assert.equal(doc.counts.absentDefault, members.length - properties.length)
assert.equal(doc.counts.optional, members.filter(node => node.optional).length)
assert.equal(doc.counts.targetHypotheses, doc.fields.filter(row => row.targetHypothesis !== null).length)
assert.equal(doc.counts.targetMappingUnverified, members.length)
assert.deepEqual(doc.counts.defaultAstKinds, kinds)
assert.equal(doc.counts.directLiteralFalse, properties.filter(node => node.value.type === 'BooleanLiteral' && !node.value.value).length)
assert.equal(doc.counts.directLiteralNull, properties.filter(node => node.value.type === 'NullLiteral').length)
console.log(JSON.stringify({ node: process.versions.node, fields: members.length, ownDefaults: properties.length, sourceFilesHashed: Object.keys(doc.files).length, evidence: 'static-metadata-only; no source execution or behavioral acceptance' }))
