// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P5: the sha256 of a `drogond` binary, used as its
// build identity. `version` (CARGO_PKG_VERSION) cannot distinguish two
// builds of the same 0.1.0, so the freshly-installed bundle hashes its own
// bundled daemon and compares against the running daemon's self-reported
// `daemonArtifactSha256` (crates/drogon-core/src/lib.rs's
// `daemon_artifact_sha256`). Node-side mirror of the Rust digest: both
// hash the identical raw file bytes with sha256, so equal builds agree.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

/** Hex sha256 of `binaryPath`'s bytes, or null when it cannot be read as an
 *  ordinary file (never fabricated — null means "identity unknown"). */
export async function fileSha256Hex(binaryPath: string): Promise<string | null> {
  try {
    const info = await stat(binaryPath);
    if (!info.isFile()) return null;
    const hash = createHash("sha256");
    hash.update(await readFile(binaryPath));
    return hash.digest("hex");
  } catch {
    return null;
  }
}
