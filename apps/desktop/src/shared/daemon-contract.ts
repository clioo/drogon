// MIT Copyright (c) 2026 Lovecast Inc.
// Additive daemon-restart contract for Settings → Manage Sessions
// ("Restart daemon" beside Kill all). The fork restarts its daemon through
// `window.api.pty.management.restart()` (read-only reference:
// src/preload/api/pty-management-api.ts, `restart: () => Promise<{
// success: boolean }>`); Drogon's daemon stops through its own
// `runtime.shutdown` RPC instead, so this contract reports manageability
// instead of a bare success flag: a dev daemon started by the operator has
// no respawn target and the button must stay disabled with the reason.
import { z } from "zod";
import type { Result } from "./session-contract";

/** Single `drogon:daemon:restart` input: absent/`{}` restarts, `{probe:true}` only reports availability. */
export const daemonRestartInputSchema = z.union([
  z.undefined(),
  z.object({ probe: z.boolean().optional() }),
]);
/** What the renderer is told about an update seen at launch (the type is
 *  shared with the preload contract; `daemon-update.ts` owns the decision
 *  and `index.ts` the wiring). `revision` is the freshly-installed build's
 *  revision (short form), null when the bundle predates build-info. */
export type DaemonUpdateState =
  | {
      kind: "updated";
      revision: string | null;
      note: string;
    }
  | {
      kind: "pending";
      revision: string | null;
      reason: string;
    };

export type DaemonRestartInput = { probe?: boolean };

/**
 * One shape for the probe and the restart: `managed` tells the renderer
 * whether the button is enabled, `reason` is the disabled title when it is
 * not, `restarted` is true only after a replacement daemon answers
 * `status` healthy, and `stoppedSessions` counts the sessions main stopped
 * before the shutdown it requested.
 */
export type DaemonRestartResult = {
  restarted: boolean;
  managed: boolean;
  reason: string | null;
  stoppedSessions: number;
};

export interface DaemonBridge {
  restart(input?: DaemonRestartInput): Promise<DaemonRestartResult>;
  /** Install-resilience P5: the launch-time update state main observed
   *  ("Drogon updated; restarted its background service" or the honest
   *  "update pending" state), or null when this launch saw no change. */
  updateState(): Promise<DaemonUpdateState | null>;
}

declare module "./session-contract" {
  interface DesktopBridge {
    daemon: DaemonBridge;
  }
}

/** Status fence params `runtime.shutdown` requires (service-quiescence: hostId + serviceInstanceId). */
export type DaemonShutdownFences = {
  hostId: string;
  serviceInstanceId: string;
};

export type NativeCall = (
  method: string,
  params: Record<string, unknown>,
) => Promise<Result<unknown>>;
