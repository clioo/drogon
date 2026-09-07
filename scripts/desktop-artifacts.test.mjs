import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  APP_BUNDLE_ID,
  bundlePaths,
  fingerprintBundle,
  previewArchiveName,
  treeDigest,
  verifiedBuildInfo,
} from "./desktop-artifacts.mjs";

test("distinct accepted runtime seals cannot reuse the same preview archive", () => {
  const info = { revision: "a".repeat(40), artifactDigest: "b".repeat(64) };
  const first = { sealedVersion: 3, sealedDigest: "c".repeat(64) };
  const second = { ...first, sealedDigest: "c".repeat(63) + "d" };
  assert.notEqual(
    previewArchiveName(info, first),
    previewArchiveName(info, second),
  );
  assert.equal(
    previewArchiveName(info, first),
    previewArchiveName(info, { ...first }),
  );
});

test("a committed package must match every native and desktop fingerprint", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "drogon-artifacts-"));
  context.after(() => rm(directory, { recursive: true }));
  const bundle = path.join(directory, "Drogon.app");
  const files = bundlePaths(bundle, "darwin");
  for (const item of [
    files.desktop,
    path.dirname(files.executable),
    path.dirname(files.cli),
  ])
    await mkdir(item, { recursive: true });
  for (const file of [
    files.executable,
    files.cli,
    files.daemon,
    path.join(files.desktop, "index.js"),
  ])
    await writeFile(file, "fixture-only");
  const info = {
    schema: 1,
    appBundleId: APP_BUNDLE_ID,
    revision: "a".repeat(40),
    dirty: false,
    platform: "darwin",
    arch: process.arch,
    ...(await fingerprintBundle(bundle, "darwin")),
  };
  await writeFile(files.info, JSON.stringify(info));
  assert.equal(
    (await verifiedBuildInfo(bundle, "darwin")).revision,
    info.revision,
  );
  await writeFile(files.cli, "changed");
  await assert.rejects(
    () => verifiedBuildInfo(bundle, "darwin"),
    /artifacts changed/,
  );
  await writeFile(files.cli, "fixture-only");
  await writeFile(files.info, JSON.stringify({ ...info, dirty: true }));
  await assert.rejects(
    () => verifiedBuildInfo(bundle, "darwin"),
    /committed previews/,
  );
});

test(
  "desktop fingerprints refuse redirects outside packaged output",
  { skip: process.platform === "win32" },
  async (context) => {
    const directory = await mkdtemp(path.join(tmpdir(), "drogon-artifacts-"));
    context.after(() => rm(directory, { recursive: true }));
    await symlink("/etc/passwd", path.join(directory, "unexpected"));
    await assert.rejects(() => treeDigest(directory), /Unexpected link/);
  },
);
