import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  bootstrapNativeRuntime,
  spawnDetachedDaemon,
  type BootstrapDeps,
} from "./native-runtime-bootstrap";
import {
  observeLocalEndpoint,
  resolveEndpointPath,
  type LocalEndpointObservation,
} from "./native-client";
import type { Result, Status } from "../shared/session-contract";

const status: Status = {
  hostId: "h1",
  serviceInstanceId: "svc1",
  protocol: 1,
  capabilities: [],
  version: "0.1.0",
};

function baseDeps(overrides: Partial<BootstrapDeps> = {}): BootstrapDeps {
  return {
    isPackaged: true,
    platform: "darwin",
    binaryExists: () => true,
    checkStatus: vi.fn(async (): Promise<Result<Status>> => ({
      ok: true,
      result: status,
    })),
    observeLocalEndpoint: vi.fn(async () => ({ kind: "absent" }) as const),
    spawnDaemon: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
    pollIntervalMs: 10,
    deadlineMs: 200,
    ...overrides,
  };
}

const unverifiable: Result<Status> = {
  ok: false,
  error: { code: "unverifiable", message: "cannot reach", retryable: true },
};

// Never settles on its own, regardless of the signal — a stand-in for a
// real socket wedged past its own internal timeout, used to prove the
// *overall* bootstrap budget is what ends the wait, not the callee.
function neverSettles<T>(): Promise<T> {
  return new Promise(() => undefined);
}

describe("native runtime bootstrap", () => {
  test("development never spawns, regardless of service state", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        isPackaged: false,
        checkStatus: async () => unverifiable,
        spawnDaemon,
      }),
    );
    expect(outcome).toEqual({ kind: "not-packaged" });
    expect(spawnDaemon).not.toHaveBeenCalled();
  });

  test("an already-healthy service is attached to, never spawned over", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const checkStatus = vi.fn(async (): Promise<Result<Status>> => ({
      ok: true,
      result: status,
    }));
    const outcome = await bootstrapNativeRuntime(
      baseDeps({ spawnDaemon, checkStatus }),
    );
    expect(outcome).toEqual({ kind: "already-healthy" });
    expect(spawnDaemon).not.toHaveBeenCalled();
    expect(checkStatus).toHaveBeenCalledTimes(1);
  });

  test("a positively absent endpoint (fresh install) is spawned exactly once", async () => {
    let calls = 0;
    const spawnDaemon = vi.fn(async () => undefined);
    const checkStatus = vi.fn(async (): Promise<Result<Status>> => {
      calls += 1;
      return calls === 1 ? unverifiable : { ok: true, result: status };
    });
    const observeLocalEndpointDep = vi.fn(
      async () => ({ kind: "absent" }) as const,
    );
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        spawnDaemon,
        checkStatus,
        observeLocalEndpoint: observeLocalEndpointDep,
      }),
    );
    expect(outcome).toEqual({ kind: "spawned-then-healthy" });
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
    expect(observeLocalEndpointDep).toHaveBeenCalledTimes(1);
  });

  test("an unverifiable status with the endpoint observed as present never spawns (e.g. missing/unreadable auth token against a live daemon)", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        checkStatus: async () => unverifiable,
        observeLocalEndpoint: async () => ({ kind: "present" }),
        spawnDaemon,
      }),
    );
    expect(outcome).toEqual({ kind: "endpoint-present-not-spawning" });
    expect(spawnDaemon).not.toHaveBeenCalled();
  });

  test("an ambiguous local observation (access denied, unknown connect error, probe timeout) never spawns", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        checkStatus: async () => unverifiable,
        observeLocalEndpoint: async () => ({
          kind: "ambiguous",
          reason: "eacces",
        }),
        spawnDaemon,
      }),
    );
    expect(outcome).toEqual({
      kind: "endpoint-ambiguous-not-spawning",
      reason: "eacces",
    });
    expect(spawnDaemon).not.toHaveBeenCalled();
  });

  test("an answered-but-wrong response (unauthorized/malformed) never triggers a spawn, and never even reaches the local endpoint probe", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const observeLocalEndpointDep = vi.fn(
      async () => ({ kind: "absent" }) as const,
    );
    const checkStatus = vi.fn(async (): Promise<Result<Status>> => ({
      ok: false,
      error: { code: "unauthorized", message: "bad token", retryable: false },
    }));
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        spawnDaemon,
        checkStatus,
        observeLocalEndpoint: observeLocalEndpointDep,
      }),
    );
    expect(outcome).toEqual({
      kind: "answered-but-not-ok",
      code: "unauthorized",
    });
    expect(spawnDaemon).not.toHaveBeenCalled();
    expect(observeLocalEndpointDep).not.toHaveBeenCalled();
  });

  test("a malformed-response code also never triggers a spawn", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const checkStatus = vi.fn(async (): Promise<Result<Status>> => ({
      ok: false,
      error: { code: "internal_error", message: "bad shape", retryable: false },
    }));
    const outcome = await bootstrapNativeRuntime(
      baseDeps({ spawnDaemon, checkStatus }),
    );
    expect(outcome).toEqual({
      kind: "answered-but-not-ok",
      code: "internal_error",
    });
    expect(spawnDaemon).not.toHaveBeenCalled();
  });

  test("a spawn that synchronously throws is reported, not swallowed or retried", async () => {
    const spawnDaemon = vi.fn(() => {
      throw new Error("EACCES");
    });
    const outcome = await bootstrapNativeRuntime(
      baseDeps({ checkStatus: async () => unverifiable, spawnDaemon }),
    );
    expect(outcome).toEqual({ kind: "spawn-failed", message: "EACCES" });
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
  });

  test("a spawn whose promise rejects asynchronously (the real child_process 'error' event shape) is reported, not left pending", async () => {
    const spawnDaemon = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) =>
          setTimeout(() => reject(new Error("ENOENT")), 0),
        ),
    );
    const outcome = await bootstrapNativeRuntime(
      baseDeps({ checkStatus: async () => unverifiable, spawnDaemon }),
    );
    expect(outcome).toEqual({ kind: "spawn-failed", message: "ENOENT" });
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
  });

  test("readiness that never arrives within the budget is an honest timeout, not a fabricated success", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const checkStatus = vi.fn(
      async (): Promise<Result<Status>> => unverifiable,
    );
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        spawnDaemon,
        checkStatus,
        deadlineMs: 30,
        pollIntervalMs: 10,
      }),
    );
    expect(outcome).toEqual({ kind: "spawned-then-timed-out" });
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
  });

  test("Windows never attempts a spawn, even when the service is absent", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const observeLocalEndpointDep = vi.fn(
      async () => ({ kind: "absent" }) as const,
    );
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        platform: "win32",
        checkStatus: async () => unverifiable,
        observeLocalEndpoint: observeLocalEndpointDep,
        spawnDaemon,
      }),
    );
    expect(outcome).toEqual({ kind: "unsupported-platform" });
    expect(spawnDaemon).not.toHaveBeenCalled();
    // Win32 is rejected before the local endpoint probe is even consulted —
    // no code path exists for an "unsupported platform, but let's still
    // probe" state.
    expect(observeLocalEndpointDep).not.toHaveBeenCalled();
  });

  test("a missing bundled binary is reported rather than attempting to spawn nothing", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        checkStatus: async () => unverifiable,
        binaryExists: () => false,
        spawnDaemon,
      }),
    );
    expect(outcome).toEqual({ kind: "binary-missing" });
    expect(spawnDaemon).not.toHaveBeenCalled();
  });

  test("a genuinely stuck initial status call is bounded by the whole-bootstrap deadline, not left hanging (was reproduced against the prior single-timer implementation before this fix)", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const started = Date.now();
    const outcome = await bootstrapNativeRuntime(
      baseDeps({ checkStatus: neverSettles, deadlineMs: 40, spawnDaemon }),
    );
    expect(outcome).toEqual({ kind: "observation-timed-out" });
    expect(spawnDaemon).not.toHaveBeenCalled();
    // Bounded, not merely "eventually finished": well under the request
    // layer's own much longer internal timeouts.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("a genuinely stuck post-spawn status poll (the call itself never settles, not merely a fast repeated 'not yet') is bounded by the same whole-bootstrap deadline", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    let calls = 0;
    // First call is the pre-spawn initial check (must answer "unverifiable"
    // to reach the spawn decision at all); every call after that is a
    // post-spawn poll, and never settles — a real stand-in for a wedged
    // socket, not a same-tick "not yet" that would trivially loop to the
    // deadline regardless of whether polls are actually bounded.
    const checkStatus = vi.fn((): Promise<Result<Status>> => {
      calls += 1;
      return calls === 1 ? Promise.resolve(unverifiable) : neverSettles();
    });
    const started = Date.now();
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        checkStatus,
        observeLocalEndpoint: async () => ({ kind: "absent" }),
        spawnDaemon,
        deadlineMs: 40,
        pollIntervalMs: 5,
      }),
    );
    expect(outcome).toEqual({ kind: "spawned-then-timed-out" });
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
    expect(calls).toBeGreaterThan(1);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("a sleep dependency that never settles does not itself hang the poll loop past the deadline", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const started = Date.now();
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        checkStatus: async () => unverifiable,
        observeLocalEndpoint: async () => ({ kind: "absent" }),
        spawnDaemon,
        sleep: neverSettles,
        deadlineMs: 40,
        pollIntervalMs: 5,
      }),
    );
    expect(outcome).toEqual({ kind: "spawned-then-timed-out" });
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("a sleep dependency that throws synchronously is never pre-evaluated outside the race, so it cannot escape as an uncaught exception", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const sleep = vi.fn((): Promise<void> => {
      throw new Error("sleep dependency misbehaved");
    });
    await expect(
      bootstrapNativeRuntime(
        baseDeps({
          checkStatus: async () => unverifiable,
          observeLocalEndpoint: async () => ({ kind: "absent" }),
          spawnDaemon,
          sleep,
          deadlineMs: 40,
          pollIntervalMs: 5,
        }),
      ),
    ).resolves.toEqual({ kind: "spawned-then-timed-out" });
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
  });

  test("a binaryExists dependency that throws is reported as its own distinct outcome, not attempted as a spawn", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const binaryExists = vi.fn((): boolean => {
      throw new Error("permission denied reading resources/bin");
    });
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        checkStatus: async () => unverifiable,
        observeLocalEndpoint: async () => ({ kind: "absent" }),
        binaryExists,
        spawnDaemon,
      }),
    );
    expect(outcome).toEqual({
      kind: "binary-check-failed",
      message: "permission denied reading resources/bin",
    });
    expect(spawnDaemon).not.toHaveBeenCalled();
  });

  test("a spawn that never settles is bounded by the whole-bootstrap deadline, not left hanging, and never retried", async () => {
    const spawnDaemon = vi.fn(() => neverSettles<void>());
    const started = Date.now();
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        checkStatus: async () => unverifiable,
        spawnDaemon,
        deadlineMs: 40,
      }),
    );
    expect(outcome).toEqual({ kind: "spawn-timed-out" });
    expect(spawnDaemon).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("a checkStatus dependency that throws synchronously (violating its own contract) is reported as a distinct failure, never mislabeled a timeout, and never left as an uncaught rejection that would skip window creation", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const checkStatus = vi.fn((): Promise<Result<Status>> => {
      throw new Error(
        "dependency misbehaved: threw instead of returning a promise",
      );
    });
    const started = Date.now();
    await expect(
      bootstrapNativeRuntime(
        baseDeps({ checkStatus, spawnDaemon, deadlineMs: 5_000 }),
      ),
    ).resolves.toEqual({
      kind: "observation-failed",
      message: "dependency misbehaved: threw instead of returning a promise",
    });
    expect(spawnDaemon).not.toHaveBeenCalled();
    // No deadline actually elapsed (budget was 5s) — this must resolve
    // immediately as a failure, not wait out a timer it never needed.
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("an observeLocalEndpoint dependency that throws synchronously is likewise reported as a distinct failure, never crashing bootstrap", async () => {
    const spawnDaemon = vi.fn(async () => undefined);
    const observeLocalEndpointDep = vi.fn(
      (): Promise<LocalEndpointObservation> => {
        throw new Error("dependency misbehaved");
      },
    );
    const started = Date.now();
    await expect(
      bootstrapNativeRuntime(
        baseDeps({
          checkStatus: async () => unverifiable,
          observeLocalEndpoint: observeLocalEndpointDep,
          spawnDaemon,
          deadlineMs: 5_000,
        }),
      ),
    ).resolves.toEqual({
      kind: "observation-failed",
      message: "dependency misbehaved",
    });
    expect(spawnDaemon).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("real launch adapter (spawnDetachedDaemon)", () => {
  let scratchDir: string;

  afterEach(async () => {
    if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
  });

  // A genuinely nonexistent binary path inside an owned, cleaned-up temp
  // directory: Node's real `child_process.spawn` reports this as an async
  // ENOENT `error` event, never a synchronous throw. This is the exact
  // shape the pure decision core above must not swallow, hang on, or leave
  // as an unhandled rejection.
  async function nonexistentBinaryPath(): Promise<string> {
    scratchDir = await mkdtemp(path.join(tmpdir(), "drogon-bootstrap-test-"));
    return path.join(scratchDir, "does-not-exist", "drogond");
  }

  test("a nonexistent binary rejects (real async ENOENT), it does not hang or throw synchronously", async () => {
    const binary = await nonexistentBinaryPath();
    await expect(
      spawnDetachedDaemon(binary, ["--data-dir", scratchDir], process.env),
    ).rejects.toThrow();
  });

  test("that rejection is exactly what the pure decision core reports as spawn-failed", async () => {
    const binary = await nonexistentBinaryPath();
    const outcome = await bootstrapNativeRuntime(
      baseDeps({
        checkStatus: async () => unverifiable,
        spawnDaemon: () => spawnDetachedDaemon(binary, [], process.env),
      }),
    );
    expect(outcome.kind).toBe("spawn-failed");
  });
});

describe("real local endpoint probe against an owned fixture socket", () => {
  let scratchDir: string;

  afterEach(async () => {
    if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
  });

  test("a missing/unreadable auth token against a real live local socket is observed as present, and bootstrap does not spawn", async () => {
    scratchDir = await mkdtemp(path.join(tmpdir(), "drogon-bootstrap-probe-"));
    const socketPath = resolveEndpointPath(scratchDir, "darwin");
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      const spawnDaemon = vi.fn(async () => undefined);
      const outcome = await bootstrapNativeRuntime(
        baseDeps({
          // Simulates `callNative` failing the same way for a missing auth
          // token as for a genuinely absent daemon — the exact ambiguity
          // this task requires `observeLocalEndpoint` to resolve.
          checkStatus: async () => unverifiable,
          observeLocalEndpoint: (signal) =>
            observeLocalEndpoint(scratchDir, "darwin", 2_000, signal),
          spawnDaemon,
        }),
      );
      expect(outcome).toEqual({ kind: "endpoint-present-not-spawning" });
      expect(spawnDaemon).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("no socket file at all (fresh install) is observed as absent through the real probe", async () => {
    scratchDir = await mkdtemp(path.join(tmpdir(), "drogon-bootstrap-probe-"));
    const observation = await observeLocalEndpoint(scratchDir, "darwin", 2_000);
    expect(observation).toEqual({ kind: "absent" });
  });
});
