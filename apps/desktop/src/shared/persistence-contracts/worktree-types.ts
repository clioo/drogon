// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3, src/shared/worktree/types.ts
// (SHA256 97a7d676f27eb18f5be3a82deb930c407f492b2de1134d0e7d3564d1f40b764d),
// declarations: WorkspaceStatus, WorkspaceStatusDefinition. Type-only
// extraction; the Worktree/WorkspaceLinkedItem/provenance record types stay in
// the pinned source.

export type WorkspaceStatus = string

export type WorkspaceStatusDefinition = {
  id: WorkspaceStatus
  label: string
  color?: string
  icon?: string
}
