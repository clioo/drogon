import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { bundlePaths, verifiedBuildInfo } from "./desktop-artifacts.mjs";
import { runAcceptanceProcess } from "./acceptance-process.mjs";
import {
  assertProjectVersions,
  readProjectManifests,
  versionFromCliOutput,
  versionFromTag,
} from "./release-version.mjs";

export const RELEASE_ARCH = "arm64";
export const RELEASE_PLATFORM = "darwin";

export function releaseArtifactNames(version) {
  const base = `Drogon-${version}-darwin-arm64.zip`;
  return { archive: base, checksum: `${base}.sha256` };
}

export function parseJsonLines(output) {
  return String(output)
    .split("\n")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function packagedRecord(output) {
  const record = parseJsonLines(output).findLast(
    (item) => item?.status === "PACKAGED" && typeof item.bundle === "string",
  );
  assert.ok(record, "package-desktop did not report a bundle");
  return record;
}

export function acceptanceRecord(output) {
  const record = parseJsonLines(output).findLast(
    (item) => item?.report && typeof item.report === "string",
  );
  assert.ok(record, "accept-desktop did not report an acceptance receipt");
  assert.equal(record.status, "PASSED", "Packaged acceptance did not pass");
  return record;
}

export function hasNotaryCredentials(env = process.env) {
  return ["APPLE_ID", "APPLE_TEAM_ID", "APPLE_APP_SPECIFIC_PASSWORD"].every(
    (key) => typeof env[key] === "string" && env[key].length > 0,
  );
}

export function assertReleaseSigningConfiguration(env = process.env) {
  const identity = env.DROGON_SIGNING_IDENTITY?.trim() || "";
  if (!identity) {
    assert.equal(
      env.DROGON_RELEASE_SIGNING ?? "",
      "",
      "DROGON_RELEASE_SIGNING requires a Developer ID identity",
    );
    return { developerId: false, identity: null };
  }
  assert.ok(
    hasNotaryCredentials(env),
    "DROGON_SIGNING_IDENTITY requires APPLE_ID, APPLE_TEAM_ID and APPLE_APP_SPECIFIC_PASSWORD",
  );
  return { developerId: true, identity };
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function zipBundle(bundle, archive) {
  assert.equal(
    process.platform,
    RELEASE_PLATFORM,
    "Release artifacts currently target macOS only",
  );
  await mkdir(path.dirname(archive), { recursive: true });
  await rm(archive, { force: true });
  // ditto is intentional: unlike a generic zip implementation it preserves
  // the app bundle's resource forks, symlinks and parent directory shape.
  await runAcceptanceProcess(
    "/usr/bin/ditto",
    ["-c", "-k", "--keepParent", bundle, archive],
    { timeout: 120000 },
  );
  return archive;
}

async function runPackager(root, version, signing) {
  const env = {
    ...process.env,
    DROGON_RELEASE_VERSION: version,
    DROGON_RELEASE_CHANNEL: "release",
  };
  if (signing.developerId) {
    env.DROGON_RELEASE_SIGNING = "developer-id-notarized";
    env.DROGON_SIGNING_IDENTITY = signing.identity;
  } else {
    delete env.DROGON_RELEASE_SIGNING;
    delete env.DROGON_SIGNING_IDENTITY;
  }
  const result = await runAcceptanceProcess(
    process.execPath,
    ["scripts/package-desktop.mjs"],
    {
      cwd: root,
      env,
      timeout: 1800000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return { ...packagedRecord(result.stdout), output: result.stdout };
}

async function runPackagedAcceptance(root, bundle) {
  const result = await runAcceptanceProcess(
    process.execPath,
    ["scripts/accept-desktop.mjs", "--bundle", bundle, "--files"],
    {
      cwd: root,
      env: {
        ...process.env,
        // Release validation must not activate or reveal a window on the
        // maintainer's Mac, just like every other Drogon acceptance run.
        DROGON_BACKGROUND_WINDOW: "1",
      },
      timeout: 1800000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const receipt = acceptanceRecord(result.stdout);
  const report = JSON.parse(await readFile(receipt.report, "utf8"));
  assert.equal(report.status, "PASSED");
  return { receipt, report, output: result.stdout };
}

async function notarizeBundle(bundle, root, version) {
  const temporary = path.join(
    tmpdir(),
    `drogon-${version}-${process.pid}-notarization.zip`,
  );
  try {
    await zipBundle(bundle, temporary);
    await runAcceptanceProcess(
      "/usr/bin/xcrun",
      [
        "notarytool",
        "submit",
        temporary,
        "--wait",
        "--apple-id",
        process.env.APPLE_ID,
        "--team-id",
        process.env.APPLE_TEAM_ID,
        "--password",
        process.env.APPLE_APP_SPECIFIC_PASSWORD,
      ],
      { cwd: root, timeout: 1800000, maxBuffer: 4 * 1024 * 1024 },
    );
    await runAcceptanceProcess(
      "/usr/bin/xcrun",
      ["stapler", "staple", bundle],
      { cwd: root, timeout: 300000, maxBuffer: 4 * 1024 * 1024 },
    );
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function createReleaseArtifacts({
  root,
  tag,
  output,
  runAcceptance = true,
} = {}) {
  assert.equal(
    process.platform,
    RELEASE_PLATFORM,
    "Releases target macOS only",
  );
  assert.equal(
    process.arch,
    RELEASE_ARCH,
    "Releases currently target Apple Silicon only",
  );
  assert.ok(root, "A checkout root is required");
  const version = versionFromTag(tag);
  const clean = await runAcceptanceProcess("git", ["status", "--porcelain"], {
    cwd: root,
  });
  assert.equal(
    clean.stdout.trim(),
    "",
    "Release packaging requires a clean checkout",
  );
  const [head, taggedHead] = await Promise.all([
    runAcceptanceProcess("git", ["rev-parse", "HEAD"], { cwd: root }),
    runAcceptanceProcess("git", ["rev-list", "-n", "1", `${tag}^{commit}`], {
      cwd: root,
    }),
  ]);
  assert.equal(
    head.stdout.trim(),
    taggedHead.stdout.trim(),
    `${tag} must point at the checkout being packaged`,
  );
  output ??= path.join(root, "dist", "releases");
  const { manifests } = await readProjectManifests(root);
  assert.equal(assertProjectVersions(manifests, version), version);
  const signing = assertReleaseSigningConfiguration(process.env);
  const packageResult = await runPackager(root, version, signing);
  const bundle = path.resolve(packageResult.bundle);
  const info = await verifiedBuildInfo(bundle);
  assert.equal(info.version, version);
  assert.equal(info.channel, "release");
  assert.equal(
    info.signed,
    signing.developerId
      ? "developer-id-notarized"
      : "local-ad-hoc-not-notarized",
  );
  const cli = bundlePaths(bundle).cli;
  const cliVersion = versionFromCliOutput(
    (await runAcceptanceProcess(cli, ["--version"], { cwd: root })).stdout,
  );
  assert.equal(
    cliVersion,
    version,
    `Bundled drogon-cli ${cliVersion} does not match release ${version}`,
  );

  // Stapling changes the final bundle, so notarize before the final
  // acceptance/zip pass. An ad-hoc release goes directly to acceptance.
  if (signing.developerId) await notarizeBundle(bundle, root, version);
  const acceptance = runAcceptance
    ? await runPackagedAcceptance(root, bundle)
    : null;
  const names = releaseArtifactNames(version);
  const archive = path.join(output, names.archive);
  await zipBundle(bundle, archive);
  const digest = await sha256File(archive);
  const checksum = path.join(output, names.checksum);
  await writeFile(checksum, `${digest}  ${names.archive}\n`);
  return {
    version,
    tag: `v${version}`,
    bundle,
    archive,
    checksum,
    sha256: digest,
    signed: info.signed,
    acceptanceReport: acceptance?.receipt.report ?? null,
  };
}

function usage() {
  return [
    "Usage: node scripts/release-desktop.mjs --tag vX.Y.Z [--output DIR] [--skip-acceptance]",
    "The tag must point at this clean checkout and match both package manifests.",
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  let tag = null;
  let output = path.join(root, "dist", "releases");
  let runAcceptance = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--tag") tag = argv[++index];
    else if (arg === "--output") output = path.resolve(argv[++index]);
    else if (arg === "--skip-acceptance") runAcceptance = false;
    else if (arg === "--help" || arg === "-h") {
      console.log(usage());
      return;
    } else assert.fail(usage());
  }
  assert.ok(tag, usage());
  const result = await createReleaseArtifacts({
    root,
    tag,
    output,
    runAcceptance,
  });
  console.log(JSON.stringify({ status: "RELEASE_ARTIFACTS_READY", ...result }));
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) await main();
