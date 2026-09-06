import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resolveRendererRuntime, stageRendererRuntime, verifyRendererRuntime } from './renderer-capsule-runtime.mjs';

let root;
let capsule;
const versions = { react: '19.2.8', 'react-dom': '19.2.8', 'happy-dom': '20.11.8' };
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'renderer-runtime-'));
  capsule = path.join(root, 'capsule');
  mkdirSync(capsule);
  for (const [name, version] of Object.entries(versions)) {
    const directory = path.join(root, 'node_modules', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version }));
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('leaves node-only capsules unchanged', () => {
  expect(resolveRendererRuntime(undefined, root)).toBeNull();
  stageRendererRuntime(null, capsule);
  verifyRendererRuntime(null, capsule);
});
it('pins and links only the declared renderer packages without copying or changing them', () => {
  const runtime = resolveRendererRuntime(versions, root);
  expect(runtime.map((item) => item.name)).toEqual(Object.keys(versions));
  stageRendererRuntime(runtime, capsule);
  verifyRendererRuntime(runtime, capsule);
  expect(JSON.parse(readFileSync(path.join(capsule, 'node_modules/react/package.json'))).version).toBe('19.2.8');
});
it.each([{}, { ...versions, unknown: '1' }, { ...versions, react: '18' }])('refuses incomplete, widened or mismatched runtime %j', (declaration) => {
  expect(() => resolveRendererRuntime(declaration, root)).toThrow();
});
it('refuses runtime metadata drift before execution', () => {
  const runtime = resolveRendererRuntime(versions, root);
  stageRendererRuntime(runtime, capsule);
  writeFileSync(runtime[0].packageFile, JSON.stringify({ name: 'react', version: '18' }));
  expect(() => verifyRendererRuntime(runtime, capsule)).toThrow('changed since staging');
});
it('refuses a redirected runtime link even with identical package metadata', () => {
  const runtime = resolveRendererRuntime(versions, root);
  stageRendererRuntime(runtime, capsule);
  const replacement = path.join(root, 'replacement');
  mkdirSync(replacement);
  writeFileSync(path.join(replacement, 'package.json'), readFileSync(runtime[0].packageFile));
  const link = path.join(capsule, 'node_modules/react');
  unlinkSync(link);
  symlinkSync(replacement, link, 'junction');
  expect(() => verifyRendererRuntime(runtime, capsule)).toThrow('changed since staging');
});
