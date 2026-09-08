// MIT Copyright (c) 2026 Lovecast Inc.
// OS-level suspension guard (issue #309): the packaged app under a test
// harness (DROGON_BACKGROUND_WINDOW=1) runs as an inactive, occluded
// accessory-window app — the exact state macOS App Nap suspends when the
// machine is under memory pressure. A suspended process still answers
// `kill(pid, 0)` liveness checks, but its DevTools endpoint stops servicing
// requests, which QA r9 observed as `connectOverCDP: Timeout 30000ms` with
// "Electron and drogond report alive". The app's only existing keep-awake
// (`caffeinate`) prevents system sleep, not process suspension, so test
// instances hold one `prevent-app-suspension` power-save blocker for the
// app's lifetime; foreground users are unaffected (an active app is not
// napped) and release the blocker on quit.
export type AppActivityGuardDeps = {
  /** True exactly for background-test-mode instances. */
  isBackgroundTestMode: boolean;
  /** Electron `powerSaveBlocker.start`, injectable for tests. */
  start: (type: "prevent-app-suspension") => number;
  /** Electron `powerSaveBlocker.stop`, injectable for tests. */
  stop: (id: number) => void;
};

export type AppActivityGuard = {
  /**
   * Holds the suspension blocker when (and only when) the instance runs in
   * background-test mode. Idempotent: a second call never stacks a second
   * blocker. Returns true when a blocker is held after the call.
   */
  startIfNeeded(): boolean;
  /** Releases the blocker exactly once; safe when nothing was held. */
  release(): void;
  /** True while a blocker is held. */
  readonly active: boolean;
};

export function createAppActivityGuard(
  deps: AppActivityGuardDeps,
): AppActivityGuard {
  let blockerId: number | null = null;
  return {
    startIfNeeded(): boolean {
      if (!deps.isBackgroundTestMode) return false;
      if (blockerId === null) {
        blockerId = deps.start("prevent-app-suspension");
        if (blockerId === null || blockerId <= 0) {
          // A failed start (no valid blocker id) must not leave the guard
          // claiming liveness.
          blockerId = null;
          return false;
        }
      }
      return true;
    },
    release(): void {
      const id = blockerId;
      if (id === null) return;
      blockerId = null;
      deps.stop(id);
    },
    get active(): boolean {
      return blockerId !== null;
    },
  };
}
