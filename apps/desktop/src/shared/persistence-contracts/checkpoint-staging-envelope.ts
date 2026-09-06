// Host-qualified checkpoint staging envelope — the complete persisted renderer
// contract bound to the accepted generic shutdown-checkpoint policy factory.
//
// Source provenance: Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3 — the envelope reproduces the
// staging payload of src/main/ipc/renderer-shutdown-checkpoint.ts
// (SHA256 recorded in the mapping report): `sessions` are host-qualified
// renderer workspace snapshots and `ui` is a partial persisted UI state, with
// no payload filtering. The generic factory is the accepted candidate port at
// ../../renderer/src/app-shell/shutdown-checkpoint-persist.ts; Rust remains the
// durable execution owner. This file declares the CONTRACT binding only —
// runtime admission, serialization, database ownership and caller wiring stay
// open root gates.

import type {
  ShutdownCheckpointPersistDeps,
  ShutdownCheckpointStageArgs,
} from '../../renderer/src/app-shell/shutdown-checkpoint-persist'
import type { PersistedUIState } from './persisted-ui-state-types'
import type { WorkspaceSessionHostSnapshot } from './workspace-session-host-persistence'

/** The complete host-qualified checkpoint staging payload: one call stages
 *  every renderer-owned workspace snapshot (each with its owning execution
 *  host) plus the partial persisted UI state, exactly as the pinned main/ipc
 *  handler consumed them. No fields are filtered or widened. */
export type HostQualifiedCheckpointStageArgs = ShutdownCheckpointStageArgs<
  WorkspaceSessionHostSnapshot,
  Partial<PersistedUIState>
>

/** Compile-time proof that the envelope binds the accepted generic factory
 *  without payload filtering: the accepted generic dependency contract is
 *  instantiated directly with the complete contract types (no duplicated or
 *  hand-copied field list). */
export type BoundCheckpointPersistDeps = ShutdownCheckpointPersistDeps<
  WorkspaceSessionHostSnapshot,
  Partial<PersistedUIState>
>
