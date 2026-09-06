import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolvePackageRuntime, stagePackageRuntime, verifyPackageRuntime } from './capsule-package-runtime.mjs';

const NAMES = ['ws', 'tweetnacl'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function snapshotTransportPackage(packageRoot) {
  const files = [];
  let totalBytes = 0;
  let entries = 0;
  const walk = (relative) => {
    for (const name of readdirSync(path.join(packageRoot, relative)).sort()) {
      assert(++entries <= 4096, 'Transport package entry limit');
      const file = path.join(relative, name);
      const absolute = path.join(packageRoot, file);
      const stat = lstatSync(absolute);
      assert(!stat.isSymbolicLink(), `Transport package contains symlink: ${file}`);
      if (stat.isDirectory()) {
        assert(file.split(path.sep).length <= 16, 'Transport package depth limit');
        walk(file);
      } else {
        assert(stat.isFile(), `Transport package contains non-file: ${file}`);
        totalBytes += stat.size;
        assert(totalBytes <= 64 * 1024 * 1024 && files.length < 4096, 'Transport package size limit');
        files.push({ path: file.split(path.sep).join('/'), sha256: hash(readFileSync(absolute)) });
      }
    }
  };
  walk('');
  return { files, treeSha256: hash(JSON.stringify(files)), totalBytes };
}

export function resolveTransportRuntime(declaration, sourceRoot) {
  if (declaration === undefined) return null;
  assert(declaration && Object.keys(declaration).sort().join() === [...NAMES].sort().join(), 'Transport runtime requires ws and tweetnacl only');
  for (const name of NAMES) {
    const entry = declaration[name];
    assert(entry && Object.keys(entry).sort().join() === 'treeSha256,version', `Invalid transport declaration: ${name}`);
    assert(typeof entry.version === 'string' && /^[a-f0-9]{64}$/.test(entry.treeSha256), `Unpinned transport package: ${name}`);
  }
  const versions = Object.fromEntries(NAMES.map((name) => [name, declaration[name].version]));
  return resolvePackageRuntime(versions, sourceRoot, NAMES, 'Transport runtime').map((entry) => {
    const snapshot = snapshotTransportPackage(path.dirname(entry.packageFile));
    assert.equal(snapshot.treeSha256, declaration[entry.name].treeSha256, `Transport package bytes differ: ${entry.name}`);
    return { ...entry, ...snapshot };
  });
}

export const stageTransportRuntime = stagePackageRuntime;

export function verifyTransportRuntime(runtime, capsuleRoot) {
  verifyPackageRuntime(runtime, capsuleRoot);
  for (const entry of runtime ?? []) {
    const snapshot = snapshotTransportPackage(path.dirname(entry.packageFile));
    assert.equal(snapshot.treeSha256, entry.treeSha256, `Transport runtime changed since staging: ${entry.name}`);
  }
}

export function transportTestEnvironment(runtime, inherited = process.env) {
  if (!runtime) return inherited;
  // Optional native peer modules are outside the pinned two-package closure.
  return { ...inherited, WS_NO_BUFFER_UTIL: '1', WS_NO_UTF_8_VALIDATE: '1' };
}
