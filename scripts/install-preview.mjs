import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  symlink,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_BUNDLE_ID,
  assertSealedInstallAuthorization,
  previewArchiveName,
  verifiedBuildInfo,
  verifySealedBundle,
} from "./desktop-artifacts.mjs";
import { runAcceptanceProcess } from "./acceptance-process.mjs";

const args = process.argv.slice(2);
assert.equal(
  process.platform,
  "darwin",
  "This per-user preview installer currently targets macOS",
);
assert.equal(
  args.length,
  4,
  "Usage: node scripts/install-preview.mjs --bundle <Drogon.app> --report <packaged acceptance report>",
);
assert.equal(args[0], "--bundle");
assert.equal(args[2], "--report");
const source = await realpath(args[1]);
const info = await verifiedBuildInfo(source);
const report = JSON.parse(await readFile(args[3], "utf8"));
assert.equal(report.kind, "packaged-desktop");
assert.equal(
  report.status,
  "PASSED",
  "The packaged app must pass acceptance before installation",
);
assert.equal(report.revision, info.revision);
assert.equal(report.artifactDigest, info.artifactDigest);
assert.equal(await realpath(report.bundle), source);
// Sealed final-artifact admission: legacy metadata-only reports without a
// detached sealed identity fail closed here and never authorize an install.
const candidateSealed = await verifySealedBundle(source, report);
assertSealedInstallAuthorization({
  report,
  candidateDigest: candidateSealed.sealedDigest,
});
await runAcceptanceProcess(
  "/usr/bin/codesign",
  ["--verify", "--deep", "--strict", source],
  { timeout: 60000 },
);
const identity = (
  await runAcceptanceProcess("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    path.join(source, "Contents", "Info.plist"),
  ])
).stdout.trim();
assert.equal(identity, APP_BUNDLE_ID);
const applications = path.join(homedir(), "Applications");
await mkdir(applications, { recursive: true });
assert.ok(
  (await lstat(applications)).isDirectory(),
  "Refuse a redirected Applications directory",
);
const builds = path.join(applications, ".drogon-builds");
await mkdir(builds, { recursive: true, mode: 0o700 });
assert.ok(
  (await lstat(builds)).isDirectory(),
  "Refuse a redirected build archive",
);
const lockPath = path.join(builds, "install.lock");
const lock = await open(lockPath, "wx", 0o600);
const lockIdentity = await lock.stat();
await lock.writeFile(
  JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
);
const current = path.join(applications, "Drogon.app");
let previous = null;
try {
  let existing;
  try {
    existing = await lstat(current);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing) {
    assert.ok(
      existing.isSymbolicLink(),
      "Existing Drogon.app is not managed by this installer; preserving it",
    );
    previous = await realpath(current);
    const relative = path.relative(builds, previous);
    assert.ok(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
      "Refuse to replace an unrelated application link",
    );
    await verifiedBuildInfo(previous);
  }
  const finalDirectory = path.join(
    builds,
    previewArchiveName(info, candidateSealed),
  );
  const target = path.join(finalDirectory, "Drogon.app");
  let exists = false;
  try {
    await lstat(finalDirectory);
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!exists) {
    const staged = await mkdtemp(path.join(builds, ".stage-"));
    await cp(source, path.join(staged, "Drogon.app"), {
      recursive: true,
      verbatimSymlinks: true,
    });
    await verifiedBuildInfo(path.join(staged, "Drogon.app"));
    const stagedSealed = await verifySealedBundle(
      path.join(staged, "Drogon.app"),
      report,
    );
    assertSealedInstallAuthorization({
      report,
      candidateDigest: candidateSealed.sealedDigest,
      stagedDigest: stagedSealed.sealedDigest,
    });
    await rename(staged, finalDirectory);
  }
  assert.equal(
    (await verifiedBuildInfo(target)).artifactDigest,
    info.artifactDigest,
  );
  // Existing-target reuse still proves the exact sealed identity: a reused
  // directory left by an earlier install is re-verified, never trusted.
  const targetSealed = await verifySealedBundle(target, report);
  assertSealedInstallAuthorization({
    report,
    candidateDigest: candidateSealed.sealedDigest,
    targetDigest: targetSealed.sealedDigest,
  });
  const pendingLink = path.join(applications, `.drogon-link-${randomUUID()}`);
  await symlink(path.relative(applications, target), pendingLink);
  await rename(pendingLink, current);
  const root = fileURLToPath(new URL("..", import.meta.url));
  console.log(
    JSON.stringify({
      status: "INSTALLED",
      application: current,
      bundle: target,
      revision: info.revision,
      previousBundle: previous,
      recovery:
        "Previous immutable builds and all user data are retained; no process was stopped.",
      source: root,
    }),
  );
} finally {
  await lock.close();
  const currentLock = await lstat(lockPath).catch(() => null);
  if (
    currentLock?.ino === lockIdentity.ino &&
    currentLock?.dev === lockIdentity.dev
  )
    await unlink(lockPath);
}
