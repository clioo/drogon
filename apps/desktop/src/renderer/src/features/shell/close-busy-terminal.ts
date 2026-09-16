// Issue #333: busy-tab close gating. A tab/pane whose session still has
// work in flight must confirm before `session.close` stops it. The daemon
// reports `hasForegroundChild` on live rows (see
// `crates/drogon-core/src/session.rs`); harness turns in flight never show
// a foreground child (the agent CLI IS the session leader), so a hook-driven
// `working`/`needs_input` turn on a harness session counts as busy too.
// Plain shells stay purely on the daemon signal: their activity-based
// `working` flickers on any output burst and would false-positive.
import type { Session } from "../../../../shared/session-contract";

const SKIP_CONFIRM_STORAGE_KEY = "drogon.skipCloseBusyTerminalConfirm";

/** The session fields the busy rule reads; `hasForegroundChild` is absent
 *  on rows from an older daemon and reads as idle. */
export type BusyTerminalSignal = Pick<
  Session,
  "verdict" | "agentState" | "harnessId"
> & {
  hasForegroundChild?: boolean;
};

export function isBusyTerminalSession(session: BusyTerminalSignal): boolean {
  if (session.verdict !== "live") return false;
  if (session.hasForegroundChild === true) return true;
  return (
    session.harnessId != null &&
    (session.agentState === "working" || session.agentState === "needs_input")
  );
}

/** Agent copy ("Stop this agent?") vs plain-shell copy ("Stop running
 *  command?"): the launch record, not the busy source, picks the wording. */
export function isAgentTerminalSession(
  session: Pick<Session, "harnessId">,
): boolean {
  return session.harnessId != null;
}

/** Reads the persisted skip-confirm preference (tests inject storage). */
export function readSkipCloseBusyTerminalConfirm(
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  try {
    return storage.getItem(SKIP_CONFIRM_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persists the skip-confirm preference (tests inject storage). */
export function writeSkipCloseBusyTerminalConfirm(
  skip: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): void {
  try {
    if (skip) storage.setItem(SKIP_CONFIRM_STORAGE_KEY, "1");
    else storage.removeItem(SKIP_CONFIRM_STORAGE_KEY);
  } catch {
    // Best-effort preference write; the dialog still works per-open.
  }
}
