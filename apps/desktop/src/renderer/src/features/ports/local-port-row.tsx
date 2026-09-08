// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/components/right-sidebar/local-port-row.tsx: same DOM,
// Tailwind classes, copy, icons, keyboard/blur handling and ARIA.
// Adapted: clipboard goes through navigator.clipboard (no window.api.ui in
// this repo); the Stop Process action calls this repo's
// workspacePorts.kill bridge (R16-BC) instead of the source's
// workspacePorts.kill IPC.
import React, { useCallback } from 'react'
import { Copy, ExternalLink, Info, Server, Trash2 } from 'lucide-react'
import { getPortOpenBrowserTooltipLabel, shouldOpenPortInAppBrowser } from './workspace-port-open'
import { addressForPort } from './workspace-port-urls'
import { Button } from '../../components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '../../components/ui/context-menu'
import type { WorkspacePortRow } from '../../../../shared/usage-contract'

const LOCAL_PORT_MENU_CONTENT_CLASS =
  '!rounded-md !border-border/60 !bg-popover !text-popover-foreground !shadow-[0_10px_24px_rgba(0,0,0,0.18)] !backdrop-blur-none'
const LOCAL_PORT_MENU_ITEM_CLASS =
  'rounded-md focus:bg-accent focus:text-accent-foreground dark:focus:bg-accent'
const LOCAL_PORT_MENU_LABEL_CLASS = 'px-2 py-1 text-[11px] font-semibold text-muted-foreground'

export function LocalPortRow({
  port,
  onStop,
  onShowDetails,
  onOpenInBrowser
}: {
  port: WorkspacePortRow
  onStop: (port: WorkspacePortRow) => void
  onShowDetails: (port: WorkspacePortRow) => void
  onOpenInBrowser: (port: WorkspacePortRow, event?: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  const handleCopy = useCallback(() => {
    try {
      void navigator.clipboard?.writeText(addressForPort(port))?.catch(() => {})
    } catch {
      // Clipboard unavailable: the copy action is a no-op.
    }
  }, [port])

  const handleOpenBrowser = useCallback(
    (event?: React.MouseEvent<HTMLButtonElement>) => {
      void onOpenInBrowser(port, event)
    },
    [onOpenInBrowser, port]
  )

  const handleCopyButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      handleCopy()
      if (event.detail > 0) {
        event.currentTarget.blur()
      }
    },
    [handleCopy]
  )

  const handleOpenBrowserButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // Why: keyboard activations have detail=0; only pointer clicks carry
      // the modifier intent for the system-browser escape hatch.
      handleOpenBrowser(event.detail > 0 ? event : undefined)
      if (event.detail > 0) {
        event.currentTarget.blur()
      }
    },
    [handleOpenBrowser]
  )

  const handleStopButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onStop(port)
      if (event.detail > 0) {
        event.currentTarget.blur()
      }
    },
    [onStop, port]
  )

  const processLabel = port.processName ?? (port.pid ? `PID ${port.pid}` : 'Unknown process')
  const address = addressForPort(port)
  const ownerLabel =
    port.kind === 'workspace' ? (port.owner?.displayName ?? 'Workspace') : 'Unassigned'
  const openBrowserLabel = 'Open in Browser'
  const confidenceLabel = port.kind === 'workspace' ? (port.owner?.confidence === 'cwd' ? 'cwd' : 'command') : null
  // Source parity: only workspace rows with a known pid are stoppable, and
  // the app never offers to stop itself.
  const canStopProcess =
    port.kind === 'workspace' && Boolean(port.pid) && port.processName !== 'Electron'

  return (
    <ContextMenu>
      <div className="group flex items-center gap-2 py-1 px-1 -mx-1 rounded hover:bg-accent/50 transition-colors">
        <ContextMenuTrigger asChild>
          <div
            className="flex min-w-0 flex-1 items-center gap-2 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            tabIndex={0}
            aria-label={`Port ${port.port} menu`}
          >
            <div className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
              <Server size={13} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="text-xs font-medium text-foreground">:{port.port}</span>
                <span className="truncate text-xs text-muted-foreground">{processLabel}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="truncate">{address}</span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground/70">
                <span className="truncate">{ownerLabel}</span>
                {confidenceLabel && (
                  <span className="shrink-0 text-muted-foreground/70">{confidenceLabel}</span>
                )}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        <TooltipProvider delayDuration={400}>
          <div className="flex items-center gap-0.5 can-hover:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={handleOpenBrowserButtonClick}
                  aria-label={openBrowserLabel}
                >
                  <ExternalLink size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {getPortOpenBrowserTooltipLabel(openBrowserLabel)}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={handleCopyButtonClick}
                  aria-label={`Copy ${address}`}
                >
                  <Copy size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {`Copy ${address}`}
              </TooltipContent>
            </Tooltip>
            {canStopProcess && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={handleStopButtonClick}
                    aria-label="Stop Process"
                  >
                    <Trash2 size={13} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  Stop Process
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>
      </div>
      <ContextMenuContent className={LOCAL_PORT_MENU_CONTENT_CLASS}>
        <ContextMenuLabel className={LOCAL_PORT_MENU_LABEL_CLASS}>{`:${port.port}`}</ContextMenuLabel>
        <ContextMenuItem className={LOCAL_PORT_MENU_ITEM_CLASS} onSelect={() => handleOpenBrowser()}>
          <ExternalLink size={13} />
          {openBrowserLabel}
        </ContextMenuItem>
        <ContextMenuItem className={LOCAL_PORT_MENU_ITEM_CLASS} onSelect={handleCopy}>
          <Copy size={13} />
          Copy Address
        </ContextMenuItem>
        <ContextMenuItem
          className={LOCAL_PORT_MENU_ITEM_CLASS}
          onSelect={() => {
            try {
              void navigator.clipboard
                ?.writeText(JSON.stringify(port, null, 2))
                ?.catch(() => {})
            } catch {
              // Clipboard unavailable: the copy action is a no-op.
            }
          }}
        >
          <Copy size={13} />
          Copy Details
        </ContextMenuItem>
        <ContextMenuItem className={LOCAL_PORT_MENU_ITEM_CLASS} onSelect={() => onShowDetails(port)}>
          <Info size={13} />
          Show Details
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className={LOCAL_PORT_MENU_ITEM_CLASS}
          variant="destructive"
          disabled={!canStopProcess}
          onSelect={() => onStop(port)}
        >
          <Trash2 size={13} />
          Stop Process
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
