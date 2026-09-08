// MIT Copyright (c) 2026 Lovecast Inc. Ported from the Orca reference
// (read-only):
//   src/renderer/src/store/slices/runtime-environment-disconnect-toast.ts
//     (warning toast with a Try-again action while unreachable, dismissed on
//     reconnect; the fork raises no "reconnected" toast)
// Adapted: one local daemon instead of per-environment toasts, so the toast
// id is fixed; plain strings (no i18n). The Try-again action delegates to
// the owner's retry (ladder reset plus App refresh); while the service stays
// down every failed probe re-emits and the same-id toast is re-shown,
// which is the fork's "still failing after Try again" path without its
// promise plumbing.
import { useEffect } from "react";
import { toast } from "sonner";
import {
  DAEMON_DISCONNECT_TOAST_ACTION_LABEL,
  DAEMON_DISCONNECT_TOAST_DESCRIPTION,
  DAEMON_DISCONNECT_TOAST_TITLE,
} from "./daemon-connection";
import type { DaemonConnectionSnapshot } from "./daemon-connection-store";

const DAEMON_DISCONNECTED_TOAST_ID = "daemon-connection-disconnected";
const DAEMON_DISCONNECTED_TOAST_DURATION_MS = 4_000;

function showDaemonDisconnectedToast(onRetry: () => void): void {
  let retrying = false;
  const show = (duration = DAEMON_DISCONNECTED_TOAST_DURATION_MS): void => {
    toast.warning(DAEMON_DISCONNECT_TOAST_TITLE, {
      id: DAEMON_DISCONNECTED_TOAST_ID,
      description: DAEMON_DISCONNECT_TOAST_DESCRIPTION,
      duration,
      action: {
        label: DAEMON_DISCONNECT_TOAST_ACTION_LABEL,
        onClick: (event) => {
          // Sonner otherwise deletes the keyed toast after the action.
          event.preventDefault();
          if (retrying) return;
          retrying = true;
          show(Number.POSITIVE_INFINITY);
          try {
            onRetry();
          } finally {
            retrying = false;
          }
        },
      },
    });
  };
  show();
}

export function dismissDaemonDisconnectedToast(): void {
  toast.dismiss?.(DAEMON_DISCONNECTED_TOAST_ID);
}

/**
 * Raises the disconnect warning while the snapshot is down and dismisses it
 * on reconnect. Same-id re-shows replace rather than stack; safe to drive
 * from both the app banner and the status segment.
 */
export function useDaemonDisconnectToast(
  snapshot: DaemonConnectionSnapshot,
  onRetry: () => void,
): void {
  const down =
    snapshot.state === "reconnecting" ||
    (snapshot.state === "checking" && snapshot.lastError !== null);
  useEffect(() => {
    if (!down) {
      if (snapshot.state === "connected") dismissDaemonDisconnectedToast();
      return;
    }
    showDaemonDisconnectedToast(onRetry);
    // The retry callback is owner-stable (refresh + ladder reset); the toast
    // always follows the latest snapshot, not a stale closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [down]);
}
