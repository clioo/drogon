// Validates the artifact users actually download: fetches a published
// Drogon release, verifies its checksum, extracts and quarantines it like a
// fresh Mac would receive it, runs the clean-machine subset of packaged
// acceptance against it, and prints a JSON verdict. Only Node 24 + this repo
// are required (no Claude TUI, no Homebrew packages, no network beyond
// GitHub). A release whose bundle cannot start fails here instead of
// reaching users: PASSED always implies at least one executed check.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { runAcceptanceProcess } from "./acceptance-process.mjs";
import { verifiedBuildInfo } from "./desktop-artifacts.mjs";
import { releaseArtifactNames } from "./release-desktop.mjs";
import { versionFromTag } from "./release-version.mjs";

export const RELEASE_OWNER = "clioo";
export const RELEASE_REPO = "drogon";
export const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 3600000;
const QUARANTINE_AGENT = "Homebrew";

function usage() {
  return [
    "Usage: node scripts/accept-release-artifact.mjs [--tag vX.Y.Z] [--dir DIR] [--keep] [--timeout-ms N] [--bundle <Drogon.app>]",
    "  --tag      Release tag to validate (default: newest published release, prereleases included).",
    "  --dir      Scratch parent for the download and extraction (default: os.tmpdir()).",
    "  --keep     Retain the scratch dir (download, extracted bundle, acceptance output).",
    "  --timeout-ms  Bound the packaged-acceptance child (default 3600000).",
    "  --bundle   Escape hatch: validate a local .app instead of downloading (still asserts",
    "             build-info against --tag, which becomes required). Skips quarantine.",
  ].join("\n");
}

export function parseArgs(argv = []) {
  const options = { tag: null, dir: null, keep: false, timeoutMs: DEFAULT_ACCEPTANCE_TIMEOUT_MS, bundle: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tag") options.tag = argv[++index] ?? null;
    else if (arg === "--dir") options.dir = argv[++index] ?? null;
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (arg === "--bundle") options.bundle = argv[++index] ?? null;
    else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else assert.fail(`Unknown argument: ${arg}\n${usage()}`);
  }
  assert.ok(options.tag || !options.bundle, "--bundle requires --tag so build-info can be asserted");
  assert.ok(Number.isFinite(options.timeoutMs) && options.timeoutMs > 0, "--timeout-ms must be a positive number");
  return options;
}

// Newest published release, prereleases included (the lane ships rc tags);
// drafts are never candidates. fetchImpl is injectable for tests.
export async function resolveReleaseTag({ tag = null, fetchImpl = fetch } = {}) {
  if (tag) {
    versionFromTag(tag);
    return tag;
  }
  const response = await fetchImpl(
    `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases?per_page=20`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "drogon-accept-release-artifact",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
      },
    },
  );
  assert.ok(response.ok, `GitHub releases API failed: ${response.status}`);
  const releases = await response.json();
  assert.ok(Array.isArray(releases) && releases.length > 0, "No published Drogon releases found");
  const candidate = releases.find((release) => !release?.draft && typeof release?.tag_name === "string");
  assert.ok(candidate, "No non-draft Drogon release found");
  versionFromTag(candidate.tag_name);
  return candidate.tag_name;
}

export function releaseAssetUrls(tag) {
  const version = versionFromTag(tag);
  const names = releaseArtifactNames(version);
  const base = `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/${tag}`;
  return { version, archiveUrl: `${base}/${names.archive}`, checksumUrl: `${base}/${names.checksum}`, names };
}

export async function downloadToFile(url, dest, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { headers: { "User-Agent": "drogon-accept-release-artifact" } });
  assert.ok(response.ok, `Download failed (${response.status}): ${url}`);
  assert.ok(response.body, `Download has no body: ${url}`);
  await pipeline(response.body, createWriteStream(dest));
  return dest;
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

// The published .sha256 file holds "<hex>  <filename>\n". Any mismatch, or
// any unreadable checksum file, fails closed: an unverified bundle is never
// launched.
export async function verifyChecksum({ archive, checksumFile }) {
  const raw = await readFile(checksumFile, "utf8");
  const expected = raw.trim().split(/\s+/)[0] ?? "";
  assert.match(expected, /^[a-f0-9]{64}$/, `Refusing malformed checksum file: ${checksumFile}`);
  const actual = await sha256File(archive);
  assert.equal(actual, expected, `Checksum mismatch for ${path.basename(archive)}: expected ${expected}, got ${actual}`);
  return actual;
}

// ditto is intentional (cf. release-desktop.mjs zipBundle): it preserves the
// bundle's resource forks, symlinks and parent shape, exactly like a user
// extraction. run is injectable for tests.
export async function extractBundle({ archive, destDir, run = runAcceptanceProcess }) {
  assert.equal(process.platform, "darwin", "Release artifacts target macOS only");
  await mkdir(destDir, { recursive: true });
  await run("/usr/bin/ditto", ["-x", "-k", archive, destDir], { timeout: 300000 });
  const bundle = path.join(destDir, "Drogon.app");
  assert.ok(existsSync(bundle), `Extraction did not produce ${bundle}`);
  return bundle;
}

// What Homebrew 6 leaves behind: a quarantine attribute, so the candidate
// launches under the same Gatekeeper posture a fresh install sees.
export async function applyQuarantine({ bundle, run = runAcceptanceProcess }) {
  const value = `0081;00000000;${QUARANTINE_AGENT};${randomUUID().toUpperCase()}`;
  await run("/usr/bin/xattr", ["-w", "com.apple.quarantine", value, bundle], { timeout: 30000 });
  return value;
}

// The app's own build-info must name the tag under validation: a checksum
// match alone cannot catch a mislabeled re-upload. readInfo is injectable.
export async function assertBuildInfoMatchesTag({ bundle, version, readInfo = verifiedBuildInfo }) {
  const info = await readInfo(bundle);
  assert.equal(
    info.version,
    version,
    `Bundle build-info version ${info.version} does not match release ${version}`,
  );
  return info;
}

// Streams the acceptance child's output to the console (a 30-minute silent
// CI step looks dead) while buffering it for receipt parsing. spawnImpl is
// injectable for tests; the default is the real spawn.
export function streamingSpawn(file, args, options, onOutput) {
  const child = spawn(file, args, { ...options });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (bytes) => {
    stdout += bytes.toString();
    onOutput?.(bytes.toString(), "stdout");
  });
  child.stderr?.on("data", (bytes) => {
    stderr += bytes.toString();
    onOutput?.(bytes.toString(), "stderr");
  });
  return {
    child,
    done: () =>
      new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
      }),
  };
}

export async function runCleanMachineAcceptance({
  bundle,
  script,
  nodePath = process.execPath,
  timeoutMs = DEFAULT_ACCEPTANCE_TIMEOUT_MS,
  env = process.env,
  spawnImpl = streamingSpawn,
  onOutput = (chunk) => process.stdout.write(chunk),
} = {}) {
  assert.ok(bundle, "A bundle path is required");
  const { child, done } = spawnImpl(
    nodePath,
    [script, "--bundle", bundle, "--files"],
    {
      env: { ...env, DROGON_BACKGROUND_WINDOW: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
    onOutput,
  );
  let timer = null;
  try {
    const result = await Promise.race([
      done(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
          resolve({ code: null, signal: "SIGKILL", stdout: "", stderr: "", timedOut: true });
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The last stdout record carrying a report path is the receipt (earlier
// probes log their own JSON lines; cf. release-desktop.mjs parseJsonLines).
export function findAcceptanceReceipt(output) {
  const records = String(output)
    .split("\n")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  return records.findLast((item) => item && typeof item.report === "string") ?? null;
}

export function summarizeAcceptanceReport(report) {
  assert.ok(report && typeof report === "object", "An acceptance report object is required");
  return {
    status: report.status,
    executed: Array.isArray(report.checks) ? report.checks.length : 0,
    skipped: Array.isArray(report.skipped) ? report.skipped.length : 0,
  };
}

// The honesty guard, twice over: the child already refuses to report PASSED
// with zero executed checks (markAcceptancePassed), and this verdict repeats
// that refusal so no caller can paper over it. A skipped-only run is FAILED.
export function decideArtifactVerdict({ receipt, report }) {
  const summary = report ? summarizeAcceptanceReport(report) : { status: null, executed: 0, skipped: 0 };
  if (!receipt)
    return { verdict: "FAILED", executedChecks: 0, skippedChecks: summary.skipped, reason: "packaged acceptance produced no report receipt" };
  if (receipt.status !== "PASSED" || summary.status !== "PASSED")
    return {
      verdict: "FAILED",
      executedChecks: summary.executed,
      skippedChecks: summary.skipped,
      reason: receipt.error ?? report?.error ?? "packaged acceptance did not pass",
      report: receipt.report ?? null,
    };
  if (summary.executed === 0)
    return {
      verdict: "FAILED",
      executedChecks: 0,
      skippedChecks: summary.skipped,
      reason: "packaged acceptance reported PASSED with zero executed checks",
      report: receipt.report ?? null,
    };
  return {
    verdict: "PASSED",
    executedChecks: summary.executed,
    skippedChecks: summary.skipped,
    report: receipt.report ?? null,
  };
}

async function main(argv = process.argv.slice(2)) {
  assert.equal(process.platform, "darwin", "Release artifacts target macOS only");
  assert.equal(process.arch, "arm64", "Releases currently target Apple Silicon only");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const options = parseArgs(argv);
  const tag = await resolveReleaseTag({ tag: options.tag });
  const { version, archiveUrl, checksumUrl, names } = releaseAssetUrls(tag);
  const scratch = options.bundle
    ? null
    : await mkdtemp(path.join(options.dir ?? tmpdir(), "drogon-release-accept-"));
  const verdict = {
    status: "FAILED",
    tag,
    version,
    archive: null,
    sha256: null,
    bundle: options.bundle,
    report: null,
    executedChecks: 0,
    skippedChecks: 0,
  };
  try {
    if (!options.bundle) {
      const archive = path.join(scratch, names.archive);
      const checksumFile = path.join(scratch, names.checksum);
      await downloadToFile(archiveUrl, archive);
      await downloadToFile(checksumUrl, checksumFile);
      verdict.sha256 = await verifyChecksum({ archive, checksumFile });
      verdict.archive = archive;
      const bundle = await extractBundle({ archive, destDir: path.join(scratch, "extracted") });
      await applyQuarantine({ bundle });
      verdict.bundle = bundle;
    }
    const info = await assertBuildInfoMatchesTag({ bundle: verdict.bundle, version });
    verdict.buildRevision = info.revision;
    const child = await runCleanMachineAcceptance({
      bundle: verdict.bundle,
      script: path.join(root, "scripts", "accept-desktop.mjs"),
      timeoutMs: options.timeoutMs,
    });
    if (child.timedOut)
      throw new Error(`packaged acceptance timed out after ${options.timeoutMs}ms`);
    const receipt = findAcceptanceReceipt(child.stdout);
    let report = null;
    if (receipt?.report) {
      try {
        report = JSON.parse(await readFile(receipt.report, "utf8"));
      } catch {
        report = null;
      }
    }
    const decision = decideArtifactVerdict({ receipt, report });
    verdict.status = decision.verdict;
    verdict.report = decision.report;
    verdict.executedChecks = decision.executedChecks;
    verdict.skippedChecks = decision.skippedChecks;
    if (decision.reason) verdict.reason = decision.reason;
    if (report?.skipped) verdict.skipped = report.skipped;
  } catch (error) {
    verdict.status = "FAILED";
    verdict.reason = error.message;
  } finally {
    if (scratch && !options.keep) await rm(scratch, { recursive: true, force: true });
    else if (scratch) verdict.scratch = scratch;
  }
  console.log(JSON.stringify(verdict));
  if (verdict.status !== "PASSED") process.exitCode = 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) await main();
