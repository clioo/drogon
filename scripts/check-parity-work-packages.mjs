import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function checkWorkPackages(inventoryBytes, proposal) {
  const inventory = JSON.parse(inventoryBytes.toString())
  const errors = []
  const expect = (condition, message) => { if (!condition) errors.push(message) }
  const digest = createHash('sha256').update(inventoryBytes).digest('hex')
  expect(proposal.status === 'proposal' && proposal.dispatchable === false, 'allocation is not a dispatch authorization')
  expect(proposal.source.manifestSha256 === digest, 'source inventory digest mismatch')
  expect(proposal.source.gitHead === inventory.source.gitHead, 'source revision mismatch')
  expect(proposal.source.manifestEntries === inventory.files.length, 'source record count mismatch')

  const source = new Map()
  for (const file of inventory.files) {
    const records = source.get(file.path) ?? []
    expect(records.every(record => record.sha256 === file.sha256), `conflicting source hashes: ${file.path}`)
    source.set(file.path, [...records, file])
  }
  expect(proposal.source.manifestUniquePaths === source.size, 'unique source path count mismatch')
  const packages = new Map()
  const assigned = new Set()
  for (const item of proposal.packages) {
    expect(!packages.has(item.id), `duplicate package id: ${item.id}`)
    expect(/^WP-[A-Z0-9-]+$/.test(item.id), `invalid package id: ${item.id}`)
    packages.set(item.id, item)
    expect(item.testPortBoundary === `tests/parity/ports/${item.id}/**`, `non-exclusive test-port boundary: ${item.id}`)
    expect(item.fileCount === item.files.length, `package file count mismatch: ${item.id}`)
    for (const file of item.files) {
      expect(!assigned.has(file.path), `duplicate assignment: ${file.path}`)
      assigned.add(file.path)
      const records = source.get(file.path)
      expect(Boolean(records), `unknown source path: ${file.path}`)
      expect(records?.every(record => record.sha256 === file.sha256), `source hash mismatch: ${file.path}`)
      if (records?.length > 1) {
        for (const record of records) {
          expect(file.bothRoles?.some(role => role === record.domain || role.startsWith(`${record.domain} (`)),
            `missing source role ${record.domain}: ${file.path}`)
        }
      }
    }
  }
  for (const sourcePath of source.keys()) expect(assigned.has(sourcePath), `unassigned source path: ${sourcePath}`)

  const visiting = new Set()
  const depths = new Map()
  function depth(id) {
    if (visiting.has(id)) { errors.push(`cyclic dependency at ${id}`); return 0 }
    if (depths.has(id)) return depths.get(id)
    const item = packages.get(id)
    if (!item) { errors.push(`unknown dependency: ${id}`); return 0 }
    visiting.add(id)
    const result = Math.max(0, ...item.dependencies.map(dependency => 1 + depth(dependency)))
    visiting.delete(id)
    depths.set(id, result)
    return result
  }
  for (const id of packages.keys()) depth(id)
  for (const group of proposal.integrationGroups ?? []) {
    for (const id of group.members) expect(packages.has(id), `unknown integration member: ${id}`)
    expect(Boolean(group.acceptance?.trim()), `missing joint acceptance: ${group.id}`)
  }
  return {
    ok: errors.length === 0,
    scope: 'file-allocation integrity only; not capability coverage, test equivalence or dispatch approval',
    sourceDigest: digest,
    sourceRecords: inventory.files.length,
    uniqueSourcePaths: source.size,
    packages: packages.size,
    maxDependencyDepthEdges: Math.max(0, ...depths.values()),
    errors
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 2) throw new Error('This read-only check takes no arguments')
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const result = checkWorkPackages(
      readFileSync(resolve(root, 'docs/migration/parity-source-tests.json')),
      JSON.parse(readFileSync(resolve(root, 'docs/migration/parity-test-work-packages.json'), 'utf8'))
    )
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
