// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3, src/shared/orca-yaml-hook-types.ts
// (SHA256 ba972643fe2686e9d896e7867aae149385e9e88d927f3cb7ed66590c6e180d10),
// declarations: PersistedTrustedOrcaHookEntry, PersistedTrustedOrcaHookRepo,
// PersistedTrustedOrcaHooks. Type-only extraction; the other hook-policy types
// in that file stay in the pinned source.

export type PersistedTrustedOrcaHookEntry = {
  contentHash: string
  approvedAt: number
}

export type PersistedTrustedOrcaHookRepo = {
  all?: {
    approvedAt: number
  }
  setup?: PersistedTrustedOrcaHookEntry
  archive?: PersistedTrustedOrcaHookEntry
  issueCommand?: PersistedTrustedOrcaHookEntry
  vmRecipe?: PersistedTrustedOrcaHookEntry
}

export type PersistedTrustedOrcaHooks = Record<string, PersistedTrustedOrcaHookRepo>
