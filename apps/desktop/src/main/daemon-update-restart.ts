// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P5 executor: the graceful restart a CHANGED daemon
// binary triggers at launch, decided by `classifyDaemonUpdate`
// (daemon-update.ts). Unlike the manual Settings restart
// (`handleDaemonRestart`), this path must never destroy the user's work:
// it never stops sessions. It asks the daemon to quiesce through its own
// `runtime.shutdown` (admitted only once every session has exited — see
// crates/drogon-core/src/service_quiescence.rs); a refusal (live sessions,
// a run in flight, or a daemon too old to know the method) becomes the
// honest "update pending" outcome with the old daemon still attached, and
// the renderer's restart affordance lets the USER choose the destructive
// stop-all path. A daemon that died between decision and shutdown is
// replaced directly: the endpoint is free and nothing remains to quiesce.
import { bootstrapNativeRuntime } from "./native-runtime-bootstrap";
import type { LocalEndpointObservation } from "./native-client";
import { waitForEndpointAbsent } from "./daemon-restart";
import type { RestartTarget } from "./daemon-restart";
import type { Status } from "../shared/session-contract";
import type { NativeCall } from "../shared/daemon-contract";

export type DaemonUpdateRestartDeps = {
  platform: NodeJS.Platform;
  target: RestartTarget;
  env: NodeJS.ProcessEnv;
  binaryExists(path: string): boolean;
  call: NativeCall;
  observeEndpoint(signal: AbortSignal): Promise<LocalEndpointObservation>;
  spawn(binaryPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<void>;
  sleep(ms: number): Promise<void>;
  pollIntervalMs: number;
  /** Bound for the old daemon to stop answering after an admitted shutdown. */
  shutdownWaitMs: number;
  /** One budget for the respawn, same role as the startup bootstrap budget. */
  spawnDeadlineMs: number;
};

export type DaemonUpdateRestartOutcome =
  | { kind: "restarted" }
  /** The daemon is still needed (or cannot quiesce): keep it attached and
   *  tell the user the update is pending a service restart they choose. */
  | { kind: "pending"; reason: string }
  /** The restart was attempted but did not complete; the honest state is
   *  still "pending" — whatever answers now may be old or absent. */
  | { kind: "failed"; reason: string };

function fencesOf(status: Record<string, unknown>): {
  hostId: string;
  serviceInstanceId: string;
} | null {
  const hostId = status["hostId"];
  const serviceInstanceId = status["serviceInstanceId"];
  return typeof hostId === "string" && hostId.length > 0 &&
      typeof serviceInstanceId === "string" && serviceInstanceId.length > 0
    ? { hostId, serviceInstanceId }
    : null;
}

export async function restartChangedDaemon(
  deps: DaemonUpdateRestartDeps,
): Promise<DaemonUpdateRestartOutcome> {
  if (deps.platform === "win32")
    return {
      kind: "failed",
      reason: "Restarting the daemon is not supported on this platform.",
    };
  if (!deps.binaryExists(deps.target.binaryPath))
    return {
      kind: "failed",
      reason:
        "The bundled daemon binary is missing, so the update cannot be applied.",
    };

  const status = await deps.call("status", {});
  if (!status.ok) {
    // Nothing (or something un-answerable) is attached — go straight to the
    // spawn path: absence is exactly what authorizes one.
    const outcome = await respawn(deps);
    return outcome.kind === "restarted"
      ? outcome
      : { kind: "pending", reason: outcome.reason };
  }
  const fences = fencesOf(status.result as Record<string, unknown>);
  if (!fences)
    return {
      kind: "pending",
      reason: "The running service returned an unexpected status, so it was left running.",
    };

  // Graceful by construction: no session is ever stopped here. A busy or
  // old daemon refuses and stays attached — that is the pending state.
  const shutdown = await deps.call("runtime.shutdown", { ...fences });
  if (!shutdown.ok) {
    const code = shutdown.error.code;
    const contractGap =
      code === "internal_error" &&
      shutdown.error.message.includes("expected contract");
    if (code !== "unverifiable" && !contractGap)
      return {
        kind: "pending",
        reason: `The running service could not quiesce (${code}): ${shutdown.error.message}`,
      };
    // Transport loss may already be the daemon going away; fall through to
    // the bounded endpoint wait, same as the manual restart path.
  }
  if (!(await waitForEndpointAbsent(deps)))
    return {
      kind: "pending",
      reason:
        "The running service stopped answering but did not release its endpoint; it was left in place.",
    };
  return respawn(deps);
}

async function respawn(
  deps: DaemonUpdateRestartDeps,
): Promise<DaemonUpdateRestartOutcome> {
  // A replacement that dies instantly has usually raced the old daemon's
  // data-dir lock release: the endpoint frees before the process-lifetime
  // flock does, so the replacement blocks on `Engine::open` and exits. Wait
  // for full teardown and retry, bounded — never a silent give-up.
  const attempts = 3;
  let last: DaemonUpdateRestartOutcome = {
    kind: "failed",
    reason: "the replacement was not started",
  };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const attemptOutcome = await respawnOnce(deps);
    if (attemptOutcome.kind === "already-verified-healthy")
      return { kind: "restarted" };
    last = attemptOutcome;
    if (last.kind === "restarted") return last;
    if (attempt < attempts) await deps.sleep(1_000);
  }
  return last;
}

async function respawnOnce(
  deps: DaemonUpdateRestartDeps,
): Promise<
  DaemonUpdateRestartOutcome | { kind: "already-verified-healthy" }
> {
  const outcome = await bootstrapNativeRuntime({
    // Same explicit-operator-intent override the manual restart uses: the
    // caller has already decided a replacement must be started from a
    // known binary; the flag only gates spawning inside the helper.
    isPackaged: true,
    platform: deps.platform,
    binaryExists: () => deps.binaryExists(deps.target.binaryPath),
    checkStatus: (_signal) =>
      deps.call("status", {}) as Promise<
        import("../shared/session-contract").Result<Status>
      >,
    observeLocalEndpoint: deps.observeEndpoint,
    spawnDaemon: () => deps.spawn(deps.target.binaryPath, deps.target.args, deps.env),
    sleep: deps.sleep,
    pollIntervalMs: deps.pollIntervalMs,
    deadlineMs: deps.spawnDeadlineMs,
  });
  if (outcome.kind === "spawned-then-healthy") return { kind: "restarted" };
  if (outcome.kind === "already-healthy") {
    // Something answers. After an endpoint-absent wait that can only be the
    // late replacement (or a foreign daemon): verify identity by digest
    // instead of claiming success blindly.
    const status = await deps.call("status", {});
    const digest = status.ok
      ? ((status.result as { daemonArtifactSha256?: string | null })
          .daemonArtifactSha256 ?? null)
      : null;
    if (digest !== null && digest === (await promisedBundleDigest(deps)))
      return { kind: "already-verified-healthy" };
    return {
      kind: "failed",
      reason:
        "A service was already running when the replacement was started, and its binary identity does not match this install.",
    };
  }
  if (outcome.kind === "spawned-then-refused")
    return {
      kind: "failed",
      reason: `The bundled daemon refused this data directory: ${outcome.reason}`,
    };
  return {
    kind: "failed",
    reason: `The replaced service did not come back healthy (${outcome.kind}).`,
  };
}

async function promisedBundleDigest(
  deps: DaemonUpdateRestartDeps,
): Promise<string | null> {
  // The bundled binary's digest is cheap to recompute here (spawn target is
  // a file); identity verification only ever compares known values.
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  try {
    return createHash("sha256")
      .update(await readFile(deps.target.binaryPath))
      .digest("hex");
  } catch {
    return null;
  }
}
