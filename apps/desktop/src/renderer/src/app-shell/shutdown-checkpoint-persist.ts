// Candidate port of Lovecast Inc. MIT source
// src/renderer/src/app-shell/shutdown-checkpoint-persist.ts at
// c97906287bb7a390b25e2025b600d9fb3c25d9c3
// (SHA256 4516edf3690549c7f3051bad200c4d5dae229cd2c27995831041f5ea8389cb9e).
// Root contract adaptation (review 2026-09-06): the original domain snapshot
// and UI-state types are unmigrated, so the factory is parameterized over
// TSnapshot and TUi extends object and passes both through to the staging
// dependency unchanged; the original global window.api crash recorder is
// replaced by a required injected best-effort breadcrumb sink with the exact
// source breadcrumb name/data. Rust remains the durable execution owner.

import { formatShutdownCheckpointFailureReason } from "../../../shared/renderer-shutdown-events";

/** Best-effort diagnostics sink injected by the caller (root contract):
 * * implementations must never throw into the checkpoint path; this module
 * * additionally guards the call so a sink failure cannot mask the outcome. */
export type ShutdownCheckpointBreadcrumbSink = (
  name: string,
  data: { message: string },
) => void;

export type ShutdownCheckpointStageArgs<TSnapshot, TUi extends object> = {
  sessions: TSnapshot[];
  ui: TUi;
};

export type ShutdownCheckpointPersistDeps<TSnapshot, TUi extends object> = {
  shouldCaptureSession: () => boolean;
  /** Per-pane failures are already swallowed inside the capture loop. */
  captureTerminalBuffers: () => void;
  captureSleepingAgentSessions: () => void;
  buildSessionSnapshots: () => TSnapshot[];
  buildUiPatch: () => TUi;
  hasDirtyOpenFiles: () => boolean;
  /** True during an intentional restart or an app-level quit/close — the unloads
   *  where losing the full snapshot beats blocking the shutdown outright. */
  isDegradableShutdownInProgress: () => boolean;
  stageBeforeUnloadSync: (
    args: ShutdownCheckpointStageArgs<TSnapshot, TUi>,
  ) => void;
  recordCrashBreadcrumb: ShutdownCheckpointBreadcrumbSink;
};

export type ShutdownCheckpointPersist = {
  run: () => void;
  abandonAttempt: () => void;
};

/** Returns the shutdown checkpoint attempt lifecycle. Running it captures renderer-owned
 *  state, then stages everything durable through one main-process call;
 *  abandonAttempt discards retry state when a shutdown is independently canceled.
 *  Only unstageable data may throw.
 *
 *  A factory rather than a bare function so full-session staging failures can stay
 *  visible-and-retryable on the first attempt and only degrade on a repeat: a
 *  transient failure gets its retry, a deterministic one can't strand the user. */
export function createShutdownCheckpointPersist<TSnapshot, TUi extends object>(
  deps: ShutdownCheckpointPersistDeps<TSnapshot, TUi>,
): ShutdownCheckpointPersist {
  let fullStagingFailedOnPriorAttempt = false;
  const run = (): void => {
    const shouldCaptureSession = deps.shouldCaptureSession();
    if (shouldCaptureSession) {
      deps.captureTerminalBuffers();
      try {
        deps.captureSleepingAgentSessions();
      } catch (error) {
        // Why: blocking the shutdown here is what stranded STA-5505. The cost of
        // continuing is real but bounded — done panes keep their weaker live-origin
        // record instead of a durable quit capture — and strictly smaller than the
        // alternative (no update, or a SIGKILL'd quit losing the whole snapshot).
        console.error(
          "[app] Sleeping-agent quit capture failed; continuing checkpoint",
          error,
        );
        try {
          deps.recordCrashBreadcrumb("renderer_shutdown_sleeping_capture_failed", {
            message: formatShutdownCheckpointFailureReason(error),
          });
        } catch {
          // A diagnostics sink failure must never mask the checkpoint outcome.
        }
      }
    }
    // Why: dirty drafts exist only in the full session snapshot, so their loss is the
    // one thing this checkpoint may never trade away for an update.
    const canDegradeToDurableSession = (): boolean =>
      deps.isDegradableShutdownInProgress() && !deps.hasDirtyOpenFiles();
    let sessionSnapshots: TSnapshot[] = [];
    let degraded = false;
    try {
      sessionSnapshots = shouldCaptureSession ? deps.buildSessionSnapshots() : [];
    } catch (error) {
      if (!canDegradeToDurableSession()) {
        throw error;
      }
      console.error("[app] Full renderer session snapshot failed; using durable session", error);
      degraded = true;
    }
    try {
      deps.stageBeforeUnloadSync({
        sessions: degraded ? [] : sessionSnapshots,
        ui: deps.buildUiPatch(),
      });
    } catch (error) {
      // A durable-only stage has nothing safer left to fall back to.
      if (degraded) {
        throw error;
      }
      // Why retry-then-degrade: the first staging failure stays a visible,
      // retryable error — degrading immediately would silently drop just-captured
      // scrollback that a retry may well save. Only a repeat failure trades the
      // full snapshot for an unblocked shutdown. Non-degradable failures never
      // arm the flag, so an unrelated unload can't burn a later restart's retry.
      const keepBlocking =
        !fullStagingFailedOnPriorAttempt || !canDegradeToDurableSession();
      if (canDegradeToDurableSession()) {
        fullStagingFailedOnPriorAttempt = true;
      }
      if (keepBlocking) {
        throw error;
      }
      console.error(
        "[app] Staging the full renderer session failed again; using durable session",
        error,
      );
      deps.stageBeforeUnloadSync({ sessions: [], ui: deps.buildUiPatch() });
    }
    fullStagingFailedOnPriorAttempt = false;
  };
  return {
    run,
    abandonAttempt: () => {
      fullStagingFailedOnPriorAttempt = false;
    },
  };
}
