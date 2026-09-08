// MIT Copyright (c) 2026 Lovecast Inc.
// Main-process seam for `drogon:daemon:restart`: every effect (status,
// list/stop/shutdown calls, endpoint observation, spawn, sleep) is
// injected, so a restart is fully scriptable without a real daemon.
import { describe, expect, test, vi } from "vitest";
import {
  handleDaemonRestart,
  restartAvailability,
  type DaemonRestartDeps,
} from "./daemon-restart";
import type { Result } from "../shared/session-contract";
import { resultSchemas } from "../shared/result-validation";

function ok(result: unknown): Result<unknown> {
  return { ok: true, result };
}
function fail(code: string, message: string): Result<unknown> {
  return { ok: false, error: { code, message, retryable: false } };
}

const fences = { hostId: "h1", serviceInstanceId: "svc1" };

function deps(overrides: Partial<DaemonRestartDeps> = {}): DaemonRestartDeps {
  return {
    isPackaged: true,
    platform: "darwin",
    dataDir: "/data",
    packagedBinaryPath: "/pkg/drogond",
    devDaemonBinary: null,
    env: {},
    binaryExists: () => true,
    call: async () => fail("unverifiable", "down"),
    observeEndpoint: async () => ({ kind: "absent" }),
    spawn: async () => {},
    sleep: async () => {},
    pollIntervalMs: 1,
    shutdownWaitMs: 50,
    spawnDeadlineMs: 1_000,
    ...overrides,
  };
}

/** Scripted native surface: each entry answers the next call of that method. */
function scripted(
  scripts: Record<string, Array<() => Result<unknown>>>,
  seen: string[],
) {
  return async (method: string): Promise<Result<unknown>> => {
    seen.push(method);
    const queue = scripts[method];
    if (!queue || queue.length === 0)
      throw new Error(`unexpected native call: ${method}`);
    return queue.shift()!();
  };
}

describe("daemon restart availability", () => {
  test("the admitted shutdown reply has a native-client result schema", () => {
    expect(
      resultSchemas["runtime.shutdown"].safeParse({
        ...fences,
        accepted: true,
      }).success,
    ).toBe(true);
    expect(
      resultSchemas["runtime.shutdown"].safeParse({
        ...fences,
        accepted: false,
      }).success,
    ).toBe(false);
  });
  test("a dev daemon without the binary seam is external", () => {
    const availability = restartAvailability(
      deps({ isPackaged: false, devDaemonBinary: null }),
    );
    expect(availability.managed).toBe(false);
    expect(availability.reason).toMatch("started outside Drogon");
  });

  test("the dev seam makes the daemon managed", () => {
    const availability = restartAvailability(
      deps({ isPackaged: false, devDaemonBinary: "/repo/target/debug/drogond" }),
    );
    expect(availability).toEqual({ managed: true, reason: null });
  });

  test("a missing binary is unmanaged with its reason", () => {
    const availability = restartAvailability(
      deps({ binaryExists: () => false }),
    );
    expect(availability.managed).toBe(false);
    expect(availability.reason).toMatch("binary is missing");
  });
});

describe("handleDaemonRestart", () => {
  test("a probe never touches the service", async () => {
    const call = vi.fn(async () => fail("unverifiable", "down"));
    const result = await handleDaemonRestart(
      { probe: true },
      deps({ isPackaged: false, call }),
    );
    expect(result).toEqual({
      restarted: false,
      managed: false,
      reason: expect.stringMatching("started outside Drogon"),
      stoppedSessions: 0,
    });
    expect(call).not.toHaveBeenCalled();
  });

  test("invalid input is refused without acting", async () => {
    const spawn = vi.fn(async () => {});
    const result = await handleDaemonRestart({ probe: "yes" }, deps({ spawn }));
    expect(result.restarted).toBe(false);
    expect(result.reason).toBe("Invalid desktop request.");
    expect(spawn).not.toHaveBeenCalled();
  });

  test("an external daemon is never stopped", async () => {
    const call = vi.fn(async () => ok(fences));
    const result = await handleDaemonRestart(
      undefined,
      deps({ isPackaged: false, call }),
    );
    expect(result.restarted).toBe(false);
    expect(result.managed).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  test("stop-all, shutdown, absence and respawn restart the daemon", async () => {
    const seen: string[] = [];
    const spawn = vi.fn(async () => {});
    const call = scripted(
      {
        status: [
          () => ok(fences),
          // Absence poll: the old daemon answers once more, then is gone.
          () => ok(fences),
          () => fail("unverifiable", "down"),
          // Respawn poll: bootstrap observes down, spawns, then healthy.
          () => fail("unverifiable", "down"),
          () => ok({ ...fences, serviceInstanceId: "svc2" }),
        ],
        "workspace.list": [() => ok({ workspaces: [{ id: "w1" }] })],
        "session.list": [
          () =>
            ok({
              sessions: [
                { id: "s1", incarnation: "i1", workspaceId: "w1" },
              ],
            }),
        ],
        "session.stop": [() => ok({})],
        "runtime.shutdown": [
          () => ok({ ...fences, accepted: true }),
        ],
      },
      seen,
    );
    const result = await handleDaemonRestart(undefined, deps({ call, spawn }));
    expect(result).toEqual({
      restarted: true,
      managed: true,
      reason: null,
      stoppedSessions: 1,
    });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      "/pkg/drogond",
      ["--data-dir", "/data"],
      {},
    );
    expect(seen).toContain("runtime.shutdown");
  });

  test("a refused session stop aborts before the shutdown", async () => {
    const seen: string[] = [];
    const call = scripted(
      {
        status: [() => ok(fences)],
        "workspace.list": [() => ok({ workspaces: [{ id: "w1" }] })],
        "session.list": [
          () =>
            ok({
              sessions: [{ id: "s1", incarnation: "i1", workspaceId: "w1" }],
            }),
        ],
        "session.stop": [() => fail("stale_incarnation", "gone")],
      },
      seen,
    );
    const result = await handleDaemonRestart(undefined, deps({ call }));
    expect(result.restarted).toBe(false);
    expect(result.reason).toMatch("left running");
    expect(seen).not.toContain("runtime.shutdown");
  });

  test("a refused shutdown fails fast without spawning", async () => {
    const seen: string[] = [];
    const spawn = vi.fn(async () => {});
    const call = scripted(
      {
        status: [() => ok(fences)],
        "workspace.list": [() => ok({ workspaces: [] })],
        "runtime.shutdown": [() => fail("runtime_busy", "a session is live")],
      },
      seen,
    );
    const result = await handleDaemonRestart(undefined, deps({ call, spawn }));
    expect(result.restarted).toBe(false);
    expect(result.reason).toMatch("runtime_busy");
    expect(spawn).not.toHaveBeenCalled();
  });

  test("an already-down daemon is replaced without a shutdown", async () => {
    const seen: string[] = [];
    const call = scripted(
      {
        status: [
          () => fail("unverifiable", "down"),
          () => fail("unverifiable", "down"),
          () => ok({ ...fences, serviceInstanceId: "svc2" }),
        ],
      },
      seen,
    );
    const result = await handleDaemonRestart(undefined, deps({ call }));
    expect(result).toEqual({
      restarted: true,
      managed: true,
      reason: null,
      stoppedSessions: 0,
    });
    expect(seen).not.toContain("runtime.shutdown");
  });

  test("a replacement that never becomes healthy is reported honestly", async () => {
    let statuses = 0;
    const call = async (method: string): Promise<Result<unknown>> => {
      if (method === "status") {
        statuses += 1;
        return statuses === 1 ? ok(fences) : fail("unverifiable", "down");
      }
      if (method === "workspace.list") return ok({ workspaces: [] });
      if (method === "runtime.shutdown")
        return fail("internal_error", "expected contract");
      throw new Error(`unexpected native call: ${method}`);
    };
    const result = await handleDaemonRestart(
      undefined,
      deps({ call, spawnDeadlineMs: 20 }),
    );
    expect(result.restarted).toBe(false);
    expect(result.reason).toMatch(
      "did not become healthy (spawned-then-timed-out)",
    );
  });
});
