#!/usr/bin/env node
// MIT Copyright (c) 2026 Lovecast Inc.
//
// Stage the unmodified official mentu-ai release at build time. Downloads
// and cached copies must match the pinned digest; installed apps stay offline.
// Keep the lock in sync with crates/drogon-core/src/mentu/runtime.rs and
// apps/desktop/src/main/mentu-bridge.ts.

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Must match crates/drogon-core/src/mentu/runtime.rs.
export const MENTU_LOCK_REVISION = "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3";
export const MENTU_LOCK_VERSION = "0.5.0";
export const MENTU_LOCK_SHA256 =
  "f00528a940185e9433ad65b02e7de251d7d3d856c9d24d38f8b1474a1ca8bc5d";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** Where `scripts/package-desktop.mjs` looks for a bundled runtime to ship, and where the dev app looks for one at `apps/desktop/resources/...` when unpackaged. */
export function bundledRuntimeDestination(projectRoot = repoRoot) {
  return join(
    projectRoot,
    "apps",
    "desktop",
    "resources",
    "mentu-runtime",
    MENTU_LOCK_REVISION,
    "bin",
    "mentu-recipes",
  );
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertApprovedExecutable(path, label) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`[mentu-runtime] ${label} must be a regular file: ${path}`);
  if ((info.mode & 0o111) === 0)
    throw new Error(`[mentu-runtime] ${label} is not executable: ${path}`);
  const sha256 = sha256File(path);
  if (sha256 !== MENTU_LOCK_SHA256)
    throw new Error(
      `[mentu-runtime] ${label} does not match the approved ${MENTU_LOCK_VERSION} runtime lock ` +
        `(expected ${MENTU_LOCK_SHA256}, got ${sha256}).`,
    );
  return sha256;
}

/**
 * Verifies `sourcePath` against the pinned lock and, only on a match,
 * atomically stages it at `bundledRuntimeDestination()`. Idempotent: a
 * destination already holding the identical verified bytes is left
 * untouched. Staged via a sibling temp file + rename (never a partial
 * write at the final path), mirroring the reference's own
 * `provisionMentuRuntime`.
 */
export function provisionMentuRuntime(sourcePath, projectRoot = repoRoot) {
  const sha256 = assertApprovedExecutable(sourcePath, "provision source");
  const destination = bundledRuntimeDestination(projectRoot);
  if (existsSync(destination) && sha256File(destination) === sha256)
    return { status: "already-provisioned", path: destination, sha256 };

  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    copyFileSync(sourcePath, temporary);
    chmodSync(temporary, 0o755);
    assertApprovedExecutable(temporary, "staged runtime");
    if (existsSync(destination)) rmSync(destination, { force: true });
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
  return { status: "provisioned", path: destination, sha256 };
}

export const MENTU_RELEASE_URL =
  `https://github.com/mentu-ai/mentu-recipes/releases/download/v${MENTU_LOCK_VERSION}/mentu-recipes-macos-arm64`;
const LICENSE_URL =
  `https://raw.githubusercontent.com/mentu-ai/mentu-recipes/${MENTU_LOCK_REVISION}/LICENSE`;
const LICENSE_SHA256 = "5d4ae61c014a23d64498a33c41c6d2288bd5e4f21e9e8ceaea452d8fd0715314";

async function downloadVerified(url, digest, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Mentu download failed (${response.status}): ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== digest) throw new Error(`Mentu download checksum mismatch: ${url}`);
  return bytes;
}

/** Required for Apple Silicon packages; never trust an unchecked cached runtime. */
export async function ensureOfficialMentuRuntime(projectRoot = repoRoot, fetchImpl = fetch) {
  const destination = bundledRuntimeDestination(projectRoot);
  const licensePath = join(dirname(dirname(destination)), "LICENSE");
  if (existsSync(destination)) {
    assertApprovedExecutable(destination, "cached runtime");
    if (existsSync(licensePath) && sha256File(licensePath) === LICENSE_SHA256) {
      return { status: "already-provisioned", path: destination, sha256: MENTU_LOCK_SHA256 };
    }
  }
  const temporary = await mkdtemp(join(tmpdir(), "drogon-mentu-download-"));
  try {
    const license = await downloadVerified(LICENSE_URL, LICENSE_SHA256, fetchImpl);
    let result = { status: "already-provisioned", path: destination, sha256: MENTU_LOCK_SHA256 };
    if (!existsSync(destination)) {
      const binary = await downloadVerified(MENTU_RELEASE_URL, MENTU_LOCK_SHA256, fetchImpl);
      const source = join(temporary, "mentu-recipes");
      await writeFile(source, binary, { mode: 0o755 });
      result = provisionMentuRuntime(source, projectRoot);
    }
    await writeFile(licensePath, license);
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function argumentValue(name) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

// Only run the CLI body when this file is the process entry point, not
// when `scripts/package-desktop.mjs` or a test imports these functions.
if (import.meta.url === `file://${process.argv[1]}`) {
  const sourceArgument = argumentValue("--source") ?? process.env.DROGON_MENTU_RUNTIME_SOURCE;
  if (!sourceArgument) {
    console.error(
      "[mentu-runtime] usage: node scripts/mentu-runtime-provision.mjs --source <path-to-a-locally-built-mentu-recipes>",
    );
    process.exit(1);
  }
  const result = provisionMentuRuntime(resolve(process.cwd(), sourceArgument));
  console.log(`[mentu-runtime] ${result.status}: ${result.path} (${result.sha256})`);
}
