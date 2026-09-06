// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/workspace-cleanup-browse-state.ts
// (SHA256 e6986579b9a70f02e32749af48f405d42445dc3497c6ae23ad3d0568e824d710),
// declarations: WORKSPACE_CLEANUP_BROWSE_STATE_VERSION,
// WorkspaceCleanupBrowseState. Type/constant extraction; the default-factory
// and tolerant normalizer stay in the pinned source.

import type {
  WorkspaceCleanupFilterState,
  WorkspaceCleanupSortState,
} from './workspace-cleanup-filter-model'

/** Bump only for a shape change the tolerant normalizer cannot absorb. */
export const WORKSPACE_CLEANUP_BROWSE_STATE_VERSION = 1

/**
 * Serializable slice of the cleanup dialog persisted under
 * `WorkspaceCleanupUIState.browse`. Everything here is plain JSON so it
 * round-trips through orca-data.json and the client-ui RPC schema.
 */
export type WorkspaceCleanupBrowseState = {
  version: number
  filters: WorkspaceCleanupFilterState
  sort: WorkspaceCleanupSortState
}
