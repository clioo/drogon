#!/usr/bin/env node
// Post-publish release verification: proves the *published* GitHub release
// asset is the artifact the tap serves, and that it is a notarized,
// Developer ID build of the tagged revision. Pure parsers are unit-tested
// in verify-release-artifact.test.mjs; the live run (--live) downloads the
// published URLs and shells out to codesign/spctl/stapler/otool, so CI and
// hygiene stays hermetic without the flag.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { releaseArtifactNames } from "./release-desktop.mjs";
import { versionFromTag } from "./release-version.mjs";

const runFile = promisify(execFile);

export const PRODUCT_REPO = "clioo/drogon";
export const TAP_REPO = "clioo/homebrew-drogon";
export const EXPECTED_BINARIES = Object.freeze([
  "drogond",
  "drogon-cli",
  "drogon-cli.native",
  "drogon-stop-daemon",
]);
export const EXPECTED_SIGNED = "developer-id-notarized";
export const EXPECTED_SPCTL_SOURCE = "Notarized Developer ID";

export function releaseDownloadUrls(tag) {
  const version = versionFromTag(tag);
  const names = releaseArtifactNames(version);
  const base = `https://github.com/${PRODUCT_REPO}/releases/download/${tag}`;
  return {
    version,
    archiveUrl: `${base}/${names.archive}`,
    checksumUrl: `${base}/${names.checksum}`,
    archiveName: names.archive,
  };
}

export function tapCaskUrl(ref = "main") {
  return `https://raw.githubusercontent.com/${TAP_REPO}/${ref}/Casks/drogon.rb`;
}

// Newest published release, stable or prerelease: the API's /latest endpoint
// only sees stable releases, which would hide every Drogon rc.
export function pickNewestRelease(releases) {
  assert.ok(Array.isArray(releases) && releases.length > 0, "No releases found");
  const published = releases.filter((item) => !item?.draft && item?.published_at);
  assert.ok(published.length > 0, "No published releases found");
  published.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
  assert.ok(published[0].tag_name, "Newest release has no tag");
  return published[0].tag_name;
}

export function parseChecksumLine(text, archiveName) {
  const [digest, name] = String(text).trim().split(/\s+/);
  assert.match(digest ?? "", /^[a-f0-9]{64}$/, "Published checksum is not a sha256 digest");
  assert.equal(name, archiveName, `Checksum names ${name}, expected ${archiveName}`);
  return digest;
}

export function parseCask(text) {
  const source = String(text);
  const version = source.match(/^\s*version\s+"([^"]+)"\s*$/m)?.[1] ?? null;
  const sha256 = source.match(/^\s*sha256\s+"([^"]+)"\s*$/m)?.[1] ?? null;
  const livecheck = source.match(/strategy\s+:(\w+)/)?.[1] ?? null;
  assert.ok(version, "Cask has no version stanza");
  assert.match(sha256 ?? "", /^[a-f0-9]{64}$/, "Cask has no sha256 stanza");
  return { version, sha256, livecheckStrategy: livecheck };
}

export function parseCodesignAuthorities(output) {
  return String(output)
    .split("\n")
    .map((line) => line.match(/^\s*Authority=(.*)\s*$/)?.[1])
    .filter(Boolean);
}

export function assertDeveloperIdAuthority(authorities) {
  assert.ok(authorities.length > 0, "codesign reported no authorities");
  assert.match(
    authorities[0],
    /^Developer ID Application: /,
    `Expected a Developer ID Application leaf, got: ${authorities[0]}`,
  );
  return authorities[0];
}

export function hasHardenedRuntime(codesignVerboseOutput) {
  return /flags=0x[0-9a-f]*[0-9a-f]\(\S*runtime\S*\)/m.test(String(codesignVerboseOutput));
}

export function parseSpctlOutput(output) {
  const text = String(output);
  const accepted = /^.*:\s*accepted\s*$/m.test(text);
  const source = text.match(/^\s*source=(.*)\s*$/m)?.[1]?.trim() ?? null;
  return { accepted, source };
}

export function assertNotarizedSpctl({ accepted, source }) {
  assert.equal(accepted, true, "spctl did not accept the bundle");
  assert.equal(source, EXPECTED_SPCTL_SOURCE, `spctl source is ${source}`);
  return source;
}

export function parseOtoolLibraries(output) {
  const lines = String(output).split("\n");
  assert.ok(lines.length > 0, "otool produced no output");
  return lines
    .slice(1)
    .map((line) => line.match(/^\s*(\S+)\s+\(compatibility/)?.[1])
    .filter(Boolean);
}

export function assertLinkedOnlyUsrLib(libraries) {
  assert.ok(libraries.length > 0, "No linked libraries found");
  for (const library of libraries) {
    assert.ok(
      library.startsWith("/usr/lib/"),
      `Bundled binary links a non-system library: ${library}`,
    );
  }
  return libraries;
}

export function assertReleaseBuildInfo(info, tag) {
  const version = versionFromTag(tag);
  assert.equal(typeof info, "object", "build-info.json did not parse to an object");
  assert.equal(info.version, version, `build-info version ${info.version} != ${version}`);
  assert.equal(info.dirty, false, "Release was packaged from a dirty checkout");
  assert.equal(info.signed, EXPECTED_SIGNED, `build-info signed is ${info.signed}`);
  assert.equal(info.arch, "arm64", `Release arch is ${info.arch}`);
  assert.match(info.revision ?? "", /^[a-f0-9]{40}$/, "build-info revision is not a commit SHA");
  return info;
}

// Home prefixes that are never a maintainer leak: the ephemeral GitHub
// Actions builder (Rust panic paths under .cargo are unavoidable without
// build-path remapping) and the conventional placeholder used by the CLI's
// own help examples (see crates/drogon-cli/src/agent_context.rs).
export const BENIGN_HOME_PREFIXES = Object.freeze(["/Users/runner/", "/Users/me/"]);

// Reports the first maintainer-home-shaped path ("/Users/<name>/...") in a
// buffer, or null. Binary-safe: scans latin1 so Mach-O bytes stay searchable.
export function findHomePathReference(chunk, exemptPrefixes = BENIGN_HOME_PREFIXES) {
  const text = Buffer.isBuffer(chunk)
    ? chunk.toString("latin1")
    : String(chunk);
  const pattern = /\/Users\/[^/\0\s"']+(?:\/[^/\0\s"']*)*/g;
  for (const match of text.matchAll(pattern)) {
    if (!exemptPrefixes.some((prefix) => match[0].startsWith(prefix))) return match[0];
  }
  return null;
}

// Mach-O magic, either endianness: feedface/feedfacf thin, cafebabe/cafebabf fat.
export function isMachO(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 4) return false;
  const magic = bytes.readUInt32BE(0);
  return (
    magic === 0xfeedface ||
    magic === 0xfeedfacf ||
    magic === 0xcafebabe ||
    magic === 0xcafebabf ||
    magic === 0xcefaedfe ||
    magic === 0xcffaedfe
  );
}

export function verdict(status, check, detail = null, context = {}) {
  return { status, check, detail, ...context };
}

async function download(url, file, headers = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": "drogon-release-verifier", ...headers },
    signal: AbortSignal.timeout(300000),
  });
  assert.ok(response.ok, `Download failed: ${url} -> HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(file));
  return file;
}

async function sha256File(file) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function fail(check, detail, context) {
  console.log(JSON.stringify(verdict("FAILED", check, String(detail?.message ?? detail), context)));
  process.exitCode = 1;
  throw new Error(`verify-release-artifact: ${check}: ${detail?.message ?? detail}`);
}

async function githubJson(url, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "drogon-release-verifier", ...headers },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`GitHub API ${url} -> HTTP ${response.status}`);
  return response.json();
}

async function readAndCheckChecksum(archivePath, archiveName) {
  const digest = parseChecksumLine(await readFile(`${archivePath}.sha256`, "utf8"), archiveName);
  assert.equal(await sha256File(archivePath), digest, "Archive digest does not match its .sha256");
  return digest;
}

async function scanTreeForHomePaths(root) {
  const { readdir, open } = await import("node:fs/promises");
  const hits = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const handle = await open(absolute, "r");
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, 4 * 1024 * 1024);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, 0);
        const hit = findHomePathReference(buffer);
        if (hit) {
          hits.push({ file: path.relative(root, absolute), match: hit });
          if (hits.length >= 5) return;
        }
      } finally {
        await handle.close();
      }
      if (hits.length >= 5) return;
    }
  }
  await visit(root);
  return hits;
}

export async function verifyReleaseArtifact(
  { tag = null, repo = null, workdir = null, token = null, skipTap = false } = {},
) {
  assert.equal(process.platform, "darwin", "Release verification targets macOS only");
  repo ??= fileURLToPath(new URL("..", import.meta.url));
  const context = { repo, tag, tapSkipped: skipTap };
  const resolvedTag =
    tag ?? pickNewestRelease(await githubJson(`https://api.github.com/repos/${PRODUCT_REPO}/releases?per_page=20`, token));
  context.tag = resolvedTag;
  const { version, archiveUrl, checksumUrl, archiveName } = releaseDownloadUrls(resolvedTag);
  context.version = version;

  const scratch = workdir ?? (await mkdtemp(path.join(tmpdir(), "drogon-verify-release-")));
  const cleanup = workdir ? async () => {} : () => rm(scratch, { recursive: true, force: true });
  try {
    let cask = null;
    if (!skipTap) {
      const caskResponse = await fetch(tapCaskUrl(), {
        headers: { "User-Agent": "drogon-release-verifier" },
        signal: AbortSignal.timeout(60000),
      });
      if (!caskResponse.ok) await fail("fetch-cask", `HTTP ${caskResponse.status}`, context);
      cask = parseCask(await caskResponse.text());
      context.cask = cask;
    }

    const archive = path.join(scratch, archiveName);
    await download(checksumUrl, `${archive}.sha256`).catch((error) => fail("download", error, context));
    await download(archiveUrl, archive).catch((error) => fail("download", error, context));
    let published;
    try {
      published = await readAndCheckChecksum(archive, archiveName);
    } catch (error) {
      await fail("checksum", error, context);
    }
    context.sha256 = published;

    if (!skipTap) {
      if (published !== cask.sha256)
        await fail("cask-match", `Published digest ${published} != tap cask ${cask.sha256}`, context);
      if (cask.version !== version)
        await fail("cask-match", `Tap cask version ${cask.version} != release ${version}`, context);
    }

    const bundle = path.join(scratch, "Drogon.app");
    await runFile("/usr/bin/ditto", ["-x", "-k", archive, scratch], { timeout: 300000 }).catch((error) =>
      fail("extract", error, context),
    );
    assert.ok((await stat(bundle)).isDirectory(), "Archive does not contain Drogon.app");

    await runFile("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle], {
      timeout: 300000,
    }).catch((error) => fail("codesign-verify", error.stderr ?? error, context));
    const display = await runFile("/usr/bin/codesign", ["-d", "--verbose=4", bundle], {
      timeout: 60000,
    }).catch((error) => fail("codesign-authority", error.stderr ?? error, context));
    const authorities = parseCodesignAuthorities(`${display.stdout}\n${display.stderr}`);
    try {
      context.authority = assertDeveloperIdAuthority(authorities);
    } catch (error) {
      await fail("codesign-authority", error, context);
    }
    if (!hasHardenedRuntime(`${display.stdout}\n${display.stderr}`))
      await fail("codesign-authority", "Hardened runtime flag not set", context);

    const assessment = await runFile("/usr/sbin/spctl", ["-a", "-t", "exec", "-vv", bundle], {
      timeout: 120000,
    }).catch((error) => fail("spctl", error.stderr ?? error, context));
    try {
      context.spctl = assertNotarizedSpctl(parseSpctlOutput(`${assessment.stdout}\n${assessment.stderr}`));
    } catch (error) {
      await fail("spctl", error, context);
    }

    await runFile("/usr/bin/xcrun", ["stapler", "validate", bundle], { timeout: 300000 }).catch((error) =>
      fail("stapler", error.stderr ?? error, context),
    );

    let info;
    try {
      info = JSON.parse(
        await readFile(path.join(bundle, "Contents", "Resources", "build-info.json"), "utf8"),
      );
      assertReleaseBuildInfo(info, resolvedTag);
      context.revision = info.revision;
    } catch (error) {
      await fail("build-info", error, context);
    }
    const binDir = path.join(bundle, "Contents", "Resources", "bin");
    const { open: openBinary } = await import("node:fs/promises");
    for (const binary of EXPECTED_BINARIES) {
      const absolute = path.join(binDir, binary);
      try {
        assert.ok((await stat(absolute)).isFile(), `Missing bundled binary: ${binary}`);
        const handle = await openBinary(absolute, "r");
        const magic = Buffer.alloc(4);
        await handle.read(magic, 0, 4, 0);
        await handle.close();
        if (isMachO(magic)) {
          const libs = parseOtoolLibraries(
            (await runFile("/usr/bin/otool", ["-L", absolute], { timeout: 60000 })).stdout,
          );
          assertLinkedOnlyUsrLib(libs);
        } else if (binary === "drogon-cli") {
          // The entrypoint is a shell shim that pins the release version and
          // delegates to drogon-cli.native; prove it reports this release.
          const { versionFromCliOutput } = await import("./release-version.mjs");
          const shimVersion = versionFromCliOutput(
            (await runFile(absolute, ["--version"], { timeout: 60000 })).stdout,
          );
          assert.equal(shimVersion, version, `Shim reports ${shimVersion}, release is ${version}`);
        } else {
          assert.ok((await stat(absolute)).mode & 0o111, `${binary} is not executable`);
        }
      } catch (error) {
        await fail("binaries", error, context);
      }
    }

    const homePaths = await scanTreeForHomePaths(bundle);
    if (homePaths.length > 0)
      await fail("home-path-scan", `Bundle embeds maintainer paths: ${JSON.stringify(homePaths)}`, context);

    try {
      await runFile("git", ["fetch", "origin", "main", "--quiet"], { cwd: repo, timeout: 120000 });
      await runFile("git", ["merge-base", "--is-ancestor", info.revision, "origin/main"], {
        cwd: repo,
        timeout: 60000,
      });
    } catch (error) {
      await fail("revision-ancestor", `${info.revision} is not an ancestor of origin/main`, context);
    }

    console.log(JSON.stringify(verdict("VERIFIED", "all", null, context)));
    return context;
  } finally {
    await cleanup();
  }
}

function usage() {
  return [
    "Usage: node scripts/verify-release-artifact.mjs --tag vX.Y.Z --live [--skip-tap] [--repo DIR] [--workdir DIR]",
    "Without --live this prints usage and exits non-zero: the live run downloads",
    "the published asset and shells out to macOS-only tools, so it never runs in CI",
    "or hygiene by accident. GH_TOKEN is used for the GitHub API when set.",
    "--skip-tap checks the artifact alone (digest, signature, build-info,",
    "binaries); the release job uses it before the tap bump, then re-runs",
    "without it to prove the tap serves the verified artifact.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  let tag = null;
  let live = false;
  let repo = null;
  let workdir = null;
  let skipTap = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tag") tag = argv[++index];
    else if (arg === "--live") live = true;
    else if (arg === "--skip-tap") skipTap = true;
    else if (arg === "--repo") repo = path.resolve(argv[++index]);
    else if (arg === "--workdir") workdir = path.resolve(argv[++index]);
    else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      return;
    } else assert.fail(usage());
  }
  assert.ok(live, usage());
  await verifyReleaseArtifact({ tag, repo, workdir, skipTap, token: process.env.GH_TOKEN ?? null });
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) await main();

