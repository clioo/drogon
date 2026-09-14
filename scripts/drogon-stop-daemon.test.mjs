import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const sleep = promisify(setTimeout);
const darwinOnly = { skip: process.platform !== 'darwin' };

function fixture(t) {
  const root = mkdtempSync('/tmp/drogon-stop-daemon-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  // The hook canonicalises its own directory (pwd -P), so forged argv[0]
  // values must use the canonical path too — /tmp is a symlink on macOS.
  const canonicalBin = realpathSync(bin);
  const hook = path.join(bin, 'drogon-stop-daemon');
  copyFileSync(new URL('./drogon-stop-daemon.sh', import.meta.url), hook);
  chmodSync(hook, 0o755);
  return { root, bin, hook, daemon: path.join(canonicalBin, 'drogond') };
}

/** Long-running process with an exact argv[0]; stdin pipe keeps `cat` put. */
function fakeDaemon(argv0) {
  const child = spawn('sh', ['-c', 'exec -a "$0" cat', argv0], {
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  return child;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitExit(child, timeoutMs = 10000) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  const done = await Promise.race([
    new Promise((resolve) => child.on('close', () => resolve(true))),
    sleep(timeoutMs).then(() => false),
  ]);
  return done;
}

test('hook stops the --data-dir daemon and the bare hand-started one', darwinOnly, async (t) => {
  const { hook, daemon } = fixture(t);
  const withArgs = fakeDaemon(`${daemon} --data-dir /tmp/virgin-x`);
  const bare = fakeDaemon(daemon);
  const unrelated = spawn('cat', [], { stdio: ['pipe', 'ignore', 'ignore'] });
  const versionShape = fakeDaemon(`${daemon} --version`);
  t.after(() => {
    for (const child of [withArgs, bare, unrelated, versionShape]) {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
  });
  await sleep(500);
  assert.ok(alive(withArgs.pid), 'with-args fake did not start');
  assert.ok(alive(bare.pid), 'bare fake did not start');

  const { stdout, stderr } = await execFileAsync('sh', [hook], { timeout: 30000 });
  assert.equal(stdout, '');
  assert.equal(stderr, '');

  assert.ok(await waitExit(withArgs), 'with-args daemon survived the hook');
  assert.ok(await waitExit(bare), 'bare hand-started daemon survived the hook');
  assert.ok(alive(unrelated.pid), 'hook killed an unrelated process');
  assert.ok(alive(versionShape.pid), 'hook killed a transient --version-shaped process');
});

test('hook exits zero with nothing to stop', darwinOnly, async (t) => {
  const { hook } = fixture(t);
  await execFileAsync('sh', [hook], { timeout: 30000 });
});
