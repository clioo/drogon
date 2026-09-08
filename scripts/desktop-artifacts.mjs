import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";

export const APP_BUNDLE_ID = "ai.clioo.drogon";

/**
 * Signing-boundary predicate for the pinned Mentu runtime (fork parity:
 * reference `config/scripts/mentu-runtime-package.cjs`
 * `mentuRuntimeSignIgnore` + `mentu-runtime-signing.test.mjs`, adapted from
 * electron-builder `mac.signIgnore` to @electron/packager `osxSign.ignore`).
 * Matches ONLY the exact nested ad-hoc unsigned runtime path: signing it
 * would append an LC_CODE_SIGNATURE and break the byte sha256 the daemon's
 * `mentu.runtime_install` verifies against the lock. This flow is ad-hoc
 * local only (journey J11), so — unlike the fork, which re-signs everything
 * under Developer ID for release — the exemption is unconditional here.
 * `codesign --verify --deep --strict` still passes with the nested binary
 * unsigned (proven on the sealed bundle, not assumed).
 */
export function mentuRuntimeSignIgnore(revision) {
  assert.match(revision ?? "", /^[a-f0-9]{40}$/);
  const suffix = [
    "Contents",
    "Resources",
    "mentu-runtime",
    revision,
    "bin",
    process.platform === "win32" ? "mentu-recipes.exe" : "mentu-recipes",
  ].join("/");
  return (file) =>
    typeof file === "string" &&
    file.split("\\").join("/").endsWith(suffix);
}

// Drogon bundle icon (R16-Z2, #201): the packager names the installed .icns
// after the icon: stem, so the sealed run reads it back from the bundle
// plist and fails closed on a stock-Electron regression.
export const BUNDLE_ICON_FILE = "icon.icns";
export const STOCK_ELECTRON_ICON_FILE = "electron.icns";

// Detached sealed-bundle identity version. Bumped only when the canonical
// sealed-tree encoding changes; acceptance reports and installers refuse
// unknown versions instead of comparing digests across encodings.
export const SEALED_BUNDLE_VERSION = 3;

export function previewArchiveName(info, sealed) {
  assert.match(info.revision ?? "", /^[a-f0-9]{40}$/);
  assert.equal(sealed.sealedVersion, SEALED_BUNDLE_VERSION);
  assert.match(sealed.sealedDigest ?? "", /^[a-f0-9]{64}$/);
  return `${info.revision.slice(0, 12)}-v${sealed.sealedVersion}-${sealed.sealedDigest}`;
}

// Deterministic traversal bounds. Caps are enforced while streaming so an
// oversized file fails before it is fully allocated. Real signed bundles
// stay far below these; the caps only stop a hostile or corrupted tree from
// exhausting the sealer.
export const MAX_SEALED_ENTRIES = 100000;
export const MAX_SEALED_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_SEALED_FILE_BYTES = 512 * 1024 * 1024;

export function bundlePaths(bundle, platform = process.platform) {
  const resources =
    platform === "darwin"
      ? path.join(bundle, "Contents", "Resources")
      : path.join(bundle, "resources");
  return {
    resources,
    executable:
      platform === "darwin"
        ? path.join(bundle, "Contents", "MacOS", "Drogon")
        : path.join(bundle, platform === "win32" ? "Drogon.exe" : "Drogon"),
    daemon: path.join(
      resources,
      "bin",
      platform === "win32" ? "drogond.exe" : "drogond",
    ),
    cli: path.join(
      resources,
      "bin",
      platform === "win32" ? "drogon-cli.exe" : "drogon-cli",
    ),
    info: path.join(resources, "build-info.json"),
    desktop: path.join(resources, "app"),
    icon: path.join(resources, BUNDLE_ICON_FILE),
    // Additive sealed-identity paths. Existing callers destructure a subset,
    // so these fields narrowly extend the contract without changing it.
    notices: path.join(resources, "DEPENDENCY-NOTICES.txt"),
    plist:
      platform === "darwin"
        ? path.join(bundle, "Contents", "Info.plist")
        : null,
  };
}

export async function fileDigest(file) {
  assert.ok(
    (await lstat(file)).isFile(),
    `Expected ordinary artifact: ${file}`,
  );
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

export async function treeDigest(directory) {
  const hash = createHash("sha256");
  async function visit(relative) {
    for (const entry of (
      await readdir(path.join(directory, relative), { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const item = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(item);
      else {
        assert.ok(
          entry.isFile(),
          `Unexpected link or special file in desktop output: ${item}`,
        );
        hash.update(item.split(path.sep).join("/")).update("\0");
        hash.update(await readFile(path.join(directory, item))).update("\0");
      }
    }
  }
  await visit("");
  return hash.digest("hex");
}

export async function fingerprintBundle(bundle, platform = process.platform) {
  const files = bundlePaths(bundle, platform);
  const artifacts = {
    daemon: await fileDigest(files.daemon),
    cli: await fileDigest(files.cli),
    desktop: await treeDigest(files.desktop),
  };
  const artifactDigest = createHash("sha256")
    .update(JSON.stringify(artifacts))
    .digest("hex");
  return { artifacts, artifactDigest };
}

// CFBundleIconFile read-back for a macOS bundle. The packager preserves
// the XML plist, so a tag read suffices; a binary plist (or an unreadable
// one) falls back to PlistBuddy rather than guessing. Null off macOS.
export async function bundleIconFile(bundle, platform = process.platform) {
  if (platform !== "darwin") return null;
  const plist = bundlePaths(bundle, platform).plist;
  const raw = await readFile(plist, "utf8");
  const xml = raw.match(
    /<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/,
  );
  if (xml) return xml[1];
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    const { stdout } = await promisify(execFile)("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleIconFile",
      plist,
    ]);
    return stdout.trim();
  } catch {
    assert.fail(`Cannot read CFBundleIconFile from ${plist}`);
  }
}

export async function verifiedBuildInfo(bundle, platform = process.platform) {
  const files = bundlePaths(bundle, platform);
  if (platform === "darwin") {
    assert.equal(
      await bundleIconFile(bundle, platform),
      BUNDLE_ICON_FILE,
      `Bundle must carry the Drogon ${BUNDLE_ICON_FILE}, not stock ${STOCK_ELECTRON_ICON_FILE} ` +
        "(run node scripts/build-app-icon.mjs and re-package)",
    );
  }
  const info = JSON.parse(await readFile(files.info, "utf8"));
  assert.equal(info.schema, 1);
  assert.equal(info.appBundleId, APP_BUNDLE_ID);
  assert.match(info.revision, /^[a-f0-9]{40}$/);
  assert.equal(info.dirty, false, "Only committed previews may be installed");
  assert.equal(info.platform, platform);
  assert.equal(info.arch, process.arch);
  const actual = await fingerprintBundle(bundle, platform);
  assert.deepEqual(
    info.artifacts,
    actual.artifacts,
    "Packaged artifacts changed since stamping",
  );
  assert.equal(info.artifactDigest, actual.artifactDigest);
  assert.ok((await lstat(files.executable)).isFile());
  return info;
}

// Sealed whole-bundle identity. Covers every installed runtime byte served
// from the final signed bundle: executable, frameworks, property lists,
// dependency notices, native binaries and the desktop tree, plus ordinary
// file modes. Computed AFTER packaging/signing and stored in the DETACHED
// acceptance report, never embedded in the bundle, so sealing never
// invalidates its own input or forces a re-sign loop. Legacy
// fingerprintBundle/verifiedBuildInfo stay for recovering historical
// metadata-only previews; they must not authorize a new install on their own.
export async function sealedBundleDigest(
  bundle,
  platform = process.platform,
  limits = {},
) {
  const maxEntries = limits.maxEntries ?? MAX_SEALED_ENTRIES;
  const maxTotalBytes = limits.maxTotalBytes ?? MAX_SEALED_BYTES;
  const maxFileBytes = limits.maxFileBytes ?? MAX_SEALED_FILE_BYTES;
  const root = path.resolve(bundle);
  const rootStat = await lstat(root);
  assert.ok(
    rootStat.isDirectory() && !rootStat.isSymbolicLink(),
    `Refusing redirected bundle root: ${bundle}`,
  );
  const realRoot = await realpath(root);
  const hash = createHash("sha256");
  hash.update(`sealed-bundle-v${SEALED_BUNDLE_VERSION}\0${platform}\0`);
  let entries = 0;
  let fileCount = 0;
  let totalBytes = 0;
  const seenFiles = new Set();
  const seenDirs = new Set();
  const activeDirs = new Set();
  function orderRaw(a, b) {
    return Buffer.from(a, "utf8").compare(Buffer.from(b, "utf8"));
  }
  // Stream one ordinary file into the digest, enforcing per-file and total
  // byte caps as chunks arrive so oversized input fails before allocation.
  async function hashStreamedFile(abs, rel, mode) {
    const contentHash = createHash("sha256");
    let size = 0;
    await new Promise((resolve, reject) => {
      const stream = createReadStream(abs);
      stream.on("data", (chunk) => {
        size += chunk.length;
        totalBytes += chunk.length;
        if (size > maxFileBytes || totalBytes > maxTotalBytes) {
          stream.destroy(
            new Error(`Bundle exceeds sealed-identity byte bound at ${rel}`),
          );
          return;
        }
        contentHash.update(chunk);
      });
      stream.on("error", reject);
      stream.on("end", resolve);
    });
    // Fixed-length content hashes keep binary bytes from impersonating tree entries.
    hash
      .update(
        JSON.stringify(["file", rel, mode, size, contentHash.digest("hex")]),
      )
      .update("\0");
    seenFiles.add(rel);
    fileCount += 1;
  }
  async function visit(absolute, relative) {
    const listed = await readdir(absolute, { withFileTypes: true });
    listed.sort((a, b) => orderRaw(a.name, b.name));
    for (const entry of listed) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const abs = path.join(absolute, entry.name);
      assert.ok(!rel.includes("\0"), `Refusing odd bundle path: ${rel}`);
      entries += 1;
      assert.ok(
        entries <= maxEntries,
        `Bundle exceeds sealed-identity entry bound at ${rel}`,
      );
      if (entry.isSymbolicLink()) {
        const target = await readlink(abs);
        // Resolve the full chain without reading file bytes outside the
        // bundle: cycles (ELOOP), dangling links (ENOENT) and escapes
        // through any hop fail closed. Best-effort at seal time; not a
        // proof against concurrent bundle mutation during sealing.
        let resolved;
        try {
          resolved = await realpath(abs);
        } catch (error) {
          if (error.code === "ELOOP")
            assert.fail(`Refusing cyclic bundle link: ${rel} -> ${target}`);
          if (error.code === "ENOENT")
            assert.fail(`Refusing dangling bundle link: ${rel} -> ${target}`);
          assert.fail(
            `Refusing unreadable bundle link: ${rel} (${error.code ?? error.message})`,
          );
        }
        assert.ok(
          resolved === realRoot || resolved.startsWith(realRoot + path.sep),
          `Refusing bundle symlink escape: ${rel} -> ${target}`,
        );
        hash.update(`symlink:${rel}\0${target}\0`);
        fileCount += 1;
        continue;
      }
      if (entry.isDirectory()) {
        const stat = await lstat(abs);
        const key = `${stat.dev}:${stat.ino}`;
        assert.ok(
          !activeDirs.has(key),
          `Refusing directory cycle in bundle: ${rel}`,
        );
        activeDirs.add(key);
        try {
          hash.update(`dir:${rel}\0${(stat.mode & 0o777).toString(8)}\0`);
          seenDirs.add(`${rel}/`);
          await visit(abs, rel);
        } finally {
          activeDirs.delete(key);
        }
        continue;
      }
      if (entry.isFile()) {
        const stat = await lstat(abs);
        assert.ok(
          stat.isFile() && !stat.isSymbolicLink(),
          `Refusing substituted bundle file: ${rel}`,
        );
        assert.ok(
          stat.size <= maxFileBytes,
          `Bundle exceeds sealed-identity file bound at ${rel}`,
        );
        await hashStreamedFile(abs, rel, (stat.mode & 0o777).toString(8));
        continue;
      }
      assert.fail(`Refusing special file in bundle: ${rel}`);
    }
  }
  await visit(root, "");
  const files = bundlePaths(root, platform);
  // Required runtime paths must be ordinary files; a symlink, directory or
  // special file at one of these paths fails closed instead of satisfying it.
  const required = [
    files.executable,
    files.daemon,
    files.cli,
    files.info,
    files.notices,
    ...(platform === "darwin" ? [files.plist] : []),
  ];
  for (const absolute of required) {
    const rel = path.relative(root, absolute).split(path.sep).join("/");
    assert.ok(
      seenFiles.has(rel),
      `Missing expected runtime file in bundle: ${rel}`,
    );
  }
  const desktopRel = path
    .relative(root, files.desktop)
    .split(path.sep)
    .join("/");
  assert.ok(
    seenDirs.has(`${desktopRel}/`),
    `Missing expected desktop directory in bundle: ${desktopRel}`,
  );
  return {
    sealedVersion: SEALED_BUNDLE_VERSION,
    sealedDigest: hash.digest("hex"),
    fileCount,
    totalBytes,
  };
}

// Fields the detached acceptance report stores as final-artifact proof.
// Kept separate from build-info.json so historical metadata-only previews
// remain readable without ever authorizing a fresh install.
export async function sealBundleReport(
  bundle,
  platform = process.platform,
  limits = {},
) {
  return sealedBundleDigest(bundle, platform, limits);
}

export async function verifySealedBundle(
  bundle,
  expected,
  platform = process.platform,
  limits = {},
) {
  assert.ok(
    expected && typeof expected === "object",
    "A detached sealed-bundle receipt is required; legacy metadata-only " +
      "reports must not authorize an install",
  );
  assert.equal(
    expected.sealedVersion,
    SEALED_BUNDLE_VERSION,
    "Refusing sealed receipt from an unknown identity version",
  );
  assert.match(
    expected.sealedDigest ?? "",
    /^[a-f0-9]{64}$/,
    "Refusing malformed sealed-bundle receipt",
  );
  const actual = await sealedBundleDigest(bundle, platform, limits);
  assert.equal(
    actual.sealedDigest,
    expected.sealedDigest,
    "Sealed bundle identity mismatch: the install candidate differs from " +
      "the accepted final artifact",
  );
  return actual;
}

// App-icon fail-closed invariant (R16-BO, #319): packaging must never emit
// a bundle carrying the stock Electron icon, and sealed acceptance must
// prove the Drogon icon so PASSED implies installable. The .icns is built
// from icon.svg by scripts/build-app-icon.mjs; a missing icon or one older
// than the SVG (or the builder itself) is rebuilt in-process before any
// bundle byte is produced. A failed rebuild aborts packaging outright.
export const APP_ICON_SOURCE_FILE = "icon.svg";
export const APP_ICON_BUILDER_FILE = "build-app-icon.mjs";
// A real iconset .icns is hundreds of KB; anything at or below this bound
// is a stub or a corrupt write, never the Drogon mark.
export const MIN_DROGON_ICON_BYTES = 50 * 1024;

export async function appIconFreshness({ svg, icns, builder }) {
  let icnsStat = null;
  try {
    icnsStat = await stat(icns);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!icnsStat || !icnsStat.isFile())
    return { exists: false, stale: true, reason: "missing" };
  let newestSourceMs = 0;
  for (const source of [svg, builder]) {
    try {
      newestSourceMs = Math.max(
        newestSourceMs,
        (await stat(source)).mtimeMs,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (icnsStat.mtimeMs < newestSourceMs)
    return { exists: true, stale: true, reason: "stale" };
  return { exists: true, stale: false, reason: "fresh" };
}

export async function ensureAppIcon({ svg, icns, builder }, options = {}) {
  const before = await appIconFreshness({ svg, icns, builder });
  if (!before.stale) return { rebuilt: false, ...before };
  const build =
    options.buildIcon ??
    (async () => {
      const { buildAppIcon } = await import("./build-app-icon.mjs");
      await buildAppIcon(path.dirname(icns));
    });
  await build();
  const after = await appIconFreshness({ svg, icns, builder });
  assert.ok(
    after.exists,
    `App icon build did not produce ${icns}: refusing to package with the stock Electron icon (#319)`,
  );
  assert.ok(
    !after.stale,
    `App icon at ${icns} is still older than its source: refusing to package with the stock Electron icon (#319)`,
  );
  return { rebuilt: true, ...after };
}

// Sealed-acceptance icon proof (R16-BO, #319): CFBundleIconFile names the
// Drogon icon, the .icns exists at a real-iconset size, and its bytes match
// the resources icon when that file is present. Anything else fails closed.
export async function verifyBundleCarriesDrogonIcon(bundle, options = {}) {
  const { platform = process.platform, expectedIcon = null } = options;
  if (platform !== "darwin") return { checked: false, reason: "not-macos" };
  assert.equal(
    await bundleIconFile(bundle, platform),
    BUNDLE_ICON_FILE,
    `Bundle must carry the Drogon ${BUNDLE_ICON_FILE}, not stock ${STOCK_ELECTRON_ICON_FILE} ` +
      "(run node scripts/build-app-icon.mjs and re-package)",
  );
  const files = bundlePaths(bundle, platform);
  let bytes = null;
  try {
    bytes = await readFile(files.icon);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  assert.ok(
    bytes,
    `Bundle icon ${BUNDLE_ICON_FILE} is missing from ${files.resources}: refusing a stock-icon bundle`,
  );
  assert.ok(
    bytes.length > MIN_DROGON_ICON_BYTES,
    `Bundle icon is ${bytes.length} bytes (need > ${MIN_DROGON_ICON_BYTES}): refusing a stub icon bundle`,
  );
  if (expectedIcon) {
    let expected = null;
    try {
      expected = await readFile(expectedIcon);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (expected) {
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        createHash("sha256").update(expected).digest("hex"),
        "Bundle icon bytes differ from apps/desktop/resources/icon.icns: re-package with a fresh icon",
      );
    }
  }
  return { checked: true, bytes: bytes.length };
}

// Previous-preview leniency (R16-BO, #319): the incoming bundle is verified
// strictly, but the previous preview build exists only for rollback. An old
// preview that predates a newer invariant (e.g. the #201 icon) must warn,
// never refuse the install — its build-info is still read best-effort for
// recovery metadata.
export async function lenientPreviousBuildInfo(
  bundle,
  platform = process.platform,
) {
  try {
    return {
      info: await verifiedBuildInfo(bundle, platform),
      strict: true,
      warning: null,
    };
  } catch (error) {
    let recovery = null;
    try {
      recovery = JSON.parse(
        await readFile(bundlePaths(bundle, platform).info, "utf8"),
      );
    } catch {
      recovery = null;
    }
    return { info: recovery, strict: false, warning: error.message };
  }
}

// Pure install-authorization check with no filesystem side effects: the
// candidate, staged copy and reuse target must each present the exact sealed
// digest recorded in the detached PASSED acceptance report. Legacy reports
// without a sealed digest fail closed.
export function assertSealedInstallAuthorization({
  report,
  candidateDigest,
  stagedDigest,
  targetDigest,
}) {
  assert.ok(
    report && typeof report === "object",
    "A detached packaged acceptance report is required",
  );
  assert.equal(report.kind, "packaged-desktop");
  assert.equal(
    report.status,
    "PASSED",
    "The packaged app must pass acceptance before installation",
  );
  assert.equal(
    report.sealedVersion,
    SEALED_BUNDLE_VERSION,
    "Legacy metadata-only receipts must not authorize a new install; " +
      "re-run packaged acceptance to record a sealed final-artifact identity",
  );
  assert.match(
    report.sealedDigest ?? "",
    /^[a-f0-9]{64}$/,
    "Refusing malformed sealed-bundle receipt",
  );
  assert.ok(
    candidateDigest ?? stagedDigest ?? targetDigest,
    "At least one sealed candidate, staged or target digest must be " +
      "presented; a receipt alone authorizes nothing",
  );
  for (const [label, digest] of [
    ["install candidate", candidateDigest],
    ["staged copy", stagedDigest],
    ["install target", targetDigest],
  ]) {
    if (digest === undefined) continue;
    assert.equal(
      digest,
      report.sealedDigest,
      `${label} differs from the accepted sealed final artifact`,
    );
  }
  return true;
}
