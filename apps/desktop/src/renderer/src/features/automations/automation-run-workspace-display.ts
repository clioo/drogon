// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/automations/automation-run-workspace-display.ts.
// Adaptation: this repo's workspace records are the shared `Workspace`
// (id + name), not Git worktrees; labels and muting stay literal.
import type { AutomationRunDetail } from "../../../../shared/automation-contract";
import type { Workspace } from "../../../../shared/session-contract";

export type AutomationRunWorkspaceDisplay = {
  rowLabel: string;
  detailLabel: string;
  muted: boolean;
  title?: string;
};

export function getAutomationRunWorkspaceDisplay({
  run,
  workspace,
}: {
  run: AutomationRunDetail;
  workspace: Workspace | null;
}): AutomationRunWorkspaceDisplay {
  if (!run.workspaceId) {
    return {
      rowLabel: "Not launched",
      detailLabel: "Not launched",
      muted: true,
    };
  }
  if (workspace) {
    return {
      rowLabel: workspace.name,
      detailLabel: workspace.name,
      muted: false,
      title: workspace.name,
    };
  }

  const previousName = run.workspaceDisplayName?.trim();
  if (previousName) {
    const deletedLabel = `${previousName} (no longer available)`;
    return {
      rowLabel: previousName,
      detailLabel: deletedLabel,
      muted: true,
      title: deletedLabel,
    };
  }

  return {
    rowLabel: "Workspace no longer available",
    detailLabel: "Workspace no longer available",
    muted: true,
  };
}
