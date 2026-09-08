// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only; never edit the reference):
//   src/main/macos-system-sleep-assertion.ts (own a single /usr/bin/caffeinate
//     child; retry/backoff and unexpected-exit reporting trimmed for Drogon)
//   src/shared/computer-awake-mode.ts (on/auto/off vocabulary; the fork's
//     normalize/legacy-boolean bridge collapses here to the three literals)
// Owns exactly one `caffeinate` child while awake is on: spawned by us, killed
// by us, never anything else. Off macOS the mode is remembered but no process
// is spawned (supported: false) so the toggle stays honest.
// Auto mode (R16-AY2, fork semantics): the assertion is held only while an
// agent session is working; awake-auto.ts feeds setAgentWorking from the
// daemon's session list, and idle/quit release the child.
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import type { AwakeMode, AwakeSnapshot } from "../../shared/usage-contract";

export type CaffeinateSpawn = (
  command: string,
  args: string[],
  options: { stdio: "ignore"; windowsHide: true },
) => ChildProcess;

export type AwakeDeps = {
  platform?: NodeJS.Platform;
  spawn?: CaffeinateSpawn;
};

const CAFFINATE_ARGS = ["-i", "-s"];

export class AwakeController {
  private mode: AwakeMode = "off";
  private child: ChildProcess | null = null;
  private agentWorking = false;
  private readonly platform: NodeJS.Platform;
  private readonly spawn: CaffeinateSpawn;

  constructor(deps: AwakeDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.spawn = deps.spawn ?? nodeSpawn;
  }

  getSnapshot(): AwakeSnapshot {
    return {
      mode: this.mode,
      // "Active" always means our assertion is actually held, not just
      // requested: in auto an idle agent keeps active false.
      active: this.child !== null,
      supported: this.platform === "darwin",
    };
  }

  setMode(mode: AwakeMode): AwakeSnapshot {
    this.mode = mode;
    // Entering auto trusts the last known activity report, so On→Agent with a
    // working agent keeps holding without a flicker; any stale report
    // self-corrects within one watcher poll (awake-auto.ts re-reports on the
    // first tick after re-entry).
    if (mode === "on" || (mode === "auto" && this.agentWorking)) {
      this.startOwned();
    } else {
      this.stopOwned();
    }
    return this.getSnapshot();
  }

  /** Auto-mode input from the session watcher: hold/release per activity. */
  setAgentWorking(working: boolean): AwakeSnapshot {
    this.agentWorking = working;
    if (this.mode === "auto") {
      if (working) this.startOwned();
      else this.stopOwned();
    }
    return this.getSnapshot();
  }

  /** Release our child (app shutdown); never touches other processes. */
  dispose(): void {
    this.stopOwned();
  }

  private startOwned(): void {
    if (this.platform !== "darwin" || this.child) return;
    let child: ChildProcess;
    try {
      child = this.spawn("/usr/bin/caffeinate", CAFFINATE_ARGS, {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      this.child = null;
      return;
    }
    const owned = child;
    const clear = () => {
      if (this.child === owned) this.child = null;
    };
    owned.on("error", clear);
    owned.on("exit", clear);
    // Detach from our lifetime bookkeeping, not from the OS: an explicit
    // stop/dispose still kills exactly this child.
    owned.unref?.();
    this.child = owned;
  }

  private stopOwned(): void {
    const owned = this.child;
    this.child = null;
    if (!owned) return;
    try {
      owned.kill();
    } catch {
      // Already gone; nothing else to release.
    }
  }
}
