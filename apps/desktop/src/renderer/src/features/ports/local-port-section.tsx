// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/components/right-sidebar/local-port-section.tsx: same
// DOM, Tailwind classes, copy, icons and ARIA; only the row type comes
// from this repo's shared contract.
import React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { WorkspacePortRow } from '../../../../shared/usage-contract'
import { LocalPortRow } from './local-port-row'

export function LocalPortSection({
  id,
  title,
  ports,
  emptyText,
  collapsed,
  onToggle,
  onShowDetails,
  onOpenInBrowser
}: {
  id: string
  title: string
  ports: WorkspacePortRow[]
  emptyText?: string
  collapsed: boolean
  onToggle: () => void
  onShowDetails: (port: WorkspacePortRow) => void
  onOpenInBrowser: (port: WorkspacePortRow, event?: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element | null {
  if (ports.length === 0 && !emptyText) {
    return null
  }

  return (
    <div className="px-3 pt-2">
      <button
        type="button"
        className="sticky top-0 z-10 mb-1 flex w-full items-center gap-1 border-b border-border/40 bg-background py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={`local-port-section-${id}`}
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 transition-transform', !collapsed && 'rotate-90')}
        />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        {ports.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60 ml-1">{ports.length}</span>
        )}
      </button>
      {!collapsed && (
        <div id={`local-port-section-${id}`}>
          {ports.length > 0
            ? ports.map((port) => (
                <LocalPortRow
                  key={port.id}
                  port={port}
                  onShowDetails={onShowDetails}
                  onOpenInBrowser={onOpenInBrowser}
                />
              ))
            : emptyText && <div className="py-1 text-xs text-muted-foreground">{emptyText}</div>}
        </div>
      )}
    </div>
  )
}
