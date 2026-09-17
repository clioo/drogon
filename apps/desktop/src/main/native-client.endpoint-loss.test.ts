// PERF-02c at client level against the real daemon: warm the pool, rename
// the live socket file away with the daemon still running, and prove the
// client stops reporting success. A fake-transport unit test cannot see
// this failure — it needs the kernel's rename semantics (established
// connections keep serving) plus a real listener — and neither can a stub
// peer. Fails on the pre-watchdog client, where the warm entry keeps
// answering through the whole outage; passes after, with no seam and no
// timing tricks beyond the production 2 s watchdog cadence.
//
// Unix-only (socket-namespace rename; same gate as the restart suite) and
// bound to the workspace debug build the official `pnpm test` flow
// produces via `cargo test --workspace` first; a missing binary fails
// closed with the expected path rather than passing vacuously.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  callNative,
  getNativeConnectionStats,
  resetNativeClientForTests,
  resetNativeConnectionStatsForTests,
} from "./native-client";

const describeUnix = process.platform === "win32" ? describe.skip : describe;

function daemonBinary(): string {
  return fileURLToPath(
    new URL("../../../../target/debug/drogond", import.meta.url),
  );
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeAllListeners("exit");
      reject(new Error("daemon did not exit in time"));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describeUnix("pooled transport surfaces endpoint loss (real daemon)", () => {
  let scratchDir = "";
  let realDir = "";
  let originalDataDir: string | undefined;
  let daemon: ChildProcess | null = null;

  async function waitForStatusOk(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const reply = await callNative("status", {}, `req-boot-${Date.now()}`);
      if (reply.ok) return;
      if (Date.now() >= deadline)
        throw new Error("real daemon never answered status");
      await delay(100);
    }
  }

  beforeEach(async () => {
    resetNativeClientForTests();
    scratchDir = await mkdtemp(path.join(tmpdir(), "drogon-pool-loss-"));
    realDir = await realpath(scratchDir);
    originalDataDir = process.env.DROGON_DATA_DIR;
    process.env.DROGON_DATA_DIR = realDir;
  });

  afterEach(async () => {
    if (daemon) {
      const owned = daemon;
      daemon = null;
      try {
        owned.kill("SIGKILL");
      } catch {
        // Already gone; the wait below owns the verdict.
      }
      await waitForExit(owned, 10_000).catch(() => {});
      if (owned.exitCode === null && owned.signalCode === null) {
        throw new Error("test-owned daemon survived SIGKILL");
      }
    }
    resetNativeClientForTests();
    if (originalDataDir === undefined) delete process.env.DROGON_DATA_DIR;
    else process.env.DROGON_DATA_DIR = originalDataDir;
    if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
  });

  test("renaming the live socket stops success reports", async () => {
    const bin = daemonBinary();
    try {
      await readFile(bin);
    } catch {
      throw new Error(
        `endpoint-loss test needs the workspace debug daemon at ${bin} (run cargo test --workspace first)`,
      );
    }
    daemon = spawn(bin, ["--data-dir", realDir], {
      stdio: "ignore",
      env: { ...process.env },
    });
    await waitForStatusOk(20_000);
    expect(getNativeConnectionStats().connections).toBeGreaterThanOrEqual(1);
    // Start from a known pool shape: one warm entry, one counted dial, so
    // the masking premise holds — every later call would reuse it if the
    // client never retested the path.
    resetNativeClientForTests();
    resetNativeConnectionStatsForTests();
    expect((await callNative("status", {}, "req-warm")).ok).toBe(true);
    expect(getNativeConnectionStats().connections).toBe(1);
    const sockPath = path.join(realDir, "runtime-v1.sock");
    await rename(sockPath, path.join(realDir, "outage.sock"));
    // No poke, no seam: the background watchdog (2 s) must notice on its
    // own. Pre-fix this loop never surfaces — the warm entry keeps
    // answering — and the test fails here; post-fix the first check after
    // the tick tests the path and reports `unverifiable`.
    let surfaced: Awaited<ReturnType<typeof callNative>> | null = null;
    const outageDeadline = Date.now() + 15_000;
    for (let i = 0; ; i++) {
      const probe = await callNative("status", {}, `req-outage-${i}`);
      if (!probe.ok) {
        surfaced = probe;
        break;
      }
      if (Date.now() >= outageDeadline) break;
      await delay(100);
    }
    expect(surfaced?.ok).toBe(false);
    if (surfaced && !surfaced.ok) {
      expect(surfaced.error.code).toBe("unverifiable");
      expect(surfaced.error.retryable).toBe(true);
    }
    await rename(path.join(realDir, "outage.sock"), sockPath);
    const restoreDeadline = Date.now() + 15_000;
    for (;;) {
      const probe = await callNative("status", {}, `req-restored-${Date.now()}`);
      if (probe.ok) break;
      if (Date.now() >= restoreDeadline)
        throw new Error("status never recovered after the socket came back");
      await delay(100);
    }
  }, 60_000);
});
