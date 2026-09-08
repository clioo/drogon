import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  APP_BUNDLE_ID,
  BUNDLE_ICON_FILE,
  STOCK_ELECTRON_ICON_FILE,
  bundleIconFile,
  bundlePaths,
  fingerprintBundle,
  mentuRuntimeSignIgnore,
  previewArchiveName,
  sealedBundleDigest,
  treeDigest,
  verifiedBuildInfo,
} from "./desktop-artifacts.mjs";
import {
  assertIconRaster,
  decodePng,
  iconRasterStats,
} from "./build-app-icon.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function fixturePlist(iconFile) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ` +
    `"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0"><dict>\n` +
    `  <key>CFBundleIconFile</key>\n` +
    `  <string>${iconFile}</string>\n` +
    `</dict></plist>\n`
  );
}

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
  await writeFile(files.plist, fixturePlist(BUNDLE_ICON_FILE));
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
  await writeFile(files.info, JSON.stringify(info));
  await writeFile(files.plist, fixturePlist(STOCK_ELECTRON_ICON_FILE));
  await assert.rejects(
    () => verifiedBuildInfo(bundle, "darwin"),
    /not stock electron\.icns/,
  );
  await writeFile(files.plist, fixturePlist(BUNDLE_ICON_FILE));
  assert.equal((await verifiedBuildInfo(bundle, "darwin")).revision, info.revision);
});

test("bundleIconFile reads the plist tag and stays null off macOS", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "drogon-icon-"));
  context.after(() => rm(directory, { recursive: true }));
  const bundle = path.join(directory, "Drogon.app");
  const files = bundlePaths(bundle, "darwin");
  await mkdir(path.dirname(files.plist), { recursive: true });
  await writeFile(files.plist, fixturePlist(BUNDLE_ICON_FILE));
  assert.equal(await bundleIconFile(bundle, "darwin"), BUNDLE_ICON_FILE);
  await writeFile(files.plist, fixturePlist(STOCK_ELECTRON_ICON_FILE));
  assert.equal(await bundleIconFile(bundle, "darwin"), STOCK_ELECTRON_ICON_FILE);
  assert.equal(await bundleIconFile(bundle, "linux"), null);
});

test("committed icon.icns is a real iconset, not the stock Electron icon", async (context) => {
  const icns = path.join(root, "apps", "desktop", "resources", "icon.icns");
  assert.ok(existsSync(icns), "run node scripts/build-app-icon.mjs");
  const bytes = await readFile(icns);
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "icns");
  assert.ok(bytes.length > 10_000, "Suspiciously small icon.icns");
  const appRequire = createRequire(path.join(root, "apps", "desktop", "package.json"));
  let stock = null;
  try {
    const electronDir = path.dirname(appRequire.resolve("electron/package.json"));
    const candidate = path.join(
      electronDir,
      "dist",
      "Electron.app",
      "Contents",
      "Resources",
      STOCK_ELECTRON_ICON_FILE,
    );
    if (existsSync(candidate)) stock = candidate;
  } catch {
    stock = null;
  }
  if (!stock) {
    context.skip("stock Electron.app not installed for this platform");
    return;
  }
  const stockBytes = await readFile(stock);
  assert.notEqual(
    createHash("sha256").update(bytes).digest("hex"),
    createHash("sha256").update(stockBytes).digest("hex"),
    "icon.icns must differ from the stock Electron icon",
  );
});

test("committed icon.png keeps the dark tile, flame and transparent corners", async () => {
  // Regression guard for #201: a white-key fallback once shipped a white
  // blob on transparent. decodePng is dependency-free so this runs anywhere.
  const png = path.join(root, "apps", "desktop", "resources", "icon.png");
  assert.ok(existsSync(png), "run node scripts/build-app-icon.mjs");
  const stats = iconRasterStats(decodePng(await readFile(png)));
  assertIconRaster(stats, "apps/desktop/resources/icon.png");
});

test("sealed-bundle identity covers the icon bytes", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "drogon-icon-"));
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
    files.info,
    files.notices,
    files.icon,
  ])
    await writeFile(file, "fixture-only");
  await writeFile(files.plist, fixturePlist(BUNDLE_ICON_FILE));
  const before = await sealedBundleDigest(bundle, "darwin");
  await writeFile(files.icon, "replacement-artwork");
  const after = await sealedBundleDigest(bundle, "darwin");
  assert.notEqual(
    after.sealedDigest,
    before.sealedDigest,
    "A swapped icon must change the sealed final-artifact identity",
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

test("mentu signing boundary preserves only the exact nested runtime", () => {
  const revision = "b".repeat(40);
  const ignore = mentuRuntimeSignIgnore(revision);
  const packaged = `/tmp/Drogon.app/Contents/Resources/mentu-runtime/${revision}/bin/mentu-recipes`;
  assert.equal(ignore(packaged), true);
  for (const unrelated of [
    `${packaged}.replacement`,
    `${packaged}/child`,
    packaged.replace(revision, "a".repeat(40)),
    packaged.replace("mentu-runtime", "unrelated-runtime"),
    "/tmp/Drogon.app/Contents/MacOS/Drogon",
    "/tmp/Drogon.app/Contents/Resources/mentu-runtime",
    null,
    undefined,
  ]) {
    assert.equal(ignore(unrelated), false, String(unrelated));
  }
});

test("mentu signing boundary rejects a malformed revision", () => {
  assert.throws(() => mentuRuntimeSignIgnore("short"), /[a-f0-9]/);
});
