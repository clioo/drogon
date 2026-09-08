import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
import { MENTU_LOCK_REVISION } from "./mentu-runtime-provision.mjs";
import { runAcceptanceProcess } from "./acceptance-process.mjs";
import { writePackageNotices } from "./package-notices.mjs";

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
const desktopManifest = JSON.parse(
  await readFile(path.join(root, "apps", "desktop", "package.json"), "utf8"),
);
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
for (const name of ["drogond", "drogon-cli"])
  await cp(
    path.join(root, "target", "release", name),
    path.join(binaries, name),
  );
await writeFile(
  path.join(source, "package.json"),
  JSON.stringify(
    {
      name: "drogon",
      productName: "Drogon",
      version: desktopManifest.version,
      main: "main/index.js",
      private: true,
    },
    null,
    2,
  ) + "\n",
);
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
  version: desktopManifest.version,
  builtAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  electronVersion: desktopManifest.devDependencies.electron,
};
const infoPath = path.join(staging, "build-info.json");
await writeFile(infoPath, JSON.stringify(info, null, 2) + "\n");
// Additive, optional: a runtime staged by
// `scripts/mentu-runtime-provision.mjs` (gitignored, never committed).
// Ships it when present, skips cleanly otherwise — the sealed acceptance
// stays green without it, same as before this runtime existed.
const bundledMentuRuntime = path.join(root, "apps", "desktop", "resources", "mentu-runtime");
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
          identity: "-",
          // Ad-hoc signing has no keychain certificate to discover.
          identityValidation: false,
          // osx-sign applies runtime policy per file, including helpers.
          optionsForFile: () => ({ hardenedRuntime: false }),
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
  await runAcceptanceProcess(
    "/usr/bin/codesign",
    ["--force", "--sign", "-", bundle],
    { timeout: 60000 },
  );
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
    signed:
      process.platform === "darwin" ? "local-ad-hoc-not-notarized" : false,
  }),
);
