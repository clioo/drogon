import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptPath = fileURLToPath(new URL('./recipe-toolchain.sh', import.meta.url));
const script = `sh ${JSON.stringify(scriptPath)}`;
// The pinned Node 24 runtime and the npm that ships with the machine's ambient
// node; both are real toolchain sources, never modified by the script.
const NODE24_BIN = path.join(
  process.env.HOME,
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin',
);
const AMBIENT_NODE_BIN = path.join(process.env.HOME, '.local/bin');
const PINNED = 'pnpm@11.19.0';

function fixture(t, { packageManager = PINNED, home = process.env.HOME } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), 'drogon-recipe-toolchain-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  if (packageManager !== null) {
    writeFileSync(
      path.join(base, 'package.json'),
      JSON.stringify({ name: 'fixture', packageManager }),
    );
  }
  // The script only checks cargo is resolvable; a stub stands in for the real
  // toolchain binary, mirroring scripts/build-main.test.mjs.
  const cargoBin = path.join(base, 'fixture-bin');
  mkdirSync(cargoBin);
  writeFileSync(path.join(cargoBin, 'cargo'), '#!/bin/sh\necho cargo 1.98.0\n');
  chmodSync(path.join(cargoBin, 'cargo'), 0o755);
  return { base, home, cargoBin };
}

// PATH without node, npm or pnpm; each test layers real tool dirs back in.
function constrainedEnv({ home, cargoBin = null, withNode24 = false, withNpm = false, shimDir = null } = {}) {
  const entries = [shimDir, cargoBin, withNode24 ? NODE24_BIN : null, withNpm ? AMBIENT_NODE_BIN : null, '/usr/bin', '/bin'];
  return {
    ...process.env,
    HOME: home,
    PATH: entries.filter(Boolean).join(':'),
  };
}

function runScript(cwd, env) {
  return spawnSync('sh', [scriptPath], { cwd, env, encoding: 'utf8' });
}

test('resolves the pinned pnpm project-locally and prints the PATH to eval', t => {
  const { base, home, cargoBin } = fixture(t);
  const result = runScript(base, constrainedEnv({ home, cargoBin, withNode24: true, withNpm: true }));
  assert.equal(result.status, 0, result.stderr);
  // Only the export line on stdout; diagnostics belong on stderr.
  const exportLine = result.stdout.trim();
  assert.match(exportLine, /^export PATH=".+\/node_modules\/\.bin:.+:\$PATH"$/);
  const exported = exportLine.match(/^export PATH="(.+):\$PATH"$/)[1].split(':');
  const pnpmBin = exported[0];
  assert.equal(exported[1], NODE24_BIN, 'pinned runtime exported right after the pnpm bin');
  assert.ok(existsSync(path.join(pnpmBin, 'pnpm')), 'pinned pnpm installed project-locally');
  // The eval contract used by the recipe steps must yield the pinned toolchain.
  const probed = spawnSync(
    'sh',
    ['-c', `eval "$(${script})" && node --version && pnpm --version && command -v pnpm`],
    { cwd: base, env: constrainedEnv({ home, cargoBin, withNode24: true, withNpm: true }), encoding: 'utf8' },
  );
  assert.equal(probed.status, 0, probed.stderr);
  const [nodeVersion, pnpmVersion, pnpmPath] = probed.stdout.trim().split('\n');
  assert.match(nodeVersion, /^v24\./, 'pinned Node 24 runtime preferred');
  assert.equal(pnpmVersion, '11.19.0');
  assert.equal(
    pnpmPath,
    path.join(realpathSync(base), '.mentu/runtime/toolchain/node_modules/.bin/pnpm'),
  );
});

test('reuses an existing project-local toolchain without reinstalling', t => {
  const { base, home, cargoBin } = fixture(t);
  const env = constrainedEnv({ home, cargoBin, withNode24: true, withNpm: true });
  assert.equal(runScript(base, env).status, 0);
  // Make the toolchain read-only: a second install would fail, a reused one succeeds.
  const toolchain = path.join(base, '.mentu/runtime/toolchain');
  try {
    chmodSync(toolchain, 0o555);
    const result = runScript(base, env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^export PATH=/);
  } finally {
    chmodSync(toolchain, 0o755);
  }
});

test('fails honestly when node is missing from PATH', t => {
  const { base, home } = fixture(t, { home: mkdtempSync(path.join(tmpdir(), 'drogon-empty-home-')) });
  const result = runScript(base, constrainedEnv({ home }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recipe-toolchain: node is not on PATH/);
});

test('rejects a node whose major version is not 24', t => {
  const { base, home } = fixture(t, { home: mkdtempSync(path.join(tmpdir(), 'drogon-empty-home-')) });
  const shimDir = path.join(base, 'shim-bin');
  mkdirSync(shimDir);
  // Fixture node that reports v99 the way the script queries it (--version and -p).
  writeFileSync(
    path.join(shimDir, 'node'),
    '#!/bin/sh\ncase "$1" in -p) echo 99 ;; *) echo v99.0.0 ;; esac\n',
  );
  chmodSync(path.join(shimDir, 'node'), 0o755);
  const result = runScript(base, constrainedEnv({ home, shimDir }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node 24 is required for Drogon builds; resolved node is v99\.0\.0/);
});

test('fails when package.json does not pin pnpm via packageManager', t => {
  const { base, home, cargoBin } = fixture(t, { packageManager: 'npm@10.9.0' });
  const result = runScript(base, constrainedEnv({ home, cargoBin, withNode24: true, withNpm: true }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected a pinned pnpm packageManager, got: npm@10\.9\.0/);
});

test('fails when the resolved pnpm does not match the pin', t => {
  const { base, home, cargoBin } = fixture(t);
  // Pre-seed a project-local pnpm shim that reports a version off the pin; the
  // script must trust the pin check, not the mere presence of a pnpm binary.
  const seededBin = path.join(base, '.mentu/runtime/toolchain/node_modules/.bin');
  mkdirSync(seededBin, { recursive: true });
  writeFileSync(path.join(seededBin, 'pnpm'), '#!/bin/sh\necho 0.0.1\n');
  chmodSync(path.join(seededBin, 'pnpm'), 0o755);
  const result = runScript(base, constrainedEnv({ home, cargoBin, withNode24: true, withNpm: true }));
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /packageManager pins pnpm@11\.19\.0 but resolved pnpm is 0\.0\.1/,
  );
});

test('the eval contract puts the pinned Node 24 ahead of an ambient newer node', t => {
  // Ambient PATH resolves the machine's newer node first, like the production
  // launcher does; the exported PATH must still resolve node to 24.
  const { base, home, cargoBin } = fixture(t);
  const env = constrainedEnv({ home, cargoBin, withNpm: true });
  assert.match(
    spawnSync('sh', ['-c', 'command -v node && node --version'], { cwd: base, env, encoding: 'utf8' }).stdout,
    /\.local\/bin\/node\nv26\./,
    'precondition: ambient node is the newer one',
  );
  const probed = spawnSync(
    'sh',
    ['-c', `eval "$(${script})" && command -v node && node --version && pnpm --version`],
    { cwd: base, env, encoding: 'utf8' },
  );
  assert.equal(probed.status, 0, probed.stderr);
  const [nodePath, nodeVersion, pnpmVersion] = probed.stdout.trim().split('\n');
  assert.equal(nodePath, path.join(NODE24_BIN, 'node'));
  assert.match(nodeVersion, /^v24\./);
  assert.equal(pnpmVersion, '11.19.0');
});

test('the recipe invocation pattern stops the step chain when resolution fails', t => {
  const { base, home } = fixture(t, { home: mkdtempSync(path.join(tmpdir(), 'drogon-empty-home-')) });
  const ok = spawnSync(
    'sh',
    ['-c', `toolchain_env=$(${script}) && eval "$toolchain_env" && echo CHAIN_REACHED`],
    { cwd: base, env: constrainedEnv({ home }), encoding: 'utf8' },
  );
  assert.notEqual(ok.status, 0);
  assert.doesNotMatch(ok.stdout, /CHAIN_REACHED/);
});
