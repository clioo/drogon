import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, delimiter, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const binary = resolve(process.argv[2])
const fixture = mkdtempSync(join(tmpdir(), 'drogon-git-version-probe-'))
const repo = join(fixture, 'repo')
const empty = join(fixture, 'empty')
mkdirSync(repo)
mkdirSync(empty)
const attributes = join(empty, 'attributes')
writeFileSync(attributes, '')
const probeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
Object.assign(probeEnv, {
  PATH: `${dirname(binary)}${delimiter}${process.env.PATH ?? ''}`,
  GIT_EXEC_PATH: dirname(binary),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_ATTR_NOSYSTEM: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  LC_ALL: 'C'
})
const records = []
function run(args, expected = 0) {
  const result = spawnSync(binary, [
    '--no-pager', '-c', `core.hooksPath=${empty}`,
    '-c', `core.attributesFile=${attributes}`,
    '-c', 'commit.gpgSign=false', '-c', 'core.fsmonitor=false',
    '-c', 'core.quotePath=true', '-c', 'color.ui=never',
    ...args
  ], { cwd: repo, env: probeEnv, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 })
  if (result.error) throw result.error
  records.push({ args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr })
  if (expected !== null) assert.equal(result.status, expected, JSON.stringify(records.at(-1)))
  return result
}
try {
  const version = run(['--version']).stdout.trim()
  run(['init', '--quiet', `--template=${empty}`])
  run(['config', 'user.name', 'Drogon fixture'])
  run(['config', 'user.email', 'fixture@example.invalid'])
  writeFileSync(join(repo, 'tracked.txt'), 'fixture\n')
  run(['add', '--', 'tracked.txt'])
  run(['commit', '--quiet', '-m', 'fixture'])
  run(['worktree', 'add', '--detach', join(fixture, 'linked space')])
  if (process.platform !== 'win32') run(['worktree', 'add', '--detach', join(fixture, 'linked\tquoted"')])
  const preferred = run(['worktree', 'list', '--porcelain', '-z'], null)
  const rejectedZ = preferred.status !== 0 && /unknown (switch|option).*['`]z'/.test(preferred.stderr)
  if (preferred.status !== 0) assert.ok(rejectedZ, JSON.stringify(records.at(-1)))
  else assert.ok(preferred.stdout.includes('\0'))
  const fallback = run(['worktree', 'list', '--porcelain'])
  assert.ok(fallback.stdout.includes('linked space'))
  if (process.platform !== 'win32') assert.ok(fallback.stdout.includes('linked\tquoted"'))
  writeFileSync(join(repo, process.platform === 'win32' ? 'untracked space.txt' : 'untracked\tfile.txt'), 'fixture\n')
  const status = run(['status', '--porcelain=v2', '-z'])
  assert.ok(status.stdout.endsWith('\0'))
  assert.equal(status.stderr, '')
  const report = JSON.stringify({
    schema: 'drogon.git-version-characterization.v1', version, platform: process.platform,
    binary, binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
    preferredRejectedAsUnknownZ: rejectedZ,
    records
  }, null, 2)
  if (process.argv[3]) writeFileSync(resolve(process.argv[3]), `${report}\n`)
  console.log(report)
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
