import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import path from 'node:path';

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export function resolvePackageRuntime(declaration, sourceRoot, names, label) {
  if (declaration === undefined) return null;
  if (!declaration || Object.keys(declaration).sort().join() !== [...names].sort().join()) {
    throw new Error(`${label} must pin exactly ${names.join(', ')} versions.`);
  }
  const require = createRequire(path.join(path.resolve(sourceRoot), 'package.json'));
  return names.map((name) => {
    const packageFile = realpathSync(require.resolve(`${name}/package.json`));
    const metadata = JSON.parse(readFileSync(packageFile, 'utf8'));
    if (typeof declaration[name] !== 'string' || metadata.name !== name || metadata.version !== declaration[name]) {
      throw new Error(`${label} version mismatch for ${name}.`);
    }
    return { name, version: metadata.version, packageFile, packageSha256: digest(packageFile) };
  });
}

export function stagePackageRuntime(runtime, capsuleRoot) {
  if (!runtime) return;
  const modules = path.join(capsuleRoot, 'node_modules');
  mkdirSync(modules);
  for (const entry of runtime) {
    symlinkSync(path.dirname(entry.packageFile), path.join(modules, entry.name), 'junction');
  }
}

export function verifyPackageRuntime(runtime, capsuleRoot) {
  if (!runtime) return;
  for (const entry of runtime) {
    const linked = path.join(capsuleRoot, 'node_modules', entry.name, 'package.json');
    if (realpathSync(linked) !== entry.packageFile || digest(linked) !== entry.packageSha256) {
      throw new Error(`Package runtime changed since staging: ${entry.name}.`);
    }
  }
}
