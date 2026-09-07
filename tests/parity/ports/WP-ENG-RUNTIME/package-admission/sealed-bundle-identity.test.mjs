import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  SEALED_BUNDLE_VERSION,
  assertSealedInstallAuthorization,
  bundlePaths,
  sealedBundleDigest,
  verifySealedBundle,
} from "../../../../../scripts/desktop-artifacts.mjs";

async function makeCompleteFixture(bundle) {
  const files = bundlePaths(bundle, "darwin");
  const framework = path.join(
    bundle,
    "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
  );
  for (const file of [
    files.executable,
    files.cli,
    files.daemon,
    files.info,
    files.notices,
    files.plist,
    path.join(files.desktop, "index.js"),
    framework,
  ]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "owned-fixture-original");
  }
  return { files, framework };
}

async function freshBundle(context) {
  const directory = await mkdtemp(path.join(tmpdir(), "drogon-sealed-"));
  context.after(() => rm(directory, { recursive: true }));
  const bundle = path.join(directory, "Drogon.app");
  await makeCompleteFixture(bundle);
  return bundle;
}

test("sealed identity is deterministic across repeated sealing", async (context) => {
  const bundle = await freshBundle(context);
  const first = await sealedBundleDigest(bundle, "darwin");
  const second = await sealedBundleDigest(bundle, "darwin");
  assert.equal(second.sealedDigest, first.sealedDigest);
  assert.equal(second.fileCount, first.fileCount);
  assert.equal(second.totalBytes, first.totalBytes);
  assert.equal(first.sealedVersion, SEALED_BUNDLE_VERSION);
});

test("sealed identity covers ordinary file modes", async (context) => {
  const bundle = await freshBundle(context);
  const executable = bundlePaths(bundle, "darwin").executable;
  const before = await sealedBundleDigest(bundle, "darwin");
  const current = (await stat(executable)).mode & 0o777;
  const flipped = current & 0o100 ? 0o644 : 0o755;
  assert.notEqual(flipped, current);
  await chmod(executable, flipped);
  const after = await sealedBundleDigest(bundle, "darwin");
  assert.notEqual(after.sealedDigest, before.sealedDigest);
});

test("sealed identity allows legitimate in-bundle symlinks", async (context) => {
  const bundle = await freshBundle(context);
  const versions = path.join(
    bundle,
    "Contents/Frameworks/Electron Framework.framework/Versions",
  );
  await symlink("A", path.join(versions, "Current"));
  const first = await sealedBundleDigest(bundle, "darwin");
  const second = await sealedBundleDigest(bundle, "darwin");
  assert.equal(second.sealedDigest, first.sealedDigest);
});

test("sealed identity refuses symlinks escaping the bundle", async (context) => {
  const bundle = await freshBundle(context);
  const outside = path.join(path.dirname(bundle), "outside.txt");
  await writeFile(outside, "outside the bundle");
  await symlink(outside, path.join(bundle, "Contents", "escape"));
  await assert.rejects(() => sealedBundleDigest(bundle, "darwin"), /escape/);
});

test("sealed identity refuses chained symlinks escaping the bundle", async (context) => {
  const bundle = await freshBundle(context);
  const outside = path.join(path.dirname(bundle), "outside.txt");
  await writeFile(outside, "outside the bundle");
  await symlink(outside, path.join(bundle, "hop"));
  await symlink("hop", path.join(bundle, "skip"));
  await assert.rejects(() => sealedBundleDigest(bundle, "darwin"), /escape/);
});

test("sealed identity refuses chained cyclic symlinks", async (context) => {
  const bundle = await freshBundle(context);
  await symlink("b", path.join(bundle, "a"));
  await symlink("a", path.join(bundle, "b"));
  await assert.rejects(() => sealedBundleDigest(bundle, "darwin"), /cyclic/);
});

test("sealed identity refuses chained dangling symlinks", async (context) => {
  const bundle = await freshBundle(context);
  await symlink("absent", path.join(bundle, "b"));
  await symlink("b", path.join(bundle, "a"));
  await assert.rejects(() => sealedBundleDigest(bundle, "darwin"), /dangling/);
});

test("sealed identity requires ordinary files at runtime paths", async (context) => {
  const bundle = await freshBundle(context);
  const files = bundlePaths(bundle, "darwin");
  await rm(files.daemon);
  await symlink(
    path.relative(path.dirname(files.daemon), files.cli),
    files.daemon,
  );
  await assert.rejects(
    () => sealedBundleDigest(bundle, "darwin"),
    /Missing expected runtime file/,
  );
});

test("sealed identity enforces small traversal bounds without big allocation", async (context) => {
  const bundle = await freshBundle(context);
  await assert.rejects(
    () => sealedBundleDigest(bundle, "darwin", { maxFileBytes: 8 }),
    /file bound/,
  );
  await assert.rejects(
    () => sealedBundleDigest(bundle, "darwin", { maxTotalBytes: 10 }),
    /byte bound/,
  );
  await assert.rejects(
    () => sealedBundleDigest(bundle, "darwin", { maxEntries: 2 }),
    /entry bound/,
  );
});

test("sealed identity refuses missing expected runtime files", async (context) => {
  const bundle = await freshBundle(context);
  await rm(bundlePaths(bundle, "darwin").executable);
  await assert.rejects(
    () => sealedBundleDigest(bundle, "darwin"),
    /Missing expected runtime file/,
  );
});

test("sealed identity refuses file-to-escape substitution", async (context) => {
  const bundle = await freshBundle(context);
  const files = bundlePaths(bundle, "darwin");
  const outside = path.join(path.dirname(bundle), "outside.txt");
  await writeFile(outside, "outside the bundle");
  await rm(files.daemon);
  await symlink(outside, files.daemon);
  await assert.rejects(() => sealedBundleDigest(bundle, "darwin"), /escape/);
});

test("sealed verification fails closed on a changed candidate", async (context) => {
  const bundle = await freshBundle(context);
  const sealed = await sealedBundleDigest(bundle, "darwin");
  await verifySealedBundle(bundle, sealed, "darwin");
  await writeFile(bundlePaths(bundle, "darwin").cli, "owned-fixture-replaced");
  await assert.rejects(
    () => verifySealedBundle(bundle, sealed, "darwin"),
    /identity mismatch/,
  );
});

test("sealed verification refuses legacy metadata-only receipts", async (context) => {
  const bundle = await freshBundle(context);
  await assert.rejects(
    () => verifySealedBundle(bundle, undefined, "darwin"),
    /legacy metadata-only/,
  );
  await assert.rejects(
    () =>
      verifySealedBundle(
        bundle,
        { sealedVersion: 0, sealedDigest: "0".repeat(64) },
        "darwin",
      ),
    /unknown identity version/,
  );
});

function sealedReport(sealed) {
  return {
    kind: "packaged-desktop",
    status: "PASSED",
    sealedVersion: sealed.sealedVersion,
    sealedDigest: sealed.sealedDigest,
  };
}

test("install authorization fails closed on tampered digests", async (context) => {
  const bundle = await freshBundle(context);
  const sealed = await sealedBundleDigest(bundle, "darwin");
  const report = sealedReport(sealed);
  assert.equal(
    assertSealedInstallAuthorization({
      report,
      candidateDigest: sealed.sealedDigest,
      stagedDigest: sealed.sealedDigest,
      targetDigest: sealed.sealedDigest,
    }),
    true,
  );
  const tampered = `f${sealed.sealedDigest.slice(1)}`;
  assert.notEqual(tampered, sealed.sealedDigest);
  for (const field of ["candidateDigest", "stagedDigest", "targetDigest"]) {
    await assert.rejects(
      async () =>
        assertSealedInstallAuthorization({
          report,
          candidateDigest: sealed.sealedDigest,
          stagedDigest: sealed.sealedDigest,
          targetDigest: sealed.sealedDigest,
          [field]: tampered,
        }),
      /differs from the accepted sealed final artifact/,
    );
  }
});

test("install authorization refuses legacy reports without sealed identity", async () => {
  const legacy = {
    kind: "packaged-desktop",
    status: "PASSED",
    revision: "a".repeat(40),
    artifactDigest: "b".repeat(64),
  };
  assert.throws(
    () => assertSealedInstallAuthorization({ report: legacy }),
    /Legacy metadata-only receipts must not authorize/,
  );
  assert.throws(
    () =>
      assertSealedInstallAuthorization({
        report: { ...legacy, sealedVersion: 0, sealedDigest: "0".repeat(64) },
      }),
    /Legacy metadata-only/,
  );
});
