import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import {
  APP_BUNDLE_ID,
  APP_ICON_BUILDER_FILE,
  APP_ICON_SOURCE_FILE,
  BUNDLE_ICON_FILE,
  STOCK_ELECTRON_ICON_FILE,
  bundleIconFile,
  bundlePaths,
  ensureAppIcon,
  fingerprintBundle,
  mentuRuntimeSignIgnore,
  verifiedBuildInfo,
} from "./desktop-artifacts.mjs";
import {
  MENTU_LOCK_REVISION,
  ensureOfficialMentuRuntime,
} from "./mentu-runtime-provision.mjs";
import { runAcceptanceProcess } from "./acceptance-process.mjs";
import { writePackageNotices } from "./package-notices.mjs";
import {
  assertProjectVersions,
  readProjectManifests,
  validateSemanticVersion,
  versionFromCliOutput,
} from "./release-version.mjs";

function releaseCliShim(version) {
  return `#!/bin/sh
set -eu
if [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then
  printf 'drogon-cli %s\\n' '${version}'
  exit 0
fi
bin_dir=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd -P)\"
exec \"$bin_dir/drogon-cli.native\" \"$@\"
`;
}

assert.equal(
  process.argv.length,
  2,
  "No cross-compilation or unverified/dirty installation flags are supported",
);
assert.ok(
  ["darwin", "linux"].includes(process.platform),
  "Windows runtime packaging awaits its native service implementation",
);
const root = fileURLToPath(new URL("..", import.meta.url));
async function git(args) {
  return (await runAcceptanceProcess("git", args, { cwd: root })).stdout.trim();
}
assert.equal(
  await git(["status", "--porcelain"]),
  "",
  "Package only a clean, integrated checkout",
);
const revision = await git(["rev-parse", "HEAD"]);
const { manifests } = await readProjectManifests(root);
const manifestVersion = assertProjectVersions(manifests);
const releaseVersion = process.env.DROGON_RELEASE_VERSION
  ? validateSemanticVersion(process.env.DROGON_RELEASE_VERSION)
  : null;
assert.equal(
  releaseVersion ?? manifestVersion,
  manifestVersion,
  releaseVersion
    ? `Release ${releaseVersion} does not match the package manifests (${manifestVersion})`
    : "",
);
const packageVersion = releaseVersion ?? manifestVersion;
const channel = process.env.DROGON_RELEASE_CHANNEL ?? "preview";
assert.ok(
  channel === "preview" || channel === "release",
  `Unknown package channel: ${channel}`,
);
const developerSigning =
  process.env.DROGON_RELEASE_SIGNING === "developer-id-notarized";
const signingIdentity = process.env.DROGON_SIGNING_IDENTITY?.trim() || "-";
if (developerSigning)
  assert.notEqual(
    signingIdentity,
    "-",
    "Developer ID release signing requires DROGON_SIGNING_IDENTITY",
  );
assert.ok(
  !signingIdentity || signingIdentity === "-" || developerSigning,
  "A non-ad-hoc signing identity requires DROGON_RELEASE_SIGNING=developer-id-notarized",
);
// The supported macOS package must never silently ship without Mentu.
if (process.platform === "darwin" && process.arch === "arm64") {
  await ensureOfficialMentuRuntime(root);
}
const desktopManifest = manifests.desktop;
await runAcceptanceProcess(
  "cargo",
  ["build", "--workspace", "--release", "--locked", "--offline"],
  { cwd: root, timeout: 1800000 },
);
await runAcceptanceProcess("pnpm", ["--filter", "@drogon/desktop", "build"], {
  cwd: root,
  timeout: 180000,
});
const distribution = path.join(root, "dist");
await mkdir(distribution, { recursive: true });
const staging = await mkdtemp(path.join(distribution, ".package-"));
const source = path.join(staging, "app");
const binaries = path.join(staging, "bin");
await cp(path.join(root, "apps", "desktop", "out"), source, {
  recursive: true,
  verbatimSymlinks: true,
});
await mkdir(binaries);
await cp(
  path.join(root, "target", "release", "drogond"),
  path.join(binaries, "drogond"),
);
await writeFile(
  path.join(source, "package.json"),
  JSON.stringify(
    {
      name: "drogon",
      productName: "Drogon",
      version: packageVersion,
      main: "main/index.js",
      private: true,
    },
    null,
    2,
  ) + "\n",
);
const nativeCli = path.join(root, "target", "release", "drogon-cli");
const cli = path.join(binaries, "drogon-cli");
const nativeCliVersion = versionFromCliOutput(
  (await runAcceptanceProcess(nativeCli, ["--version"], { cwd: root })).stdout,
);
if (releaseVersion && nativeCliVersion !== releaseVersion) {
  // Cargo package versions are deliberately kept at the compatibility base
  // in this coordinator-owned checkout. A release tag may be a prerelease,
  // so retain the native client beside a tiny entrypoint that gives users the
  // tag's exact semantic version while delegating every real command to it.
  await cp(nativeCli, `${cli}.native`);
  await writeFile(cli, releaseCliShim(releaseVersion), { mode: 0o755 });
  await chmod(cli, 0o755);
} else {
  await cp(nativeCli, cli);
}
const stopDaemon = path.join(binaries, "drogon-stop-daemon");
await cp(path.join(root, "scripts", "drogon-stop-daemon.sh"), stopDaemon);
await chmod(stopDaemon, 0o755);
const notices = path.join(staging, "DEPENDENCY-NOTICES.txt");
const noticeCount = await writePackageNotices(root, notices);
const info = {
  schema: 1,
  appBundleId: APP_BUNDLE_ID,
  revision,
  dirty: false,
  // Legacy partial build metadata for recovery only. The sealed
  // whole-bundle identity is computed AFTER final packaging/signing and
  // stored in the detached acceptance report, never embedded here: embedding
  // the sealed digest would change the bytes being hashed and force a
  // re-sign loop.
  provenance: "legacy-partial-build-metadata-not-final-proof",
  version: packageVersion,
  channel,
  signed:
    process.platform === "darwin"
      ? developerSigning
        ? "developer-id-notarized"
        : "local-ad-hoc-not-notarized"
      : false,
  builtAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  electronVersion: desktopManifest.devDependencies.electron,
};
const infoPath = path.join(staging, "build-info.json");
await writeFile(infoPath, JSON.stringify(info, null, 2) + "\n");
// Apple Silicon is provisioned above, including the official license.
// Other platforms retain their existing optional-runtime packaging.
const bundledMentuRuntime = path.join(
  root,
  "apps",
  "desktop",
  "resources",
  "mentu-runtime",
);
// R16-Z2 (#201) + R16-BO (#319): original Drogon icon. The .icns is a
// committed build artifact of apps/desktop/resources/icon.svg — a missing
// icon or one older than the SVG (or the builder) is rebuilt in-process
// through the same build-app-icon code path before any bundle byte exists,
// and a failed rebuild aborts here instead of shipping stock electron.icns.
const resourcesDir = path.join(root, "apps", "desktop", "resources");
const appIcon = path.join(resourcesDir, BUNDLE_ICON_FILE);
await ensureAppIcon({
  svg: path.join(resourcesDir, APP_ICON_SOURCE_FILE),
  icns: appIcon,
  builder: path.join(root, "scripts", APP_ICON_BUILDER_FILE),
});
const [packagedDirectory] = await packager({
  dir: source,
  name: "Drogon",
  icon: appIcon,
  executableName: "Drogon",
  appBundleId: APP_BUNDLE_ID,
  appVersion: info.version,
  buildVersion: String(Math.floor(Date.now() / 1000)),
  platform: process.platform,
  arch: process.arch,
  electronVersion: info.electronVersion,
  out: path.join(distribution, `${revision.slice(0, 12)}-${Date.now()}`),
  overwrite: false,
  asar: false,
  prune: false,
  extraResource: existsSync(bundledMentuRuntime)
    ? [binaries, infoPath, notices, bundledMentuRuntime]
    : [binaries, infoPath, notices],
  ...(process.platform === "darwin"
    ? {
        darwinDarkModeSupport: true,
        osxSign: {
          identity: signingIdentity,
          // Ad-hoc signing has no keychain certificate to discover.
          identityValidation: false,
          // osx-sign applies runtime policy per file, including helpers.
          optionsForFile: () => ({ hardenedRuntime: developerSigning }),
          // The pinned Mentu runtime ships byte-identical to the lock the
          // daemon verifies at install: signing it would append an
          // LC_CODE_SIGNATURE and break `mentu.runtime_install` (fork
          // parity: reference `mentuRuntimeSignIgnore` boundary).
          ignore: mentuRuntimeSignIgnore(MENTU_LOCK_REVISION),
        },
      }
    : {}),
});
const bundle =
  process.platform === "darwin"
    ? path.join(packagedDirectory, "Drogon.app")
    : packagedDirectory;
if (process.platform === "darwin") await renameBundleIcon(bundle);
Object.assign(info, await fingerprintBundle(bundle));

// @electron/packager copies the icon: bytes over
// Resources/electron.icns but keeps the stock plist name, so give the
// bundle its own icon file and name before sealing/signing (R16-Z2,
// #201). A future packager that names the file itself skips the rename;
// anything else fails closed instead of shipping the stock name.
async function renameBundleIcon(app) {
  const contents = path.join(app, "Contents");
  const resourcesDir = path.join(contents, "Resources");
  const current = await bundleIconFile(app);
  if (
    current === BUNDLE_ICON_FILE &&
    existsSync(path.join(resourcesDir, BUNDLE_ICON_FILE))
  )
    return;
  assert.equal(
    current,
    STOCK_ELECTRON_ICON_FILE,
    `Unexpected bundle icon name ${current}: refusing to guess the rename`,
  );
  await runAcceptanceProcess("/bin/mv", [
    path.join(resourcesDir, STOCK_ELECTRON_ICON_FILE),
    path.join(resourcesDir, BUNDLE_ICON_FILE),
  ]);
  await runAcceptanceProcess(
    "/usr/libexec/PlistBuddy",
    [
      "-c",
      `Set :CFBundleIconFile ${BUNDLE_ICON_FILE}`,
      path.join(contents, "Info.plist"),
    ],
    { timeout: 30000 },
  );
  assert.equal(await bundleIconFile(app), BUNDLE_ICON_FILE);
}
await writeFile(bundlePaths(bundle).info, JSON.stringify(info, null, 2) + "\n");
if (process.platform === "darwin") {
  // Refresh the outer seal after stamping final signed-binary fingerprints.
  const finalSigningArgs = ["--force", "--sign", signingIdentity];
  if (developerSigning)
    finalSigningArgs.push("--options", "runtime", "--timestamp");
  finalSigningArgs.push(bundle);
  await runAcceptanceProcess("/usr/bin/codesign", finalSigningArgs, {
    timeout: 60000,
  });
  await runAcceptanceProcess(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", bundle],
    { timeout: 60000 },
  );
}
assert.equal(
  await git(["status", "--porcelain"]),
  "",
  "Checkout changed during packaging",
);
assert.equal(await git(["rev-parse", "HEAD"]), revision);
await verifiedBuildInfo(bundle);
console.log(
  JSON.stringify({
    status: "PACKAGED",
    bundle,
    revision,
    artifactDigest: info.artifactDigest,
    noticeCount,
    signed: info.signed,
  }),
);
