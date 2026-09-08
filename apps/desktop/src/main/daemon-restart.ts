// MIT Copyright (c) 2026 Lovecast Inc.
// Daemon restart behind Settings → Manage Sessions → "Restart daemon".
//
// Stopping uses the daemon's own managed shutdown (`runtime.shutdown`,
// admitted only once every session has exited, after which the serving
// process ends by its accept loop returning and releases the data-dir
// lock) — never a PID signal: the bootstrapped daemon is detached and
// unref'd, so this process keeps no handle to signal, and an operator-run
// dev daemon has no PID this app could know. Starting reuses
// `bootstrapNativeRuntime` with the same packaged binary/args the startup
// bootstrap uses. "Managed" therefore means "this app can start a
// replacement": packaged builds, or development with an explicit
// `DROGON_DAEMON_BIN` operator seam (dev never spawns silently, so without
// the seam the daemon is external and the button stays disabled).
import { bootstrapNativeRuntime } from "./native-runtime-bootstrap";
import type { LocalEndpointObservation } from "./native-client";
import {
  daemonRestartInputSchema,
  type DaemonRestartResult,
  type NativeCall,
} from "../shared/daemon-contract";
import type { Status } from "../shared/session-contract";
import { z } from "zod";
import { resultSchemas } from "../shared/result-validation";

// This method is only used by the daemon restart flow and therefore is kept
// out of the coordinator-owned shared result map. Native-client still needs a
// strict schema before it can accept the daemon's successful reply.
resultSchemas["runtime.shutdown"] = z.object({
  hostId: z.string().min(1).max(128),
  serviceInstanceId: z.string().min(1).max(128),
  accepted: z.literal(true),
});

export type DaemonRestartDeps = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  dataDir: string;
  packagedBinaryPath: string;
  /** Dev-only explicit binary; ignored when packaged. */
  devDaemonBinary: string | null;
  env: NodeJS.ProcessEnv;
  binaryExists(path: string): boolean;
  call: NativeCall;
  observeEndpoint(signal: AbortSignal): Promise<LocalEndpointObservation>;
  spawn(
    binaryPath: string,
    args: string[],
    env: NodeJS.ProcessEnv,
  ): Promise<void>;
  sleep(ms: number): Promise<void>;
  pollIntervalMs: number;
  /** Bound for the old daemon to stop answering after an admitted shutdown. */
  shutdownWaitMs: number;
  /** One budget for the respawn, same role as the startup bootstrap budget. */
  spawnDeadlineMs: number;
};

export type RestartTarget = { binaryPath: string; args: string[] };

/** Where the replacement daemon comes from, or null when the serving daemon is external. */
export function resolveRestartTarget(
  deps: Pick<
    DaemonRestartDeps,
    "isPackaged" | "dataDir" | "packagedBinaryPath" | "devDaemonBinary"
  >,
): RestartTarget | null {
  if (deps.isPackaged)
    return {
      binaryPath: deps.packagedBinaryPath,
      args: ["--data-dir", deps.dataDir],
    };
  if (!deps.devDaemonBinary) return null;
  return {
    binaryPath: deps.devDaemonBinary,
    args: ["--data-dir", deps.dataDir],
  };
}

export function restartAvailability(deps: DaemonRestartDeps): {
  managed: boolean;
  reason: string | null;
} {
  if (deps.platform === "win32")
    return {
      managed: false,
      reason: "Restarting the daemon is not supported on this platform.",
    };
  const target = resolveRestartTarget(deps);
  if (!target)
    return {
      managed: false,
      reason:
        "The daemon was started outside Drogon, so it can't be restarted from here.",
    };
  if (!deps.binaryExists(target.binaryPath))
    return {
      managed: false,
      reason:
        "The daemon binary is missing, so the daemon can't be restarted from here.",
    };
  return { managed: true, reason: null };
}

function notRestarted(
  deps: DaemonRestartDeps,
  reason: string,
): DaemonRestartResult {
  const { managed } = restartAvailability(deps);
  return { restarted: false, managed, reason, stoppedSessions: 0 };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function workspaceIds(value: unknown): string[] | null {
  const root = asRecord(value);
  const list = root?.["workspaces"];
  if (!Array.isArray(list)) return null;
  const ids: string[] = [];
  for (const entry of list) {
    const id = asRecord(entry)?.["id"];
    if (typeof id !== "string" || id.length === 0) return null;
    ids.push(id);
  }
  return ids;
}

function sessionIdentities(value: unknown): { sessionId: string; incarnation: string }[] | null {
  const root = asRecord(value);
  const list = root?.["sessions"];
  if (!Array.isArray(list)) return null;
  const identities: { sessionId: string; incarnation: string }[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    const sessionId = record?.["id"];
    const incarnation = record?.["incarnation"];
    if (
      typeof sessionId !== "string" ||
      sessionId.length === 0 ||
      typeof incarnation !== "string" ||
      incarnation.length === 0
    )
      return null;
    identities.push({ sessionId, incarnation });
  }
  return identities;
}

function shutdownFences(
  value: unknown,
): { hostId: string; serviceInstanceId: string } | null {
  const record = asRecord(value);
  const hostId = record?.["hostId"];
  const serviceInstanceId = record?.["serviceInstanceId"];
  return typeof hostId === "string" && typeof serviceInstanceId === "string"
    ? { hostId, serviceInstanceId }
    : null;
}

/** Stops every session through the same `session.stop` the pane uses; aborts (leaving the daemon up) on the first refusal. */
async function stopAllSessions(
  call: NativeCall,
): Promise<{ stopped: number } | { failed: string }> {
  const workspacesResult = await call("workspace.list", {});
  if (!workspacesResult.ok)
    return { failed: "Could not list projects, so no session was stopped." };
  const ids = workspaceIds(workspacesResult.result);
  if (!ids) return { failed: "The service returned an unexpected project list." };
  let total = 0;
  let failed = 0;
  for (const workspaceId of ids) {
    const sessionsResult = await call("session.list", { workspaceId });
    if (!sessionsResult.ok) {
      failed += 1;
      continue;
    }
    const identities = sessionIdentities(sessionsResult.result);
    if (!identities)
      return { failed: "The service returned an unexpected session list." };
    for (const identity of identities) {
      total += 1;
      const stopped = await call("session.stop", identity);
      if (!stopped.ok) failed += 1;
    }
  }
  if (failed > 0)
    return {
      failed: `Could not stop ${failed} of ${total} session(s); the daemon was left running.`,
    };
  return { stopped: total };
}

async function serving(call: NativeCall): Promise<boolean> {
  const status = await call("status", {});
  return status.ok;
}

/**
 * Runs one restart: probe short-circuits, otherwise stop-all then the
 * daemon's own shutdown, then a startup-shaped respawn. Every failure
 * leaves the previous state intact except the named one: sessions stay
 * stopped once stopped (restart is confirmed destructive, like the
 * reference), and a stopped-but-unreplaced daemon is reported as exactly
 * that so the R16-M banner (which retries forever) and a manual retry can
 * recover it.
 */
export async function handleDaemonRestart(
  input: unknown,
  deps: DaemonRestartDeps,
): Promise<DaemonRestartResult> {
  const parsed = daemonRestartInputSchema.safeParse(input);
  const availability = restartAvailability(deps);
  if (!parsed.success)
    return {
      restarted: false,
      managed: availability.managed,
      reason: "Invalid desktop request.",
      stoppedSessions: 0,
    };
  if (parsed.data?.probe)
    return { ...availability, restarted: false, stoppedSessions: 0 };
  const target = resolveRestartTarget(deps);
  if (!availability.managed || !target)
    return {
      restarted: false,
      managed: false,
      reason: availability.reason ?? "The daemon can't be restarted from here.",
      stoppedSessions: 0,
    };

  const status = await deps.call("status", {});
  let stoppedSessions = 0;
  let fences: { hostId: string; serviceInstanceId: string } | null = null;
  if (status.ok) {
    fences = shutdownFences(status.result);
    if (!fences)
      return notRestarted(
        deps,
        "The service returned an unexpected status.",
      );
    const stopped = await stopAllSessions(deps.call);
    if ("failed" in stopped) return notRestarted(deps, stopped.failed);
    stoppedSessions = stopped.stopped;
    const shutdown = await deps.call("runtime.shutdown", { ...fences });
    if (!shutdown.ok) {
      const code = shutdown.error.code;
      const contractGap =
        code === "internal_error" &&
        shutdown.error.message.includes("expected contract");
      // Refusals (busy, stale fences, bad args) are final: waiting would
      // only burn the shutdown budget watching a daemon that said no. An
      // `unverifiable` is transport loss that may already be the daemon
      // going away. Keep the legacy contract-gap tolerance for an older
      // daemon, but successful replies are validated by the local schema.
      if (code !== "unverifiable" && !contractGap)
        return notRestarted(
          deps,
          `The daemon refused to stop (${code}): ${shutdown.error.message}`,
        );
    }
    const deadline = Date.now() + deps.shutdownWaitMs;
    while (await serving(deps.call)) {
      if (Date.now() >= deadline)
        return notRestarted(
          deps,
          "The daemon did not stop; it was left running.",
        );
      await deps.sleep(deps.pollIntervalMs);
    }
  }

  const outcome = await bootstrapNativeRuntime({
    // The flag gates spawning; reaching here means an explicit operator
    // restart with a known binary (packaged, or the dev seam), which is
    // the same operator intent the startup bootstrap honors when packaged.
    isPackaged: true,
    platform: deps.platform,
    binaryExists: () => deps.binaryExists(target.binaryPath),
    checkStatus: (_signal) =>
      deps.call("status", {}) as Promise<
        import("../shared/session-contract").Result<Status>
      >,
    observeLocalEndpoint: deps.observeEndpoint,
    spawnDaemon: () => deps.spawn(target.binaryPath, target.args, deps.env),
    sleep: deps.sleep,
    pollIntervalMs: deps.pollIntervalMs,
    deadlineMs: deps.spawnDeadlineMs,
  });
  if (outcome.kind === "spawned-then-healthy")
    return { restarted: true, managed: true, reason: null, stoppedSessions };
  if (outcome.kind === "already-healthy")
    return notRestarted(
      deps,
      "The service is already running; no restart was needed.",
    );
  return notRestarted(
    deps,
    `The daemon stopped but its replacement did not become healthy (${outcome.kind}).`,
  );
}
