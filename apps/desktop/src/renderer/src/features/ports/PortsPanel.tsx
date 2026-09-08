// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/components/right-sidebar/PortsPanel.tsx. Adapted: this
// repo has no SSH workspaces, so the source's SshPortsPanel branch is not
// ported — every workspace renders the local panel.
import React from 'react'
import type { Workspace } from '../../../../shared/session-contract'
import type { WorkspacePortsBridge } from '../../../../shared/usage-contract'
import { LocalWorkspacePortsPanel } from './local-workspace-ports-panel'

export function PortsPanel({
  isVisible,
  workspace,
  onOpenInBrowserTab,
  bridge
}: {
  isVisible: boolean
  workspace: Workspace | null
  onOpenInBrowserTab: (url: string) => void
  bridge?: WorkspacePortsBridge
}): React.JSX.Element {
  return (
    <LocalWorkspacePortsPanel
      isVisible={isVisible}
      workspace={workspace}
      onOpenInBrowserTab={onOpenInBrowserTab}
      bridge={bridge}
    />
  )
}
