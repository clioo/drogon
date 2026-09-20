// Terminal read-loop pacing for the R16-AT robustness pass. Two measured
// problems on a judge's-demo-day load (20+ sessions, one flooding ~2.5 MB/s)
// are fixed here without touching UI anatomy:
//
// 1. Replaying a freshly mounted pane from ring cursor 0 walked the whole
//    retained 1 MiB daemon ring through xterm before showing live output
//    (~48 s to catch up under flood, ~7k DOM mutations in 10 s from the
//    screen-reader row churn). The fork caps replay at
//    `TERMINAL_SCROLLBACK_REPLAY_BYTE_LIMIT` (512 KiB,
//    src/shared/terminal-scrollback-limits.ts); the same cap applies here,
//    paired with a seek that discards older pages *without parsing them*.
//
// 2. Every 64 KiB read observation called the pane's onSession callback,
//    which fans out to the shell store and re-renders chrome per chunk
//    during catch-up. Verdict-affecting fields must stay instant ("working"
//    -> "exited", needs_input); metadata-only repeats are throttled to one
//    emission per interval (the "just now"/"3m" labels need nothing finer).

/** Fork parity: src/shared/terminal-scrollback-limits.ts (`TERMINAL_SCROLLBACK_REPLAY_BYTE_LIMIT`). */
export const TERMINAL_REPLAY_TAIL_BYTE_LIMIT = 512 * 1024;

/** Daemon `session.read` page ceiling (`limitBytes` max, protocol v1). */
export const TERMINAL_READ_PAGE_BYTES = 65_536;

/**
 * Seek guard: never walk more than this many full pages to reach the live
 * edge. A session writing faster than the seek drains would otherwise keep
 * the loop seeking forever; 64 pages is 4 MiB of retained backlog, far past
 * the 512 KiB tail the pane will actually render.
 */
export const TERMINAL_SEEK_MAX_PAGES = 64;

/** Visible-pane poll cadence between live reads (existing behavior). */
export const TERMINAL_LIVE_POLL_MS = 120;

/**
 * Hot cadence right after user input or fresh output. The fork delivers
 * output by push (pty onData → IPC → xterm write, effectively one frame);
 * this repo's transport is a poll, so the only way typing echo lands
 * within a frame or two instead of up to `TERMINAL_LIVE_POLL_MS` late is
 * a short hot window while the pane is demonstrably active.
 */
export const TERMINAL_ACTIVE_POLL_MS = 24;

/** How long after the last input or output byte the hot cadence stays armed. */
export const TERMINAL_ACTIVE_WINDOW_MS = 1_500;

/**
 * Hidden-pane (tab switched away, still mounted behind a browser/editor
 * tab) poll cadence. The pane stays alive by design — the strip can switch
 * back without a remount — but a hidden pane has no viewport to repaint and
 * no user reading output, so two quiet polls per second suffice and twenty
 * daemon round-trips per second per hidden pane do not.
 */
export const TERMINAL_HIDDEN_POLL_MS = 2_000;

/** Coalescing interval for metadata-only session observations. */
export const SESSION_UPDATE_MIN_INTERVAL_MS = 500;

/**
 * One retained seek page. It carries both halves of what a replay needs — the
 * bytes with the ring range they cover (what `planGridCutWrites` plans
 * against) and the grid the daemon reported when it answered them (what the
 * plan changes xterm's grid to) — so a replay feeds them exactly the way a
 * live read does (#605).
 */
export type ReplayTailPage = {
  bytes: Uint8Array;
  /** Ring offsets this page's first and last byte sit at. */
  startCursor: number;
  nextCursor: number;
  /** The grid the daemon reported for the session when it answered. */
  cols: number;
  rows: number;
  /** Ring offset that reported grid took effect at, when the daemon says. */
  gridCursor?: number;
  /** Every grid change inside these bytes, in order, oldest first. */
  gridChanges?: readonly { cursor: number; cols: number; rows: number }[];
  /** True when the daemon had already dropped bytes this page follows. */
  truncated: boolean;
};

export type ReplayTailBuffer = {
  /** True when content the daemon retained was (or will be) skipped. */
  readonly dropped: boolean;
  push: (page: ReplayTailPage) => void;
  /** Empties and returns the retained pages in write order. */
  drain: () => ReplayTailPage[];
};

/**
 * Retains only the newest `limitBytes` of replay pages. Pushing past the
 * limit drops the oldest page and marks the replay as dropped (the pane
 * then shows the fork's "[Earlier output is no longer retained]" marker).
 * The page's own grid report is kept: dropping an older page cannot strip a
 * later one's cuts, because each page carries the grid in force at its own
 * first byte.
 */
export function createReplayTailBuffer(
  limitBytes: number = TERMINAL_REPLAY_TAIL_BYTE_LIMIT,
): ReplayTailBuffer {
  let pages: ReplayTailPage[] = [];
  let bytes = 0;
  let dropped = false;
  return {
    get dropped() {
      return dropped;
    },
    push(page: ReplayTailPage) {
      if (page.truncated) dropped = true;
      pages.push(page);
      bytes += page.bytes.length;
      while (bytes > limitBytes) {
        const oldest = pages.shift();
        if (!oldest) break;
        bytes -= oldest.bytes.length;
        dropped = true;
      }
    },
    drain() {
      const out = pages;
      pages = [];
      bytes = 0;
      return out;
    },
  };
}

/**
 * Whether the seek phase continues after this page: keep seeking while the
 * page came back full (more retained data exists) and the page guard has
 * not tripped. A short page means the read reached the live edge.
 */
export function shouldKeepSeeking(pageBytes: number, pagesSeen: number): boolean {
  return pageBytes === TERMINAL_READ_PAGE_BYTES && pagesSeen < TERMINAL_SEEK_MAX_PAGES;
}

/** The session fields whose change must reach the shell immediately. */
export type SessionSignal = {
  verdict: string;
  exitCode: number | null;
  incarnation: string;
  cols: number;
  rows: number;
  agentState?: string;
  agentStateAt?: string | null;
  harnessId?: string | null;
};

export type SessionUpdateCoalescer = {
  /** True when this observation may propagate to the shell. */
  shouldEmit: (next: SessionSignal, nowMs: number) => boolean;
};

/**
 * Emits immediately when any verdict-affecting field changes (or on the
 * first observation); otherwise at most once per `minIntervalMs`. Two
 * observations that differ in nothing structural are the same UI state —
 * the relative-time labels they feed refresh on a sub-second cadence they
 * do not need.
 */
export function createSessionUpdateCoalescer(
  minIntervalMs: number = SESSION_UPDATE_MIN_INTERVAL_MS,
): SessionUpdateCoalescer {
  let lastKey: string | null = null;
  let lastEmitMs = 0;
  return {
    shouldEmit(next, nowMs) {
      const key = JSON.stringify([
        next.verdict,
        next.exitCode,
        next.incarnation,
        next.cols,
        next.rows,
        next.agentState ?? null,
        next.agentStateAt ?? null,
        next.harnessId ?? null,
      ]);
      if (key !== lastKey) {
        lastKey = key;
        lastEmitMs = nowMs;
        return true;
      }
      if (nowMs - lastEmitMs >= minIntervalMs) {
        lastEmitMs = nowMs;
        return true;
      }
      return false;
    },
  };
}
