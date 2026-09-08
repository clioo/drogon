// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/components/right-sidebar/local-workspace-port-sections.ts
// (getLocalWorkspacePortSections, shouldShowLocalWorkspacePortSections).
// Adapted: the owner carries this repo's single workspaceId, and rows are
// already kinded by the main-process reader, so the workspace→external
// rewrite helper is unnecessary.

import type { WorkspacePortRow } from "../../../../shared/usage-contract";

export function getLocalWorkspacePortSections(
  scan: { ports: WorkspacePortRow[] } | null | undefined,
  activeWorkspaceId: string | null | undefined
): {
  activePorts: WorkspacePortRow[]
  otherWorkspacePorts: WorkspacePortRow[]
  externalPorts: WorkspacePortRow[]
} {
  const ports = scan?.ports ?? []
  return {
    activePorts: ports.filter(
      (port) => port.kind === "workspace" && port.owner?.workspaceId === activeWorkspaceId
    ),
    otherWorkspacePorts: ports.filter(
      (port) => port.kind === "workspace" && port.owner?.workspaceId !== activeWorkspaceId
    ),
    // Why: unattributed listeners stay visible as External, without
    // workspace-only actions — the source's cross-worktree behavior.
    externalPorts: ports.filter((port) => port.kind !== "workspace")
  }
}

/**
 * Whether the panel still renders its port sections under a failure notice.
 * Why: a failed scan retains the host's last-good ports, so hiding every
 * section would drop the open actions for ports the status bar still counts
 * and lists.
 */
export function shouldShowLocalWorkspacePortSections(
  scan: { unavailableReason?: string | null } | null | undefined,
  sections: { activePorts: unknown[]; otherWorkspacePorts: unknown[]; externalPorts: unknown[] }
): boolean {
  if (!scan?.unavailableReason) {
    return true
  }
  return (
    sections.activePorts.length > 0 ||
    sections.otherWorkspacePorts.length > 0 ||
    sections.externalPorts.length > 0
  )
}
