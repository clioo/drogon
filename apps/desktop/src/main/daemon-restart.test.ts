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
        "session.list": [
          () =>
            ok({
              sessions: [
                {
                  id: "s1",
                  incarnation: "i1",
                  workspaceId: "w1",
                  verdict: "live",
                },
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

  test("waits for the old endpoint to disappear before respawning", async () => {
    const seen: string[] = [];
    const spawn = vi.fn(async () => {});
    const endpointStates = ["present", "absent", "absent"] as const;
    let endpointReads = 0;
    const observeEndpoint = vi.fn(async () => ({
      kind: endpointStates[
        Math.min(endpointReads++, endpointStates.length - 1)
      ],
    }));
    const call = scripted(
      {
        status: [
          () => ok(fences),
          () => fail("unverifiable", "down"),
          () => fail("unverifiable", "down"),
          () => ok({ ...fences, serviceInstanceId: "svc2" }),
        ],
        "session.list": [() => ok({ sessions: [] })],
        "runtime.shutdown": [() => ok({ ...fences, accepted: true })],
      },
      seen,
    );
    const result = await handleDaemonRestart(
      undefined,
      deps({ call, spawn, observeEndpoint }),
    );
    expect(result).toEqual({
      restarted: true,
      managed: true,
      reason: null,
      stoppedSessions: 0,
    });
    expect(observeEndpoint).toHaveBeenCalledTimes(4);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test("a refused session stop aborts before the shutdown", async () => {
    const seen: string[] = [];
    const call = scripted(
      {
        status: [() => ok(fences)],
        "session.list": [
          () =>
            ok({
              sessions: [
                {
                  id: "s1",
                  incarnation: "i1",
                  workspaceId: "w1",
                  verdict: "live",
                },
              ],
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
        "session.list": [() => ok({ sessions: [] })],
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
      if (method === "session.list") return ok({ sessions: [] });
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

describe("handleDaemonRestart session settlement (post-restart recovery)", () => {
  /** Like `scripted`, but records the params so the verb per verdict is provable. */
  function recording(
    scripts: Record<string, Array<() => Result<unknown>>>,
    calls: Array<{ method: string; params: unknown }>,
  ) {
    return async (
      method: string,
      params: object,
    ): Promise<Result<unknown>> => {
      calls.push({ method, params });
      const queue = scripts[method];
      if (!queue || queue.length === 0)
        throw new Error(`unexpected native call: ${method}`);
      return queue.shift()!();
    };
  }

  test("an orphaned live session is stopped, a post-restart stub is closed, and the shutdown is admitted", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const spawn = vi.fn(async () => {});
    const call = recording(
      {
        status: [
          () => ok(fences),
          () => fail("unverifiable", "down"),
          () => fail("unverifiable", "down"),
          () => ok({ ...fences, serviceInstanceId: "svc2" }),
        ],
        // Host-wide, and both rows point at a Workspace that no longer
        // exists: a per-workspace enumeration sees neither.
        "session.list": [
          () =>
            ok({
              sessions: [
                {
                  id: "s-orphan",
                  incarnation: "i1",
                  workspaceId: "removed-workspace",
                  verdict: "live",
                },
                {
                  id: "s-stub",
                  incarnation: "i2",
                  workspaceId: "removed-workspace",
                  verdict: "unverifiable",
                },
              ],
            }),
        ],
        "session.stop": [() => ok({ verdict: "exited" })],
        "session.close": [() => ok({ verdict: "unverifiable" })],
        "runtime.shutdown": [() => ok({ ...fences, accepted: true })],
      },
      calls,
    );
    const result = await handleDaemonRestart(undefined, deps({ call, spawn }));

    expect(result).toEqual({
      restarted: true,
      managed: true,
      reason: null,
      stoppedSessions: 2,
    });
    const called = (method: string) =>
      calls.filter((entry) => entry.method === method);
    expect(called("workspace.list")).toEqual([]);
    expect(called("session.stop")).toEqual([
      {
        method: "session.stop",
        params: { sessionId: "s-orphan", incarnation: "i1" },
      },
    ]);
    expect(called("session.close")).toEqual([
      {
        method: "session.close",
        params: { sessionId: "s-stub", incarnation: "i2" },
      },
    ]);
    expect(called("runtime.shutdown")).toHaveLength(1);
  });

  test("a stub that cannot be closed aborts before the shutdown and names the refusal", async () => {
    const call = scripted(
      {
        status: [() => ok(fences)],
        "session.list": [
          () =>
            ok({
              sessions: [
                {
                  id: "s-stub",
                  incarnation: "i2",
                  workspaceId: "w1",
                  verdict: "unverifiable",
                },
              ],
            }),
        ],
        "session.close": [() => fail("not_found", "session not found")],
      },
      [],
    );
    const result = await handleDaemonRestart(undefined, deps({ call }));
    expect(result.restarted).toBe(false);
    expect(result.reason).toMatch("left running");
    expect(result.reason).toMatch("1 of 1");
  });

  test("a session list without verdicts still settles rows (older daemons)", async () => {
    // `verdict` is additive on the wire; a row that omits it is not live by
    // default — closing it is the only verb that can clear an unknown.
    const calls: Array<{ method: string; params: unknown }> = [];
    const call = recording(
      {
        status: [() => ok(fences)],
        "session.list": [
          () =>
            ok({
              sessions: [{ id: "s1", incarnation: "i1", workspaceId: "w1" }],
            }),
        ],
        "session.close": [() => ok({})],
        "runtime.shutdown": [() => fail("runtime_busy", "still unsettled")],
      },
      calls,
    );
    const result = await handleDaemonRestart(undefined, deps({ call }));
    expect(result.restarted).toBe(false);
    expect(result.reason).toMatch("runtime_busy");
    expect(
      calls.filter((entry) => entry.method === "session.close"),
    ).toHaveLength(1);
    expect(
      calls.filter((entry) => entry.method === "session.stop"),
    ).toHaveLength(0);
  });
});
