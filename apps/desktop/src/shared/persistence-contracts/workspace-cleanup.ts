// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3, src/shared/workspace-cleanup.ts
// (SHA256 ca72f7ab6fe6707da86ca0ef421f028c8a677a8c5e1508fc90c6171701c7a552),
// declarations: WorkspaceCleanupBlocker, WorkspaceCleanupDismissal,
// WorkspaceCleanupUIState. Type-only extraction; candidate/verdict records and
// the classifier stay in the pinned source.

import type { ExecutionHostId } from './execution-host'
import type { WorkspaceCleanupBrowseState } from './workspace-cleanup-browse-state'

export type WorkspaceCleanupBlocker =
  | 'main-worktree'
  | 'folder-repo'
  | 'pinned'
  | 'active-workspace'
  | 'running-terminal'
  | 'terminal-liveness-unknown'
  | 'dirty-editor-buffer'
  | 'volatile-local-context'
  | 'recent-visible-context'
  | 'live-agent'
  | 'ssh-disconnected'
  | 'git-status-error'
  | 'dirty-files'
  | 'unpushed-commits'
  | 'unknown-base'
  | 'dismissed'

export type WorkspaceCleanupDismissal = {
  worktreeId: string
  dismissedAt: number
  fingerprint: string
  classifierVersion: number
  // Why (STA-4343): `repoId::path` ids repeat across hosts, so ignoring one
  // host's row must not hide another host's. Optional: a dismissal persisted
  // before this field keeps its legacy id-only match.
  executionHostId?: ExecutionHostId
}

export type WorkspaceCleanupUIState = {
  dismissals: Record<string, WorkspaceCleanupDismissal>
  // Why optional: a host that predates the flat list still writes dismissals-only state.
  browse?: WorkspaceCleanupBrowseState
}
