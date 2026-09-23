// PERF-01c: a real kill -9 plus restart over the same data dir must not
// wedge the client. The daemon mints a fresh `auth.token` on every boot
// while native-client caches the token keyed only by data dir; before the
// fix, every post-restart call (pool AND hold) answered `unauthorized`
// forever, because an unauthorized reply is a normal framed answer that
// nothing ever invalidated. This test parks a real hold, SIGKILLs the
// daemon, restarts it over the same dir, and proves both paths recover —
// it fails on the pre-fix client at the post-restart `status` call.
//
// Unix-only (SIGKILL semantics plus the unix-socket rendezvous) and bound
// to the workspace debug build the official `pnpm test` flow produces via
// `cargo test --workspace` first; a missing binary fails closed with the
// expected path rather than passing vacuously.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Worker-reuse hermeticity (docs/reference/desktop-test-isolation.md): the
// desktop suite shares one module registry per worker, and several main
// test files mock `../native-client`. A static import here would stay bound
// to whichever `../native-client` won the import race — a mock whose
// `callNative` never spawns the daemon this test kills and restarts.
// Rebinding the real client after a registry reset keeps the test pinned
// to the real transport under any file order.
let callNative: typeof import("./native-client").callNative;
let callNativeHold: typeof import("./native-client").callNativeHold;
let resetNativeClientForTests: typeof import("./native-client").resetNativeClientForTests;

const describeUnix = process.platform === "win32" ? describe.skip : describe;

function daemonBinary(): string {
  const candidate = fileURLToPath(
    new URL("../../../../target/debug/drogond", import.meta.url),
  );
  return candidate;
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

async function waitForTokenRotation(
  dataDir: string,
  previous: string | null,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const current = (
        await readFile(path.join(dataDir, "auth.token"), "utf8")
      ).trim();
      if (current && current !== previous) return current;
    } catch {
      // Not published yet.
    }
    if (Date.now() >= deadline)
      throw new Error("token was never (re)published");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describeUnix("native-client survives a kill -9 plus restart (PERF-01c)", () => {
  let scratchDir = "";
  let realDir = "";
  let originalDataDir: string | undefined;
  let daemon: ChildProcess | null = null;

  beforeEach(async () => {
    vi.resetModules();
    ({ callNative, callNativeHold, resetNativeClientForTests } = await import("./native-client"));
    resetNativeClientForTests();
    scratchDir = await mkdtemp(path.join(tmpdir(), "drogon-restart-test-"));
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

  test("parked hold plus pooled calls recover after the token rotates", async () => {
    const bin = daemonBinary();
    try {
      await readFile(bin);
    } catch {
      throw new Error(
        `restart test needs the workspace debug daemon at ${bin} (run cargo test --workspace first)`,
      );
    }
    const start = (extraEnv: NodeJS.ProcessEnv = {}): ChildProcess => {
      const child = spawn(bin, ["--data-dir", realDir], {
        stdio: "ignore",
        env: { ...process.env, ...extraEnv },
      });
      daemon = child;
      return child;
    };
    // Boot the first daemon and warm the client's credential cache.
    start();
    const firstToken = await waitForTokenRotation(realDir, null, 20_000);
    const warm = await callNative("status", {}, randomUUID());
    expect(warm.ok).toBe(true);
    // Park a real hold, exactly like the singleton state loop and every
    // visible terminal pane do mid-session.
    const parked = callNativeHold(
      "session.events.poll",
      { afterSeq: 0, waitMs: 20_000 },
      25_000,
      false,
      randomUUID(),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Kill -9 mid-hold, exactly like the rendered restart probe.
    daemon!.kill("SIGKILL");
    await waitForExit(daemon!, 10_000);
    daemon = null;
    // The dying hold reports loss of contact — never exit.
    const settled = await parked;
    expect(settled.ok).toBe(false);
    if (!settled.ok) expect(settled.error.code).toBe("unverifiable");
    // While the daemon is down the app keeps calling (the state push
    // loop, pane retries): that down-window call re-caches the OLD file
    // token, which is exactly the poison the restart then strands. Skip
    // it and the cache would stay empty until after the rotation, hiding
    // the wedge this test exists to pin.
    const down = await callNative("status", {}, randomUUID());
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.error.code).toBe("unverifiable");
    // Restart over the same data dir: the token rotates under the cache.
    start();
    const secondToken = await waitForTokenRotation(realDir, firstToken, 20_000);
    expect(secondToken).not.toBe(firstToken);
    // The pre-fix client answers this `unauthorized` forever; the fixed
    // client re-reads the rotated file once and resends the same id.
    const status = await callNative("status", {}, randomUUID());
    expect(status.ok).toBe(true);
    const events = await callNativeHold(
      "session.events.poll",
      { afterSeq: 0, waitMs: 1_000 },
      10_000,
      false,
      randomUUID(),
    );
    expect(events.ok).toBe(true);
  }, 60_000);
});
