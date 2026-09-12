import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertProjectVersions,
  readProjectManifests,
  validateSemanticVersion,
} from "./release-version.mjs";

/**
 * Updates only the two JavaScript manifests that own the distributable
 * version. Rust package versions remain the workspace's compatibility base;
 * release packaging stamps the public CLI entry point with the tag version.
 */
export async function synchronizePackageVersions(root, version) {
  validateSemanticVersion(version);
  const { files, manifests } = await readProjectManifests(root);
  for (const manifest of Object.values(manifests)) manifest.version = version;
  for (const [name, file] of Object.entries(files)) {
    await writeFile(file, JSON.stringify(manifests[name], null, 2) + "\n");
  }
  assert.equal(
    assertProjectVersions(manifests, version),
    version,
    "Package manifests did not converge on the requested version",
  );
  return { version, files: Object.values(files) };
}

export async function checkPackageVersions(root, expected = null) {
  const { manifests } = await readProjectManifests(root);
  return assertProjectVersions(manifests, expected);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/bump-version.mjs <X.Y.Z[-prerelease]>",
    "  node scripts/bump-version.mjs --check [X.Y.Z[-prerelease]]",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  if (argv[0] === "--check") {
    assert.ok(argv.length <= 2, usage());
    const version = await checkPackageVersions(root, argv[1] ?? null);
    console.log(JSON.stringify({ status: "IN_SYNC", version }));
    return;
  }
  assert.equal(argv.length, 1, usage());
  const version = validateSemanticVersion(argv[0]);
  const result = await synchronizePackageVersions(root, version);
  console.log(JSON.stringify({ status: "UPDATED", ...result }));
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) await main();
