import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = readFileSync(fileURLToPath(new URL('./build-main.sh', import.meta.url)), 'utf8');

function fixture(t, failBuild = false) {
  const base = mkdtempSync(path.join(tmpdir(), 'drogon-build-command-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const remote = path.join(base, 'remote');
  const caller = path.join(base, 'caller with spaces');
  const bin = path.join(base, 'bin');
  for (const dir of [remote, caller, bin]) mkdirSync(dir);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
  git(remote, 'init', '-b', 'main');
  mkdirSync(path.join(remote, 'scripts'));
  writeFileSync(path.join(remote, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.19.0' }));
  writeFileSync(path.join(remote, 'scripts/package-desktop.mjs'), failBuild
    ? 'process.exit(17);'
    : 'console.log(JSON.stringify({status:"PACKAGED",bundle:process.cwd()+"/Drogon.app"}));');
  writeFileSync(path.join(remote, 'scripts/accept-desktop.mjs'), `
    import assert from 'node:assert/strict';
    assert.equal(process.env.DROGON_BACKGROUND_WINDOW, '1');
    assert.equal(process.env.DROGON_VERIFY_OS_FOCUS, '1');
    assert.deepEqual(process.argv.slice(2), ['--bundle', process.cwd()+'/Drogon.app', '--files']);
    console.log('ACCEPTANCE_INVOKED');
  `);
  git(remote, 'add', '.');
  git(remote, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
  git(caller, 'init');
  git(caller, 'remote', 'add', 'origin', remote);
  mkdirSync(path.join(caller, 'scripts'));
  writeFileSync(path.join(caller, 'scripts/build-main.sh'), script);
  writeFileSync(path.join(caller, 'uncommitted.txt'), 'preserve me');
  for (const [name, body] of Object.entries({
    npm: '[[ "$*" == *"pnpm@11.19.0"* ]] || exit 20\n',
    pnpm: '[[ "$*" == "install --frozen-lockfile" ]] || exit 21\n',
    cargo: '[[ "$*" == "fetch --locked" ]] || exit 22\n',
  })) {
    writeFileSync(path.join(bin, name), `#!/bin/bash\nset -eu\n${body}`);
    chmodSync(path.join(bin, name), 0o755);
  }
  return { caller, env, git };
}

test('builds remote main in isolation and optionally verifies without touching caller changes', t => {
  const { caller, env, git } = fixture(t);
  const before = git(caller, 'status', '--porcelain').toString();
  const result = spawnSync('bash', ['scripts/build-main.sh', '--verify'], { cwd: caller, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /ACCEPTANCE_INVOKED/);
  assert.match(result.stdout, /Build complete/);
  assert.equal(readFileSync(path.join(caller, 'uncommitted.txt'), 'utf8'), 'preserve me');
  // Only the deliberately retained build directory is added to caller state.
  assert.equal(git(caller, 'status', '--porcelain', '--', ':!.preflight').toString(), before);
});

test('packaging failure propagates through tee and never invokes acceptance', t => {
  const { caller, env } = fixture(t, true);
  const result = spawnSync('bash', ['scripts/build-main.sh', '--verify'], { cwd: caller, env, encoding: 'utf8' });
  assert.equal(result.status, 17, result.stdout + result.stderr);
  assert.match(result.stderr, /Files retained/);
  assert.doesNotMatch(result.stdout, /ACCEPTANCE_INVOKED|Build complete/);
});

test('unknown options fail before creating a build', () => {
  const result = spawnSync('bash', ['-c', script, 'build-main.sh', '--install'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown option/);
});
