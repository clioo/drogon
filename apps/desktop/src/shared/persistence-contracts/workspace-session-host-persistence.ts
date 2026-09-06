// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/renderer/src/lib/workspace-session-host-persistence.ts
// (SHA256 cc4edd0b06b6bda36bf76e0ff38962768f7e0780944335483724d0ed000041e1),
// declarations: WorkspaceSessionHostSnapshot. Type-only extraction from the
// runtime-heavy host-persistence module; the restore/ownership helpers stay in
// the pinned source.

import type { ExecutionHostId } from './execution-host'
import type { WorkspaceSessionState } from './workspace-session-state-types'

export type WorkspaceSessionHostSnapshot = {
  state: WorkspaceSessionState
  hostId?: ExecutionHostId
}
