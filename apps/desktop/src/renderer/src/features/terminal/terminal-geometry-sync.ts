type Grid = { cols: number; rows: number };
const same = (a: Grid | null, b: Grid | null) => !!a && !!b && a.cols === b.cols && a.rows === b.rows;

/** Keep the latest measured grid through unavailable/hidden intervals.
 * Source counterpart: pty-size-reconcile and visibility-resume reassertion.
 * Serialize requests so an older resize cannot finish after the final size. */
export function createTerminalGeometrySync(options: {
  isReady: () => boolean;
  send: (grid: Grid) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  let desired: Grid | null = null;
  let confirmed: Grid | null = null;
  let epoch = 0;
  let inFlight = false;
  let disposed = false;
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
        // Failure at the same size waits for a real read/reveal event, not
        // a promise-driven retry loop. Newer measurements may proceed now.
        if (!same(target, desired) || sentEpoch !== epoch) flush();
      }
    })();
  };
  return {
    request(grid: Grid) {
      if (!Number.isInteger(grid.cols) || !Number.isInteger(grid.rows) || grid.cols <= 0 || grid.rows <= 0) return;
      desired = { ...grid };
      flush();
    },
    flush,
    invalidate() { epoch++; confirmed = null; },
    dispose() { disposed = true; desired = null; confirmed = null; },
  };
}
