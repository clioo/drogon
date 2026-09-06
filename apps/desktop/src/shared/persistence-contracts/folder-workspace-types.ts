// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/folder-workspace-types.ts
// (SHA256 5992e2cfe64f272a370f1817efce6ac70ba41ec9dde4452e0ac9ed22945396a6),
// declarations: WorkspaceScope, WorkspaceKey. Type-only extraction; the
// FolderWorkspace record and its service-side closures stay in the pinned
// source (only the persisted key/scope contract is referenced by the session
// snapshot).

export type WorkspaceScope =
  | { type: 'worktree'; worktreeId: string }
  | { type: 'folder'; folderWorkspaceId: string }

export type WorkspaceKey = `worktree:${string}` | `folder:${string}`
