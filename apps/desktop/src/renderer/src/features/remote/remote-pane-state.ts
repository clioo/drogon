import type { HostDescriptor } from "./host-descriptor";

/**
 * Pane-level connection state for a remote target. Phases are UI state,
 * not verdicts: `unverifiable` here means "contact with the owning host is
 * lost or unproven" and is deliberately distinct from `error` (a known,
 * observed connection failure before/at attach) and from `exited` (which
 * this reducer only enters on positive host evidence for the current
 * incarnation).
 */
export interface RemotePaneState {
  /**
   * `exited` is reachable ONLY through `host-confirmed-exited` with the
   * current incarnation (positive host evidence); transport loss can
   * never produce it.
   */
  phase: "idle" | "connecting" | "live" | "unverifiable" | "error" | "exited";
  host: HostDescriptor | null;
  /** The session incarnation this pane is attached to, when known. */
  incarnation: string | null;
  /** Latest human-readable explanation (transport loss, error, etc.). */
  message: string;
  /** Whether a retry affordance must be offered in the current phase. */
  canRetry: boolean;
}

export type RemotePaneAction =
  | { type: "reset" }
  | { type: "connect-started"; host: HostDescriptor }
  | {
      type: "live-confirmed";
      /** Positive host evidence: the owning host acknowledged this incarnation. */
      incarnation: string;
    }
  | {
      type: "transport-lost";
      message: string;
    }
  | {
      type: "host-confirmed-exited";
      /**
       * Only valid when it names the exact incarnation currently attached.
       * A stale or superseded incarnation is client bookkeeping, not host
       * evidence, and must be ignored.
       */
      incarnation: string;
    }
  | { type: "connect-failed"; message: string }
  | { type: "retry-started" };

export function initialRemotePaneState(): RemotePaneState {
  return {
    phase: "idle",
    host: null,
    incarnation: null,
    message: "",
    canRetry: false,
  };
}

/**
 * Transport loss ALWAYS maps to `unverifiable` — never `exited`. Only a
 * `host-confirmed-exited` event whose incarnation matches the pane's
 * current attachment is positive evidence of exit; anything else (stale
 * event, superseded incarnation, transport drop, client-side lookup
 * failure) leaves the pane `unverifiable` or untouched. The retry
 * affordance (`canRetry`) stays available in `unverifiable` and `error`.
 */
export function applyRemotePaneAction(
  state: RemotePaneState,
  action: RemotePaneAction,
): RemotePaneState {
  switch (action.type) {
    case "reset":
      return initialRemotePaneState();
    case "connect-started":
      return {
        phase: "connecting",
        host: action.host,
        incarnation: null,
        message: "",
        canRetry: false,
      };
    case "live-confirmed":
      return {
        ...state,
        phase: "live",
        incarnation: action.incarnation,
        message: "",
        canRetry: false,
      };
    case "transport-lost":
      // Loss of contact is not proof of exit: report unverifiable, keep
      // the incarnation (the session may well still be live remotely),
      // and keep the retry affordance.
      return {
        ...state,
        phase: "unverifiable",
        message: action.message,
        canRetry: true,
      };
    case "host-confirmed-exited": {
      if (state.incarnation === null || action.incarnation !== state.incarnation)
        return state;
      return {
        ...state,
        phase: "exited",
        message: "",
        canRetry: false,
      };
    }
    case "connect-failed":
      return {
        ...state,
        phase: "error",
        message: action.message,
        canRetry: true,
      };
    case "retry-started":
      if (!state.canRetry) return state;
      return {
        ...state,
        phase: "connecting",
        message: "",
        canRetry: false,
      };
  }
}
