// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/terminal-process-exit-restart.ts
// (the restart reuses the session's own launch identity) adapted to Drogon's
// session record: the record's `harnessId` decides between a `harness.start`
// re-launch and a `session.start` argv re-use; no listed record falls back to
// the daemon's default shell. Pure projection so App's restart handler stays
// one block and the policy stays testable.
import type { HarnessId, Session } from "../../../../shared/session-contract";
import {
  projectTerminalProcessExit,
  terminalProcessExitOffersResume,
} from "./terminal-process-exit";
import {
  resumableSessionFor,
  type SleepingSessionRecord,
} from "./sleeping-session";

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

/** The `harness.start` resume input the overlay's primary action implies. */
export type TerminalRestartResume =
  | { resume: true; resumeSessionId: string }
  | Record<string, never>;

/** The record subset the resume projection reads: the conversation identity
 *  (like the sleeping projection) plus the exit facts the overlay's own
 *  projection needs, so both read the same row. */
export type TerminalRestartPrior = SleepingSessionRecord & {
  exitCode?: number | null;
  args?: string[];
  causedByEventId?: string | null;
};

/**
 * Projects the overlay action onto the resume input `harness.start` needs.
 *
 * The pane renders the action, this decides it, from the SAME projections the
 * pane used: a sleeping (`unverifiable`) session resumes its conversation, and
 * an `exited` session resumes it only when its overlay actually offered a
 * resume (a plain shell, a harness with no resume verb and a headless turn
 * keep the plain relaunch). Anything else is a restart with no resume flag,
 * exactly as before -- so the button and the launch can never disagree.
 */
export function projectTerminalRestartResume(
  prior: TerminalRestartPrior | undefined,
): TerminalRestartResume {
  if (!prior) return {};
  const resumable = resumableSessionFor(prior);
  if (!resumable) return {};
  if (prior.verdict === "unverifiable") {
    return { resume: true, resumeSessionId: resumable.sessionId };
  }
  if (prior.verdict === "exited") {
    const exit = projectTerminalProcessExit(prior);
    return exit && terminalProcessExitOffersResume(exit)
      ? { resume: true, resumeSessionId: resumable.sessionId }
      : {};
  }
  // A live session is not reopened at all: the pane focuses it instead.
  return {};
}
