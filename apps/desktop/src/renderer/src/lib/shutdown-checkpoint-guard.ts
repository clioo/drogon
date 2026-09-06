// Candidate port of Lovecast Inc. MIT source
// src/renderer/src/lib/shutdown-checkpoint-guard.ts at
// c97906287bb7a390b25e2025b600d9fb3c25d9c3
// (SHA256 12731c56e8b1bcd7e9d7c43d5d98cedb8a203a80e57cd5d835743f11fd6023d8).
// Root contract adaptation (review 2026-09-06): the original global window.api
// crash recorder is replaced by a required injected best-effort breadcrumb
// sink argument with the exact source breadcrumb name/data; console and
// failure-reason DOM behavior are unchanged. Rust remains the durable
// execution owner.

import {
  clearShutdownCheckpointFailureReason,
  formatShutdownCheckpointFailureReason,
  ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT,
  ORCA_RENDERER_UNLOAD_PREVENTED_EVENT,
  publishShutdownCheckpointFailureReason,
} from "../../../shared/renderer-shutdown-events";

/** Best-effort diagnostics sink injected by the caller (root contract):
 * * implementations must never throw into the checkpoint path; this module
 * * additionally guards the call so a sink failure cannot mask the outcome. */
export type ShutdownCheckpointBreadcrumbSink = (
  name: string,
  data: { message: string },
) => void;

export type ShutdownCheckpointGuard = {
  persistOnce: () => boolean;
  abortAfterCheckpointFailure: () => void;
  abandonAttempt: () => void;
};

// Why: without this, a reproducible checkpoint failure strands the user on an old
// build behind an error that names the symptom while the cause is swallowed (STA-5505).
function reportShutdownCheckpointFailure(
  error: unknown,
  recordCrashBreadcrumb: ShutdownCheckpointBreadcrumbSink,
): void {
  console.error("[app] Shutdown checkpoint persist failed:", error);
  const message = formatShutdownCheckpointFailureReason(error);
  publishShutdownCheckpointFailureReason(message);
  try {
    recordCrashBreadcrumb("renderer_shutdown_checkpoint_failed", { message });
  } catch {
    // A diagnostics sink failure must never mask the checkpoint outcome.
  }
}

export function createShutdownCheckpointGuard(
  persist: () => void,
  recordCrashBreadcrumb: ShutdownCheckpointBreadcrumbSink,
  abandonPersistAttempt?: () => void,
): ShutdownCheckpointGuard {
  let persisted = false;
  return {
    persistOnce(): boolean {
      if (persisted) {
        return true;
      }
      try {
        persist();
      } catch (error) {
        // Why: browser event targets swallow listener exceptions. Returning a
        // failure lets the caller cancel unload and keep this attempt retryable.
        reportShutdownCheckpointFailure(error, recordCrashBreadcrumb);
        return false;
      }
      persisted = true;
      clearShutdownCheckpointFailureReason();
      return true;
    },
    abortAfterCheckpointFailure(): void {
      persisted = false;
    },
    abandonAttempt(): void {
      persisted = false;
      abandonPersistAttempt?.();
    },
  };
}

export function createShutdownCheckpointBeforeUnloadHandler(
  guard: ShutdownCheckpointGuard,
): (event: Event) => void {
  return (event): void => {
    if (!guard.persistOnce()) {
      event.currentTarget?.dispatchEvent(
        new Event(ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT),
      );
      event.preventDefault();
    }
  };
}

export function preventUnloadAndScheduleShutdownCheckpointReset(
  event: Event,
  eventTarget: EventTarget,
): void {
  event.preventDefault();
  // Why: paired web has no Electron will-prevent-unload callback. Defer until
  // all beforeunload listeners finish so their successful checkpoint is reset.
  queueMicrotask(() => {
    eventTarget.dispatchEvent(new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT));
  });
}
