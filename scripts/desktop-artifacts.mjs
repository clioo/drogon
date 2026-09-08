import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
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

export async function verifiedBuildInfo(bundle, platform = process.platform) {
  const files = bundlePaths(bundle, platform);
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
