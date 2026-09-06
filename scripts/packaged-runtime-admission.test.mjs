import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bundlePaths, sealedBundleDigest } from "./desktop-artifacts.mjs";

// Rebound to the final sealed-bundle identity (2026-09-06): these invariants
// previously bound the partial fingerprintBundle receipt, which left the
// executable, framework bytes, Info.plist and dependency notices uncovered.
// The sealed digest covers every installed runtime byte from the detached
// acceptance report, so mutating any of them must change the identity.
async function makeSealedFixture(bundle) {
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

test("file content cannot impersonate a second sealed entry", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "drogon-seal-framing-"));
  context.after(() => rm(directory, { recursive: true }));
  const bundle = path.join(directory, "Drogon.app");
  await makeSealedFixture(bundle);
  const a = path.join(bundle, "a");
  const b = path.join(bundle, "b");
  await writeFile(a, "left");
  await writeFile(b, "right");
  await chmod(a, 0o600);
  await chmod(b, 0o600);
  const separate = await sealedBundleDigest(bundle, "darwin");
  await writeFile(a, ["left", "file:b", "600", "right"].join("\0"));
  await rm(b);
  const combined = await sealedBundleDigest(bundle, "darwin");
  assert.notEqual(
    combined.sealedDigest,
    separate.sealedDigest,
    "Different installed file trees must not share one acceptance identity",
  );
});

for (const defect of ["cyclic-link", "dangling-link", "desktop-file"]) {
  test(`sealed admission refuses ${defect}`, async (context) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "drogon-invalid-seal-"),
    );
    context.after(() => rm(directory, { recursive: true }));
    const bundle = path.join(directory, "Drogon.app");
    const { files } = await makeSealedFixture(bundle);
    if (defect === "desktop-file") {
      await rm(files.desktop, { recursive: true });
      await writeFile(files.desktop, "not a desktop directory");
    } else {
      await symlink(
        defect === "cyclic-link" ? "loop" : "absent",
        path.join(bundle, "loop"),
      );
    }
    await assert.rejects(sealedBundleDigest(bundle, "darwin"));
  });
}

// Bind these invariants to the final receipt identity when that API is introduced.
for (const relative of [
  "Contents/MacOS/Drogon",
  "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
  "Contents/Info.plist",
  "Contents/Resources/DEPENDENCY-NOTICES.txt",
]) {
  test(`final acceptance identity changes when ${relative} changes`, async (context) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "drogon-sealed-admission-"),
    );
    context.after(() => rm(directory, { recursive: true }));
    const bundle = path.join(directory, "Drogon.app");
    await makeSealedFixture(bundle);
    const changedFile = path.join(bundle, relative);
    const before = await sealedBundleDigest(bundle, "darwin");
    await writeFile(changedFile, "owned-fixture-replaced");
    const after = await sealedBundleDigest(bundle, "darwin");
    assert.notEqual(
      after.sealedDigest,
      before.sealedDigest,
      "A previously accepted receipt must not authorize different installed runtime bytes",
    );
  });
}
