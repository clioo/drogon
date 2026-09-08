// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-process-exit-restart.ts
// (the restart reuses the session's own launch identity) adapted to Drogon's
// session record: the record's `harnessId` decides between a `harness.start`
// re-launch and a `session.start` argv re-use; no listed record falls back to
// the daemon's default shell. Pure projection so App's restart handler stays
// one block and the policy stays testable.
import type { HarnessId, Session } from "../../../../shared/session-contract";

export type TerminalRestartLaunch =
  | { kind: "harness"; workspaceId: string; harnessId: HarnessId }
  | { kind: "shell"; workspaceId: string; command: string; args: string[] }
  | { kind: "default"; workspaceId: string };

type PriorRecord = Pick<Session, "workspaceId" | "command" | "args"> & {
  harnessId?: HarnessId | null;
};

/**
 * Projects the restarting session's record onto the bridge calls the
 * App restart handler makes. `prior` is the listed record for the exiting
 * session, when one is still listed.
 */
export function projectTerminalRestartLaunch(
  prior: PriorRecord | undefined,
  fallbackWorkspaceId: string,
): TerminalRestartLaunch {
  const workspaceId = prior?.workspaceId ?? fallbackWorkspaceId;
  if (prior?.harnessId) {
    return { kind: "harness", workspaceId, harnessId: prior.harnessId };
  }
  if (prior && prior.command) {
    return {
      kind: "shell",
      workspaceId,
      command: prior.command,
      args: prior.args,
    };
  }
  return { kind: "default", workspaceId };
}
