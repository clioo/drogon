// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/automation-run-view-state.ts.
// Adaptation: local runs carry no terminal pane identity the renderer can
// resolve (the shell's pane/layout state is not reachable from this
// page), so the source's terminal/workspace availability collapses into
// one question the daemon answers honestly: does the run's session still
// exist? When it does, the action is "Open session" (re-reads the live
// session output); otherwise the page shows the saved snapshot or falls
// back to metadata-only copy, mirroring the source's ladder.
import type { AutomationRunDetail } from "../../../../shared/automation-contract";

export type AutomationRunViewAvailability = "session" | "snapshot" | "metadata";

export type AutomationRunViewState = {
  availability: AutomationRunViewAvailability
  actionLabel: string
  statusLabel: string
  canOpen: boolean
};

export const AUTOMATION_RERUN_PENDING_MIN_VISIBLE_MS = 800;

export function getAutomationRerunPendingRemainingMs({
  pendingStartedAt,
  now = Date.now(),
}: {
  pendingStartedAt: number;
  now?: number;
}): number {
  return Math.max(0, pendingStartedAt + AUTOMATION_RERUN_PENDING_MIN_VISIBLE_MS - now);
}

export async function waitForAutomationRerunPendingVisibility(
  pendingStartedAt: number,
): Promise<void> {
  const remainingMs = getAutomationRerunPendingRemainingMs({ pendingStartedAt });
  if (remainingMs <= 0) {
    return;
  }
  await new Promise<void>((resolve) => window.setTimeout(resolve, remainingMs));
}

export function canRerunAutomationRun({
  automationId,
  run,
}: {
  automationId: string | null;
  run: AutomationRunDetail;
}): boolean {
  if (!automationId || run.automationId !== automationId) {
    return false;
  }
  return (
    run.status === "dispatch_failed" ||
    run.status === "skipped_unavailable" ||
    run.status === "skipped_needs_interactive_auth"
  );
}

export function getAutomationRunViewState({
  run,
  sessionExists,
}: {
  run: AutomationRunDetail;
  sessionExists: boolean;
}): AutomationRunViewState {
  if (run.workspaceId && sessionExists) {
    return {
      availability: "session",
      actionLabel: "Open session",
      statusLabel: "Run is open",
      canOpen: true,
    };
  }

  if (run.outputSnapshot?.content.trim()) {
    return {
      availability: "snapshot",
      actionLabel: "Snapshot saved",
      statusLabel: "Showing saved run snapshot.",
      canOpen: false,
    };
  }

  return {
    availability: "metadata",
    actionLabel: "View run",
    statusLabel: run.workspaceId
      ? run.workspaceDisplayName?.trim()
        ? `${run.workspaceDisplayName.trim()} no longer available`
        : "Workspace no longer available"
      : "No workspace launched",
    canOpen: false,
  };
}
