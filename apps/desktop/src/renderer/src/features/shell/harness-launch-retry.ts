// MIT Copyright (c) 2026 Lovecast Inc.
// Retry parity for failed harness launches. The fork's error overlay
// Restart re-runs the pane's recorded startup argv verbatim
// (src/renderer/src/components/terminal-pane/terminal-process-exit-restart.ts,
// used by use-terminal-pane-process-exit-actions.ts
// handleRestartExitedPane), so provider/model/prompt survive the retry.
// Drogon's Session record carries only harnessId, so App remembers the
// exact HarnessLaunchInput per resulting session id; this module projects
// that memory onto the payloads the relaunch paths send. Pure — the retry
// payload is unit-tested in harness-launch-retry.test.ts.
import type {
  HarnessId,
  HarnessLaunchInput,
  Session,
} from "../../../../shared/session-contract";

/** The last launch inputs, keyed by the session the launch produced. */
export type HarnessLaunchMemory = Map<string, HarnessLaunchInput>;

export function rememberHarnessLaunch(
  memory: HarnessLaunchMemory,
  session: Pick<Session, "id">,
  input: HarnessLaunchInput,
): void {
  memory.set(session.id, input);
}

/**
 * The remembered inputs for a session, or null when a same-input relaunch
 * is not possible: plain shells never had a harness launch, and a session
 * App did not launch in this window (restored stubs) has no memory. Null
 * callers fall back to the refresh/reconnect path.
 */
export function harnessLaunchForRetry(
  memory: HarnessLaunchMemory,
  session: Pick<Session, "id"> & { harnessId?: HarnessId | null },
): HarnessLaunchInput | null {
  if (!session.harnessId) return null;
  return memory.get(session.id) ?? null;
}

/**
 * The retry payload: same workspace, harness and every launch input —
 * provider, model, effort, prompt, permission mode — with a fresh
 * requestId so the daemon treats it as a new attempt, never a duplicate.
 */
export function buildHarnessLaunchRetry(
  input: HarnessLaunchInput,
  requestId: string,
): HarnessLaunchInput {
  return {
    workspaceId: input.workspaceId,
    harnessId: input.harnessId,
    model: input.model,
    provider: input.provider,
    effort: input.effort,
    prompt: input.prompt,
    permissionMode: input.permissionMode,
    requestId,
    // A resume is part of the launch identity: relaunching a session that was
    // itself a resume must reopen the same provider conversation, not a blank
    // one. Both keys were in the remembered input verbatim, so the replay
    // stays exact (and absent keys stay absent, keeping a plain launch plain).
    ...(input.resume ? { resume: true as const } : {}),
    ...(input.resumeSessionId
      ? { resumeSessionId: input.resumeSessionId }
      : {}),
  };
}
