import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertProjectVersions,
  readProjectManifests,
  validateSemanticVersion,
  versionFromCliOutput,
  versionFromTag,
} from "./release-version.mjs";
import {
  checkPackageVersions,
  synchronizePackageVersions,
} from "./bump-version.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "drogon-release-version-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "root", version: "0.1.0" }, null, 2) + "\n",
  );
  await mkdir(path.join(root, "apps", "desktop"), { recursive: true });
  await writeFile(
    path.join(root, "apps", "desktop", "package.json"),
    JSON.stringify({ name: "desktop", version: "0.1.0" }, null, 2) + "\n",
  );
  return root;
}

test("release tags and manifest versions accept prereleases but reject malformed values", () => {
  assert.equal(versionFromTag("v0.1.0-rc.2"), "0.1.0-rc.2");
  assert.equal(validateSemanticVersion("1.2.3+build.4"), "1.2.3+build.4");
  assert.throws(() => versionFromTag("0.1.0"), /start with v/);
  assert.throws(
    () => validateSemanticVersion("1.2"),
    /Invalid semantic version/,
  );
  assert.throws(() => validateSemanticVersion("1.2.3-01"), /leading zeroes/);
});

test("CLI version parsing handles clap output and bare output", () => {
  assert.equal(versionFromCliOutput("drogon-cli 0.1.0-rc.2\n"), "0.1.0-rc.2");
  assert.equal(versionFromCliOutput("0.1.0"), "0.1.0");
  assert.throws(
    () => versionFromCliOutput("drogon-cli development"),
    /semantic version/,
  );
});

test("bump-version updates and then verifies both package manifests", async (context) => {
  const root = await fixture();
  context.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(await checkPackageVersions(root), "0.1.0");
  await synchronizePackageVersions(root, "0.1.0-rc.1");
  assert.equal(await checkPackageVersions(root, "0.1.0-rc.1"), "0.1.0-rc.1");
  const { manifests } = await readProjectManifests(root);
  assert.equal(manifests.workspace.version, "0.1.0-rc.1");
  assert.equal(manifests.desktop.version, "0.1.0-rc.1");
  assert.equal(
    JSON.parse(await readFile(path.join(root, "package.json"))).name,
    "root",
  );
  assert.throws(
    () => assertProjectVersions(manifests, "0.1.0-rc.2"),
    /does not match release/,
  );
});
