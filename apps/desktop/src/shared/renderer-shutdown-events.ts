// Source provenance: Lovecast Inc. MIT source c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/renderer-shutdown-events.ts (SHA256 bdd87131e559f09a968a947cbc6099c2b640dc460bed0f4d3ed7c391f75f5362).

export const ORCA_RENDERER_UNLOAD_PREVENTED_EVENT =
  "orca:renderer-unload-prevented";
export const ORCA_RENDERER_SHUTDOWN_CHECKPOINT_FAILED_EVENT =
  "orca:renderer-shutdown-checkpoint-failed";
export const ORCA_RENDERER_SHUTDOWN_CHECKPOINT_ABORTED_EVENT =
  "orca:renderer-shutdown-checkpoint-aborted";

// The checkpoint guard runs in the renderer's main world while restart
// preparation runs in the context-isolated preload world. Events cross worlds,
// but their JS payloads do not, so the shared DOM attribute carries the reason.
export const ORCA_SHUTDOWN_CHECKPOINT_FAILURE_REASON_ATTRIBUTE =
  "data-orca-shutdown-checkpoint-failure";

export function formatShutdownCheckpointFailureReason(error: unknown): string {
  try {
    const reason = String(error instanceof Error ? error.message : error);
    return reason || "Unknown shutdown checkpoint failure";
  } catch {
    return "Unknown shutdown checkpoint failure";
  }
}

export function publishShutdownCheckpointFailureReason(reason: string): void {
  try {
    globalThis.document?.documentElement?.setAttribute(
      ORCA_SHUTDOWN_CHECKPOINT_FAILURE_REASON_ATTRIBUTE,
      reason,
    );
  } catch {
    // Best-effort diagnostics; the checkpoint verdict is carried by the event.
  }
}

export function clearShutdownCheckpointFailureReason(): void {
  try {
    globalThis.document?.documentElement?.removeAttribute(
      ORCA_SHUTDOWN_CHECKPOINT_FAILURE_REASON_ATTRIBUTE,
    );
  } catch {
    // Best-effort diagnostics only.
  }
}

/** Read and clear the reason so a stale cause cannot label a later failure. */
export function consumeShutdownCheckpointFailureReason(): string | null {
  try {
    const root = globalThis.document?.documentElement;
    const reason = root?.getAttribute(
      ORCA_SHUTDOWN_CHECKPOINT_FAILURE_REASON_ATTRIBUTE,
    );
    if (reason) {
      root?.removeAttribute(ORCA_SHUTDOWN_CHECKPOINT_FAILURE_REASON_ATTRIBUTE);
    }
    return reason || null;
  } catch {
    return null;
  }
}
