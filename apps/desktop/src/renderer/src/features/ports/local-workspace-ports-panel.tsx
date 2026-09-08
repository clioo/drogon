// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/components/right-sidebar/local-workspace-ports-panel.tsx:
// same header/section/empty-state DOM, Tailwind classes, copy, icons and
// ARIA. Data-layer adaptations:
//  - rows come from this repo's `drogon.workspacePorts.list` channel,
//    polled at the source's WorkspacePortScanner cadence (30s) while the
//    panel is visible (the source scopes a shared all-worktree poll);
//  - "Open in Browser" creates a browser tab through the host's tab strip
//    (onOpenInBrowserTab) or, on Shift+Cmd/Ctrl+click, the system browser
//    via shell.openExternal — the source's openWorkspacePortInBrowser flow;
//  - refresh and system-browser-open failures toast like the source
//    (sonner landed with r13-c); the Stop Process action waits for a
//    workspacePorts.kill channel.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Server } from 'lucide-react'
import { toast } from 'sonner'
import type { Workspace } from '../../../../shared/session-contract'
import type { ShellBridge } from '../../../../shared/shell-contract'
import type {
  WorkspacePortRow,
  WorkspacePortsBridge,
  WorkspacePortsSnapshot,
} from '../../../../shared/usage-contract'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip'
import { browserUrlForPort } from './workspace-port-urls'
import { shouldOpenPortInAppBrowser } from './workspace-port-open'
import {
  getLocalWorkspacePortSections,
  shouldShowLocalWorkspacePortSections
} from './local-workspace-port-sections'
import { LocalPortSection } from './local-port-section'
import { LocalPortDetailsDialog } from './local-port-details-dialog'

// Why: the source's panel scopes WorkspacePortScanner's 30s all-worktree
// poll; this panel owns the same cadence for its own channel.
const PORTS_POLL_MS = 30_000

/** Right-sidebar Ports panel scoped to the active workspace. */
export function LocalWorkspacePortsPanel({
  isVisible,
  workspace,
  onOpenInBrowserTab,
  bridge = window.drogon.workspacePorts
}: {
  isVisible: boolean
  workspace: Workspace | null
  /** Creates a browser tab owned by the workspace's tab strip (the "+" menu path). */
  onOpenInBrowserTab: (url: string) => void
  bridge?: WorkspacePortsBridge
}): React.JSX.Element {
  const [scan, setScan] = useState<WorkspacePortsSnapshot | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [detailsPort, setDetailsPort] = useState<WorkspacePortRow | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    other: true,
    external: true
  })

  const refresh = useCallback(async () => {
    if (!workspace) return
    setRefreshing(true)
    try {
      const result = await bridge.list({ workspaceId: workspace.id })
      if (!result.ok) throw new Error(result.error.message)
      setScan(result.result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error('Failed to refresh ports', {
        description: message || 'Workspace port scan failed.'
      })
    } finally {
      setRefreshing(false)
    }
  }, [bridge, workspace])

  // Poll while visible (source cadence); stop when hidden or unmounted.
  useEffect(() => {
    if (!isVisible || !workspace) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), PORTS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [isVisible, workspace, refresh])

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }))
  }, [])

  const handleOpenPortInBrowser = useCallback(
    async (port: WorkspacePortRow, event?: React.MouseEvent<HTMLButtonElement>) => {
      const url = browserUrlForPort(port)
      if (!shouldOpenPortInAppBrowser({ event, isMac: navigator.userAgent.includes('Mac') })) {
        // System-browser escape hatch; the granted shell namespace is cast
        // once here (same posture as App's open-external handler).
        const shell = (window.drogon as unknown as { shell?: ShellBridge }).shell
        if (!shell || typeof shell.openExternal !== 'function') {
          toast.error('Failed to open browser', {
            description: 'The shell bridge is not exposed.'
          })
          return
        }
        try {
          await shell.openExternal(url)
        } catch (error) {
          toast.error('Failed to open browser', {
            description: error instanceof Error ? error.message : String(error)
          })
        }
        return
      }
      onOpenInBrowserTab(url)
    },
    [onOpenInBrowserTab]
  )

  const { activePorts, otherWorkspacePorts, externalPorts } = useMemo(
    () => getLocalWorkspacePortSections(isVisible ? scan : null, workspace?.id),
    [isVisible, scan, workspace?.id]
  )

  const showPortSections = shouldShowLocalWorkspacePortSections(isVisible ? scan : null, {
    activePorts,
    otherWorkspacePorts,
    externalPorts
  })

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center text-muted-foreground">
        <Server size={32} className="mb-3 opacity-50" />
        <p className="text-sm">No workspace selected</p>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex flex-col h-full overflow-y-auto scrollbar-sleek">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ports
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => void refresh()}
                disabled={refreshing}
                aria-label="Refresh Ports"
              >
                <RefreshCw size={14} className={cn(refreshing && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              Refresh Ports
            </TooltipContent>
          </Tooltip>
        </div>

        {scan?.unavailableReason && (
          <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
            {`Port scan unavailable on ${scan.platform}: ${scan.unavailableReason}`}
          </div>
        )}

        {showPortSections && (
          <>
            <LocalPortSection
              id="active"
              title="Active Workspace"
              ports={activePorts}
              emptyText={refreshing && !scan ? 'Scanning...' : 'No ports detected'}
              collapsed={collapsedSections.active ?? false}
              onToggle={() => toggleSection('active')}
              onShowDetails={setDetailsPort}
              onOpenInBrowser={handleOpenPortInBrowser}
            />
            <LocalPortSection
              id="other"
              title="Other Workspaces"
              ports={otherWorkspacePorts}
              collapsed={collapsedSections.other ?? false}
              onToggle={() => toggleSection('other')}
              onShowDetails={setDetailsPort}
              onOpenInBrowser={handleOpenPortInBrowser}
            />
            <LocalPortSection
              id="external"
              title="External"
              ports={externalPorts}
              collapsed={collapsedSections.external ?? false}
              onToggle={() => toggleSection('external')}
              onShowDetails={setDetailsPort}
              onOpenInBrowser={handleOpenPortInBrowser}
            />
          </>
        )}

        {!scan?.unavailableReason &&
          scan &&
          activePorts.length === 0 &&
          otherWorkspacePorts.length === 0 &&
          externalPorts.length === 0 && (
            <div className="flex flex-col items-center justify-center flex-1 px-4 text-center text-muted-foreground">
              <Server size={32} className="mb-3 opacity-50" />
              <p className="text-sm">No local ports detected</p>
            </div>
          )}

        <LocalPortDetailsDialog port={detailsPort} onClose={() => setDetailsPort(null)} />
      </div>
    </TooltipProvider>
  )
}
