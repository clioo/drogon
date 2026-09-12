import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Accepts the semantic versions that can be used in a Git tag and in an
 * Electron app manifest. Prerelease versions are intentionally supported:
 * the release lane uses v0.1.0-rc.N before the first stable release.
 */
export function validateSemanticVersion(value) {
  assert.equal(typeof value, "string", "Version must be a string");
  const match = VERSION_RE.exec(value);
  assert.ok(match, `Invalid semantic version: ${value}`);
  for (const identifier of (match[4] ?? "").split(".").filter(Boolean)) {
    if (/^\d+$/.test(identifier))
      assert.ok(
        identifier === "0" || !identifier.startsWith("0"),
        `Numeric prerelease identifiers cannot have leading zeroes: ${value}`,
      );
  }
  return value;
}

export function versionFromTag(tag) {
  assert.equal(typeof tag, "string", "Release tag must be a string");
  assert.match(tag, /^v/, `Release tag must start with v: ${tag}`);
  return validateSemanticVersion(tag.slice(1));
}

export async function readProjectManifests(root) {
  const files = {
    workspace: path.join(root, "package.json"),
    desktop: path.join(root, "apps", "desktop", "package.json"),
  };
  const manifests = {};
  for (const [name, file] of Object.entries(files)) {
    manifests[name] = JSON.parse(await readFile(file, "utf8"));
  }
  return { files, manifests };
}

export function assertProjectVersions(manifests, expected = null) {
  const workspaceVersion = manifests.workspace?.version;
  const desktopVersion = manifests.desktop?.version;
  assert.equal(
    typeof workspaceVersion,
    "string",
    "package.json must contain a version",
  );
  assert.equal(
    typeof desktopVersion,
    "string",
    "apps/desktop/package.json must contain a version",
  );
  validateSemanticVersion(workspaceVersion);
  validateSemanticVersion(desktopVersion);
  assert.equal(
    workspaceVersion,
    desktopVersion,
    `Workspace and desktop versions differ (${workspaceVersion} vs ${desktopVersion})`,
  );
  if (expected !== null)
    assert.equal(
      workspaceVersion,
      validateSemanticVersion(expected),
      `Manifest version ${workspaceVersion} does not match release ${expected}`,
    );
  return workspaceVersion;
}

/** Extracts the version from either clap's "drogon-cli X.Y.Z" output or a bare version. */
export function versionFromCliOutput(output) {
  const text = String(output).trim();
  const match = text.match(
    /(?:^|\s)(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)\s*$/,
  );
  assert.ok(
    match,
    `Could not read a semantic version from drogon-cli output: ${text}`,
  );
  return validateSemanticVersion(match[1]);
}

export const RELEASE_MANIFEST_PATHS = Object.freeze([
  "package.json",
  "apps/desktop/package.json",
]);
