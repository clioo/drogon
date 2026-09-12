// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P5 executor: the changed-binary restart is graceful
// by construction — it NEVER stops sessions, a busy/old daemon's refusal
// becomes the honest `pending` outcome with the daemon still attached, and
// a successful quiesce is followed by a respawn that must answer `status`.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  restartChangedDaemon,
  type DaemonUpdateRestartDeps,
} from "./daemon-update-restart";
import type { Result } from "../shared/session-contract";
import { resultSchemas } from "../shared/result-validation";

function ok(result: unknown): Result<unknown> {
  return { ok: true, result };
}
function fail(code: string, message: string): Result<unknown> {
  return { ok: false, error: { code, message, retryable: false } };
}

const fences = { hostId: "h1", serviceInstanceId: "svc1" };

function deps(overrides: Partial<DaemonUpdateRestartDeps> = {}): DaemonUpdateRestartDeps {
  return {
    platform: "darwin",
    target: { binaryPath: "/pkg/drogond", args: ["--data-dir", "/data"] },
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

describe("restartChangedDaemon", () => {
  test("a busy daemon (live sessions) is never killed: refusal becomes pending and no respawn happens", async () => {
    const spawned: string[] = [];
    const outcome = await restartChangedDaemon(
      deps({
        call: async (method) => {
          if (method === "status") return ok({ ...fences, protocol: 1 });
          if (method === "runtime.shutdown")
            return fail(
              "runtime_busy",
              "one or more sessions are pending, live or unverifiable",
            );
          return fail("method_not_found", method);
        },
        spawn: async (binaryPath) => {
          spawned.push(binaryPath);
        },
      }),
    );
    expect(outcome).toEqual({
      kind: "pending",
      reason:
        "The running service could not quiesce (runtime_busy): one or more sessions are pending, live or unverifiable",
    });
    expect(spawned).toEqual([]);
  });

  test("a daemon predating runtime.shutdown stays attached as pending", async () => {
    const outcome = await restartChangedDaemon(
      deps({
        call: async (method) =>
          method === "status"
            ? ok({ ...fences, protocol: 1 })
            : fail("method_not_found", "method_not_found: runtime.shutdown"),
      }),
    );
    expect(outcome.kind).toBe("pending");
  });

  test("an admitted shutdown waits for the endpoint to free, respawns, and reports restarted", async () => {
    let shutdownCalled = 0;
    let observations = 0;
    let replacementUp = false;
    const spawned: string[] = [];
    const outcome = await restartChangedDaemon(
      deps({
        call: async (method) => {
          if (method === "status") {
            // The old daemon answers until its shutdown; the replacement
            // only answers once spawned.
            return replacementUp
              ? ok({ protocol: 1 })
              : shutdownCalled > 0
                ? fail("unverifiable", "daemon exiting")
                : ok({ ...fences, protocol: 1 });
          }
          if (method === "runtime.shutdown") {
            shutdownCalled += 1;
            return ok({ ...fences, accepted: true });
          }
          return fail("method_not_found", method);
        },
        observeEndpoint: async () => {
          observations += 1;
          return observations >= 2 ? { kind: "absent" } : { kind: "present" };
        },
        spawn: async (binaryPath, args) => {
          replacementUp = true;
          spawned.push(`${binaryPath} ${args.join(" ")}`);
        },
      }),
    );
    expect(outcome).toEqual({ kind: "restarted" });
    expect(spawned).toEqual(["/pkg/drogond --data-dir /data"]);
  });

  test("a dead daemon between decision and shutdown is replaced directly", async () => {
    let replacementUp = false;
    const spawned: string[] = [];
    const outcome = await restartChangedDaemon(
      deps({
        call: async (method) =>
          method === "status" && replacementUp
            ? ok({ protocol: 1 })
            : fail("unverifiable", "connection refused"),
        spawn: async (binaryPath) => {
          replacementUp = true;
          spawned.push(binaryPath);
        },
      }),
    );
    expect(outcome).toEqual({ kind: "restarted" });
    expect(spawned).toEqual(["/pkg/drogond"]);
  });

  test("a respawn that never becomes healthy is an honest failure, not a claim of success", async () => {
    const outcome = await restartChangedDaemon(
      deps({
        call: async (method) =>
          method === "status"
            ? ok({ ...fences, protocol: 1 })
            : ok({ ...fences, accepted: true }),
        observeEndpoint: async () => ({ kind: "absent" }),
        // The respawn's own status probe keeps failing, so the bootstrap
        // burns its budget and lands on a spawn-shaped timeout.
        spawnDeadlineMs: 5,
        pollIntervalMs: 1,
        sleep: async () => {},
      }),
    );
    expect(outcome.kind).toBe("failed");
  });

  test("a missing bundled binary cannot apply the update", async () => {
    const outcome = await restartChangedDaemon(
      deps({ binaryExists: () => false }),
    );
    expect(outcome.kind).toBe("failed");
  });

  test("endpoint never frees but the old instance still answers → honest pending, no respawn over it", async () => {
    // Slow teardown: shutdown accepted, endpoint never freed, the OLD
    // daemon still serving. Must stay attached with the honest pending
    // state — never spawn a second daemon over a live one.
    const spawned: string[] = [];
    const outcome = await restartChangedDaemon(
      deps({
        call: async (method) =>
          method === "status"
            ? ok({ ...fences, protocol: 1, serviceInstanceId: "old-svc" })
            : ok({ ...fences, accepted: true }),
        observeEndpoint: async () => ({ kind: "present" }),
        spawn: async (binaryPath) => {
          spawned.push(binaryPath);
        },
      }),
    );
    expect(outcome.kind).toBe("pending");
    if (outcome.kind === "pending")
      expect(outcome.reason).toMatch(/could not finish shutting down/);
    expect(spawned).toEqual([]);
  });

  test("endpoint never frees, a bundled-build instance answers → identity-verified restart", async () => {
    // The replacement came up (slowly) but the endpoint observation keeps
    // seeing a listener: a healthy daemon answering with THIS bundle's
    // digest is a success, verified by digest rather than assumed.
    const dir = mkdtempSync(path.join(tmpdir(), "dur-"));
    const realBinary = path.join(dir, "drogond");
    writeFileSync(realBinary, "fake bundled binary bytes");
    const realDigest = createHash("sha256").update("fake bundled binary bytes").digest("hex");
    let shutdownCalled = 0;
    const outcome = await restartChangedDaemon(
      deps({
        call: async (method) => {
          if (method === "status")
            return ok({
              ...fences,
              serviceInstanceId: shutdownCalled > 0 ? "new-svc" : fences.serviceInstanceId,
              protocol: 1,
              daemonArtifactSha256: realDigest,
            });
          if (method === "runtime.shutdown") {
            shutdownCalled += 1;
            return ok({ ...fences, accepted: true });
          }
          return fail("method_not_found", method);
        },
        observeEndpoint: async () => ({ kind: "present" }),
        target: { binaryPath: realBinary, args: ["--data-dir", "/data"] },
        env: {},
        binaryExists: () => true,
        spawn: async () => {},
      }),
    );
    expect(outcome).toEqual({ kind: "restarted" });
  });

  test("endpoint never frees and a FOREIGN daemon answers → honest pending, never a claimed restart", async () => {
    let statusCalls = 0;
    const outcome = await restartChangedDaemon(
      deps({
        call: async (method) => {
          if (method === "status") {
            statusCalls += 1;
            return statusCalls === 1
              ? ok({ ...fences, protocol: 1 })
              : ok({
                  hostId: "h1",
                  serviceInstanceId: "new-svc",
                  protocol: 1,
                  daemonArtifactSha256: "b".repeat(64),
                });
          }
          return ok({ ...fences, accepted: true });
        },
        observeEndpoint: async () => ({ kind: "present" }),
      }),
    );
    expect(outcome.kind).toBe("pending");
    if (outcome.kind === "pending")
      expect(outcome.reason).toMatch(/does not match this install/);
  });
});

// The renderer-facing status schema must keep accepting the new additive
// identity fields AND an old daemon's reply that carries neither.
describe("status schema additive identity fields", () => {
  type ParsedStatus = {
    featureProtocol?: number;
    daemonArtifactSha256?: string | null;
  };
  const parse = (value: unknown): ParsedStatus =>
    resultSchemas["status"].parse(value) as ParsedStatus;
  test("accepts featureProtocol and daemonArtifactSha256", () => {
    const parsed = parse({
      hostId: "h",
      serviceInstanceId: "s",
      protocol: 1,
      capabilities: [],
      version: "0.1.0",
      featureProtocol: 2,
      daemonArtifactSha256: "a".repeat(64),
    });
    expect(parsed.featureProtocol).toBe(2);
    expect(parsed.daemonArtifactSha256).toBe("a".repeat(64));
  });
  test("an old daemon's reply (neither field) still validates", () => {
    const parsed = parse({
      hostId: "h",
      serviceInstanceId: "s",
      protocol: 1,
      capabilities: [],
      version: "0.1.0",
    });
    expect(parsed.featureProtocol).toBeUndefined();
    expect(parsed.daemonArtifactSha256).toBeUndefined();
  });
});
