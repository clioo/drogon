#!/usr/bin/env node
// MIT Copyright (c) 2026 Lovecast Inc.
//
// Mirrors the read-only reference's build-time provisioning mechanism
// (`config/scripts/mentu-runtime-package.cjs`'s `provisionMentuRuntime`,
// invoked by `config/scripts/mentu-runtime-provision.mjs`): given an
// already-built `mentu-recipes` binary on this machine, verify its sha256
// against the pinned lock and, only on a match, atomically stage it where
// `scripts/package-desktop.mjs` can bundle it and the desktop app's
// one-time install (`apps/desktop/src/main/mentu-bridge.ts`) can find it in
// dev. This script never clones, builds or downloads `mentu-recipes`
// itself — same division of labor as the reference, where the pinned
// binary is always built out of band and only copied into place here.
//
// Adapted from the reference: this repo pins the lock as Rust constants in
// `crates/drogon-core/src/mentu/runtime.rs` (`MENTU_LOCK_REVISION`/
// `MENTU_LOCK_VERSION`/`MENTU_LOCK_SHA256`), not a checked-in
// `.mentu/mentu-runtime-lock.json`, so those three values are duplicated
// here — keep them in sync with that module.

import { createHash } from "node:crypto";
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
export const MENTU_LOCK_REVISION = "b72a1203d46c1d930be1aead65388ddfbe9a8fc4";
export const MENTU_LOCK_VERSION = "0.4.0";
export const MENTU_LOCK_SHA256 =
  "124ef7391cf060051f45307c88bb10509f5fd9e7d7a10e66516b3bdaf14aa504";

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
