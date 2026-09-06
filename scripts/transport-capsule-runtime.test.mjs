import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolveTransportRuntime, snapshotTransportPackage, stageTransportRuntime, verifyTransportRuntime, transportTestEnvironment } from './transport-capsule-runtime.mjs';

let root;
let capsule;
let declaration;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'transport-runtime-'));
  capsule = path.join(root, 'capsule');
  mkdirSync(capsule);
  declaration = {};
  for (const [name, version] of [['ws', '8.21.3'], ['tweetnacl', '1.0.3']]) {
    const directory = path.join(root, 'node_modules', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version }));
    writeFileSync(path.join(directory, 'index.js'), 'module.exports = {};\n');
    declaration[name] = { version, treeSha256: snapshotTransportPackage(directory).treeSha256 };
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('leaves capsules without transport declarations unchanged', () => {
  expect(resolveTransportRuntime(undefined, root)).toBeNull();
  stageTransportRuntime(null, capsule);
  verifyTransportRuntime(null, capsule);
});

it('links and verifies the two declared package trees', () => {
  const runtime = resolveTransportRuntime(declaration, root);
  stageTransportRuntime(runtime, capsule);
  verifyTransportRuntime(runtime, capsule);
  expect(runtime.map((entry) => entry.files.length)).toEqual([2, 2]);
  expect(readFileSync(path.join(capsule, 'node_modules/ws/index.js'), 'utf8')).toBe('module.exports = {};\n');
});

it.each(['missing', 'extra', 'version', 'hash', 'field'])('rejects %s declarations', (variant) => {
  if (variant === 'missing') delete declaration.ws;
  if (variant === 'extra') declaration.extra = declaration.ws;
  if (variant === 'version') declaration.ws.version = '1';
  if (variant === 'hash') declaration.ws.treeSha256 = '0'.repeat(64);
  if (variant === 'field') declaration.ws.other = true;
  expect(() => resolveTransportRuntime(declaration, root)).toThrow();
});

it('rejects package payload drift before staging even with unchanged metadata', () => {
  writeFileSync(path.join(root, 'node_modules/ws/index.js'), 'changed');
  expect(() => resolveTransportRuntime(declaration, root)).toThrow('bytes differ');
});

it.each(['changed', 'added', 'deleted'])('rejects %s payload after staging', (kind) => {
  const runtime = resolveTransportRuntime(declaration, root);
  stageTransportRuntime(runtime, capsule);
  const directory = path.join(root, 'node_modules/ws');
  if (kind === 'changed') writeFileSync(path.join(directory, 'index.js'), 'changed');
  if (kind === 'added') writeFileSync(path.join(directory, 'unexpected.js'), 'added');
  if (kind === 'deleted') unlinkSync(path.join(directory, 'index.js'));
  expect(() => verifyTransportRuntime(runtime, capsule)).toThrow('changed since staging');
});

it('rejects redirected links even with identical metadata and bytes', () => {
  const runtime = resolveTransportRuntime(declaration, root);
  stageTransportRuntime(runtime, capsule);
  const replacement = path.join(root, 'replacement');
  mkdirSync(replacement);
  for (const file of ['package.json', 'index.js']) writeFileSync(path.join(replacement, file), readFileSync(path.join(root, 'node_modules/ws', file)));
  unlinkSync(path.join(capsule, 'node_modules/ws'));
  symlinkSync(replacement, path.join(capsule, 'node_modules/ws'), 'junction');
  expect(() => verifyTransportRuntime(runtime, capsule)).toThrow('changed since staging');
});

it('rejects package-internal links instead of reading outside its tree', () => {
  symlinkSync(path.join(root, 'node_modules/tweetnacl'), path.join(root, 'node_modules/ws/escape'), 'junction');
  expect(() => snapshotTransportPackage(path.join(root, 'node_modules/ws'))).toThrow('symlink');
});

it('disables optional native peers per child without modifying the inherited environment', () => {
  const inherited = { KEEP: 'value', WS_NO_BUFFER_UTIL: '0', WS_NO_UTF_8_VALIDATE: '0' };
  expect(transportTestEnvironment(null, inherited)).toBe(inherited);
  expect(transportTestEnvironment([{}], inherited)).toEqual({ KEEP: 'value', WS_NO_BUFFER_UTIL: '1', WS_NO_UTF_8_VALIDATE: '1' });
  expect(inherited.WS_NO_BUFFER_UTIL).toBe('0');
});
