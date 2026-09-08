// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the read-only reference
// src/renderer/src/components/right-sidebar/local-port-details-dialog.tsx:
// same dialog structure, dl grid, copy and ARIA; only the row type and
// literal copy strings are this repo's.
import React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { addressForPort } from './workspace-port-urls'
import type { WorkspacePortRow } from '../../../../shared/usage-contract'

export function LocalPortDetailsDialog({
  port,
  onClose
}: {
  port: WorkspacePortRow | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <Dialog open={Boolean(port)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{port ? `Port :${port.port}` : 'Port'}</DialogTitle>
          <DialogDescription>
            {port ? `${port.processName ?? 'Unknown process'} · ${addressForPort(port)}` : ''}
          </DialogDescription>
        </DialogHeader>
        {port && (
          <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Address</dt>
            <dd className="min-w-0 break-all text-foreground">{addressForPort(port)}</dd>
            <dt className="text-muted-foreground">Bind</dt>
            <dd className="min-w-0 break-all text-foreground">{`${port.bindHost}:${port.port}`}</dd>
            <dt className="text-muted-foreground">Kind</dt>
            <dd className="text-foreground">{port.kind}</dd>
            <dt className="text-muted-foreground">Protocol</dt>
            <dd className="text-foreground">{port.protocol}</dd>
            <dt className="text-muted-foreground">Process</dt>
            <dd className="min-w-0 break-all text-foreground">{port.processName ?? 'Unknown'}</dd>
            <dt className="text-muted-foreground">PID</dt>
            <dd className="text-foreground">{port.pid ?? 'Unknown'}</dd>
            {port.kind === 'workspace' && port.owner && (
              <>
                <dt className="text-muted-foreground">Workspace</dt>
                <dd className="min-w-0 break-all text-foreground">{port.owner.displayName}</dd>
                <dt className="text-muted-foreground">Evidence</dt>
                <dd className="text-foreground">{port.owner.confidence}</dd>
              </>
            )}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  )
}
