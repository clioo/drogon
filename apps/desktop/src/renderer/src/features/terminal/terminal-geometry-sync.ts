type Grid = { cols: number; rows: number };
const same = (a: Grid | null, b: Grid | null) => !!a && !!b && a.cols === b.cols && a.rows === b.rows;
const isGrid = (grid: Grid) =>
  Number.isInteger(grid.cols) && Number.isInteger(grid.rows) && grid.cols > 0 && grid.rows > 0;

/**
 * Floor between two corrective resizes. A corrective resize is a real
 * SIGWINCH, so a session two writers disagree about must degrade to a slow
 * disagreement rather than a redraw storm in the agent's TUI.
 */
export const TERMINAL_GEOMETRY_RECONCILE_MIN_INTERVAL_MS = 1000;

/** Keep the latest measured grid through unavailable/hidden intervals.
 * Source counterpart: pty-size-reconcile and visibility-resume reassertion.
 * Serialize requests so an older resize cannot finish after the final size. */
export function createTerminalGeometrySync(options: {
  isReady: () => boolean;
  send: (grid: Grid) => Promise<void>;
  onError: (error: unknown) => void;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let desired: Grid | null = null;
  let confirmed: Grid | null = null;
  let epoch = 0;
  let inFlight = false;
  let disposed = false;
  // A resize answer that was already on the wire when the pty took its new
  // size reports the old one. The daemon builds every read answer from the
  // live handle when it answers — a held `session.output` that opened before
  // the resize still reports the new size — so only an answer already in
  // transit can be that stale, and the pane keeps at most one read
  // outstanding, so exactly one answer per completed send is suspect.
  let staleReports = 0;
  let lastReconcileAt = Number.NEGATIVE_INFINITY;
  const flush = () => {
    if (disposed || inFlight || !desired || same(desired, confirmed) || !options.isReady()) return;
    const target = desired;
    const sentEpoch = epoch;
    inFlight = true;
    void (async () => {
      try {
        await options.send(target);
        if (!disposed && sentEpoch === epoch) confirmed = target;
      } catch (error) {
        if (!disposed && sentEpoch === epoch) options.onError(error);
      } finally {
        inFlight = false;
        // Across a connection boundary nothing is left in transit, so a
        // skip there would only eat a genuine report.
        if (sentEpoch === epoch) staleReports = 1;
        // Failure at the same size waits for a real read/reveal event, not
        // a promise-driven retry loop. Newer measurements may proceed now.
        if (!same(target, desired) || sentEpoch !== epoch) flush();
      }
    })();
  };
  return {
    request(grid: Grid) {
      if (!isGrid(grid)) return;
      desired = { ...grid };
      flush();
    },
    flush,
    /**
     * Reconcile against the pty size the daemon reports on every read.
     * `confirmed` is a cache of our last accepted send, not authority: the
     * pty can be resized by anything else holding the session (a second
     * surface, `drogon-cli terminal resize`, a bot or an orchestration
     * worker), and a cache the daemon contradicts is stale, not truth.
     * Leaving it standing froze the pane one grid away from its pty for the
     * rest of the session, which is how an agent's cursor-relative redraw
     * lands on the wrong rows and never erases what it drew over (#598).
     *
     * Dropping the cache is itself the act that authorizes a send — the
     * pane flushes after every answered read — so the floor has to gate the
     * drop, not just the flush below it, or the rate limit is decorative.
     * Returns true when a corrective resize was issued.
     */
    observe(reported: Grid): boolean {
      // A report answered while a resize is in flight predates that resize.
      if (disposed || inFlight || !desired || !isGrid(reported)) return false;
      if (staleReports > 0) {
        staleReports -= 1;
        return false;
      }
      if (same(reported, desired)) {
        // Observation is also positive evidence: it confirms a send whose
        // acknowledgment was lost to a transport failure or a dead pane.
        confirmed = desired;
        return false;
      }
      // A hidden or unavailable pane cannot take the pty; spending the
      // floor here would only delay the correction it will make on reveal.
      if (!options.isReady()) return false;
      const at = now();
      // A wall clock that steps backwards (the host resumed, ntp corrected)
      // must not park reconciliation until it catches up again.
      if (at < lastReconcileAt) lastReconcileAt = Number.NEGATIVE_INFINITY;
      if (at - lastReconcileAt < TERMINAL_GEOMETRY_RECONCILE_MIN_INTERVAL_MS) return false;
      lastReconcileAt = at;
      confirmed = null;
      flush();
      return true;
    },
    invalidate() { epoch++; confirmed = null; staleReports = 0; },
    dispose() { disposed = true; desired = null; confirmed = null; },
  };
}
