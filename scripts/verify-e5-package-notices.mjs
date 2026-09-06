import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.argv[2]
assert(root, 'Usage: node scripts/verify-e5-package-notices.mjs SOURCE_ROOT')
const pin = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const hash = (value, algorithm = 'sha256', encoding = 'hex') =>
  crypto.createHash(algorithm).update(value).digest(encoding)
const source = (file) => {
  const bytes = fs.readFileSync(path.join(root, file))
  const pinned = execFileSync('git', ['show', `${pin}:${file}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(hash(bytes), hash(pinned), file)
  return bytes
}
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(), pin)
const specs = [
  { name: 'lucide-react', version: '0.577.0', lock: 'pnpm-lock.yaml', local: 'node_modules/lucide-react' },
  { name: 'lucide-react', version: '1.26.0', lock: 'docs/site/pnpm-lock.yaml', local: null },
  { name: 'katex', version: '0.16.45', lock: 'pnpm-lock.yaml', local: 'node_modules/katex' },
  { name: 'katex', version: '0.16.47', lock: 'pnpm-lock.yaml', local: 'node_modules/.pnpm/katex@0.16.47/node_modules/katex' },
]
async function download(url, maxBytes) {
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://registry.npmjs.org')
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) })
  assert(response.ok, `${url}: HTTP ${response.status}`)
  const chunks = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length
    assert(bytes <= maxBytes, `Download cap exceeded: ${url}`)
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
const packages = []
for (const spec of specs) {
  const lock = source(spec.lock)
  const packageSections = lock.toString().split('\npackages:\n').slice(1)
    .map((section) => section.split('\nsnapshots:\n')[0])
  const stanzas = packageSections.flatMap((section) => section.split(`\n  ${spec.name}@${spec.version}:\n`).slice(1))
  assert.equal(stanzas.length, 1, 'Expected exactly one package resolution across lock documents')
  const integrity = stanzas[0].split('\n\n')[0].match(/integrity: (sha512-[A-Za-z0-9+/=]+)/)?.[1]
  assert(integrity)
  const metadataUrl = `https://registry.npmjs.org/${spec.name}/${spec.version}`
  const metadataBytes = await download(metadataUrl, 2 * 1024 * 1024)
  const metadata = JSON.parse(metadataBytes)
  assert.equal(metadata.name, spec.name)
  assert.equal(metadata.version, spec.version)
  assert.equal(metadata.dist.integrity, integrity)
  const archive = await download(metadata.dist.tarball, 64 * 1024 * 1024)
  assert.equal(`sha512-${hash(archive, 'sha512', 'base64')}`, integrity)
  const tar = (args) => execFileSync('tar', args, { input: archive, maxBuffer: 32 * 1024 * 1024 })
  const entries = tar(['-tzf', '-']).toString().trim().split('\n')
  const noticePaths = entries.filter((p) => /(?:^|\/)(?:licen[cs]e|copying|notice|ofl)(?:[._-]|$)/i.test(p))
  assert(noticePaths.includes('package/LICENSE'))
  const packageBytes = tar(['-xOzf', '-', 'package/package.json'])
  const packageJson = JSON.parse(packageBytes)
  assert.equal(packageJson.name, spec.name)
  assert.equal(packageJson.version, spec.version)
  const notices = noticePaths.map((file) => {
    assert(file.startsWith('package/') && !file.split('/').includes('..'))
    const bytes = tar(['-xOzf', '-', file])
    const localFile = spec.local && path.join(root, spec.local, file.slice('package/'.length))
    const installedSha256 = localFile && fs.existsSync(localFile) ? hash(fs.readFileSync(localFile)) : null
    if (spec.local) assert.equal(installedSha256, hash(bytes), localFile)
    return { path: file, bytes: bytes.length, sha256: hash(bytes), text: bytes.toString(), installedSha256 }
  })
  const localPackage = spec.local && fs.readFileSync(path.join(root, spec.local, 'package.json'))
  if (localPackage) assert.equal(hash(localPackage), hash(packageBytes), spec.local)
  packages.push({
    name: spec.name, version: spec.version, lockPath: spec.lock, lockSha256: hash(lock), integrity,
    metadataUrl, metadataSha256: hash(metadataBytes), tarballUrl: metadata.dist.tarball,
    tarballBytes: archive.length, tarballSha256: hash(archive), tarballIntegrityVerified: true,
    declaredLicense: packageJson.license, repository: packageJson.repository,
    packageJsonSha256: hash(packageBytes), installedPackageJsonMatches: localPackage ? true : null,
    localPackagePath: spec.local, notices,
    fontEntryCount: entries.filter((p) => /\.(?:woff2?|ttf|otf)$/i.test(p)).length,
  })
}
console.log(JSON.stringify({
  schema: 'drogon.audit.e5-package-notices.v1', observedAt: new Date().toISOString(), sourceRevision: pin,
  command: 'node scripts/verify-e5-package-notices.mjs SOURCE_ROOT', packages,
  effects: 'Public registry reads and tar stdout only; no archive extraction to disk, installation, lifecycle scripts, source edits, service provisioning or credentials.',
  limits: 'Lock-integrity and package-notice evidence, not publisher identity attestation, individual asset rights, font-origin proof, final packaged notices or product parity.',
  e5Accepted: false, fullAuditAccepted: false, testsRun: 0,
}, null, 2))
