import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const source = join(root, 'source')
const sha = 'c97906287bb7a390b25e2025b600d9fb3c25d9c3'
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: source, encoding: 'utf8' }).trim()
assert.equal(process.versions.node, '24.19.0')
assert.equal(git('rev-parse', 'HEAD'), sha)
assert.equal(git('status', '--porcelain'), '')
assert.equal(existsSync(join(source, 'out')), false)
const modules = realpathSync(join(source, 'node_modules'))
let links = 0
function checkLinks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      const target = realpathSync(path)
      assert.ok(target === modules || target.startsWith(modules + sep), path)
      links++
    } else if (entry.isDirectory()) checkLinks(path)
  }
}
checkLinks(modules)
const home = join(root, 'home'), temp = join(root, 'temp')
mkdirSync(home)
mkdirSync(temp)
const env = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  HOME: home, USERPROFILE: home, TMPDIR: temp,
  XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'),
  LANG: 'en_US.UTF-8', CI: '1', NO_COLOR: '1'
}
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const receipt = {
  sourceSha: sha, platform: process.platform, arch: process.arch, node: process.versions.node,
  dependencyProvenance: 'independent macOS copy-on-write of the reviewed reference dependency tree; no install scripts',
  dependencyLinks: links, externalDependencyLinks: 0,
  compilerVersion: JSON.parse(readFileSync(join(modules, 'typescript/package.json'))).version,
  configSha256: hash(join(source, 'config/tsconfig.cli.json')),
  sourceLockSha256: hash(join(source, 'pnpm-lock.yaml')),
  runnerSha256: hash(fileURLToPath(import.meta.url)),
  command: [process.execPath, join(modules, 'typescript/bin/tsc'), '-p', 'config/tsconfig.cli.json', '--outDir', 'out', '--composite', 'false', '--incremental', 'false'],
  env, timeoutMs: 180000, startedAt: new Date().toISOString(),
  scope: 'unmodified frozen CLI compile only; no CLI invocation, install-dev-cli, package fixing, app launch or behavioral test'
}
writeFileSync(join(root, 'build-start.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' })
const log = openSync(join(root, 'build.log'), 'wx', 0o600)
const child = spawn(receipt.command[0], receipt.command.slice(1), { cwd: source, env, stdio: ['ignore', log, log], timeout: receipt.timeoutMs })
closeSync(log)
const outcome = await new Promise(resolve => {
  child.once('error', error => resolve({ code: null, error: error.message }))
  child.once('exit', (code, signal) => resolve({ code, signal }))
})
const outputs = []
function inventory(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name), stat = lstatSync(path)
    assert.ok(!stat.isSymbolicLink(), path)
    if (stat.isDirectory()) inventory(path)
    else if (stat.isFile()) outputs.push({ path: relative(source, path), bytes: stat.size, sha256: hash(path) })
  }
}
inventory(join(source, 'out'))
const result = { ...receipt, endedAt: new Date().toISOString(), outcome, sourceStatus: git('status', '--porcelain'), outputs }
writeFileSync(join(root, 'build-result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ outcome, outputFiles: outputs.length, sourceStatus: result.sourceStatus, receipt: join(root, 'build-result.json') }))
if (outcome.code !== 0 || result.sourceStatus !== '') process.exitCode = 1
