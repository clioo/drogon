import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildVirginEnv,
  CLT_STUB_SCRIPT,
  extractCliError,
  isAlive,
  stageBundle,
  writeShim,
} from './e2e-virgin-environment.mjs';

function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'drogon-virgin-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('CLT stub script carries the marker the classifiers match', () => {
  assert.match(CLT_STUB_SCRIPT, /no developer tools were found/i);
  assert.match(CLT_STUB_SCRIPT, /exit 1/);
});

test('virgin env isolates HOME/DATA, shadows git, drops toolchains', (t) => {
  const root = scratch(t);
  const env = buildVirginEnv(root);
  assert.equal(env.HOME, path.join(root, 'home'));
  assert.equal(env.DROGON_DATA_DIR, path.join(root, 'data'));
  const [first, ...rest] = env.PATH.split(':');
  assert.equal(first, path.join(root, 'shim'));
  assert.ok(!env.PATH.includes('/opt/homebrew'), 'no Homebrew on PATH');
});

test('virgin env extra overrides ride on top', (t) => {
  const env = buildVirginEnv(scratch(t), { http_proxy: 'http://127.0.0.1:9' });
  assert.equal(env.http_proxy, 'http://127.0.0.1:9');
  assert.ok(env.PATH.includes('/usr/bin'));
});

test('extractCliError reads failure envelopes and nothing else', () => {
  assert.deepEqual(
    extractCliError(JSON.stringify({ ok: false, error: { code: 'gh_unavailable', message: 'm' } })),
    { code: 'gh_unavailable', message: 'm' },
  );
  assert.equal(extractCliError(JSON.stringify({ ok: true, result: {} })), null);
  assert.equal(extractCliError('not json'), null);
  assert.equal(extractCliError(''), null);
});

test('stageBundle refuses a bundle without the shipped binaries', (t) => {
  const root = scratch(t);
  assert.throws(() => stageBundle(path.join(root, 'empty.app'), root), /missing bin/);
});

test('stageBundle stages executable copies and writeShim makes a stub git', (t) => {
  const root = scratch(t);
  const bin = path.join(root, 'Fake.app', 'Contents', 'Resources', 'bin');
  mkdirSync(bin, { recursive: true });
  for (const name of ['drogond', 'drogon-cli', 'drogon-cli.native']) {
    writeFileSync(path.join(bin, name), `fake-${name}`);
  }
  const stage = path.join(root, 'stage');
  mkdirSync(stage);
  const staged = stageBundle(path.join(root, 'Fake.app'), stage);
  assert.deepEqual(Object.keys(staged).sort(), ['drogon-cli', 'drogon-cli.native', 'drogond']);
  for (const info of Object.values(staged)) {
    assert.match(info.sha256, /^[0-9a-f]{64}$/);
  }
  const shim = writeShim(root);
  assert.ok(existsSync(path.join(shim, 'git')));
});

test('isAlive is false for a dead pid', () => {
  assert.equal(isAlive(2147483647), false);
});
