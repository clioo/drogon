// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/mentu-session-state-types.ts
// (SHA256 4d16f4f48e0a07c1cd67ff9e1801e52e733971bdafdb7e957c2a4403a51fce1d),
// declarations: MentuSessionPersistedState, MentuSessionStatesByKey.
// Type-only extraction; buildMentuSessionKey stays in the pinned source.

import type { MentuPaneMode } from './mentu-pane-types'

/** Client-owned state for one Mentu view of one workspace session. */
export type MentuSessionPersistedState = {
  selectedPath: string | null
  mode: MentuPaneMode
  /** Unsaved source projections, keyed by recipe path. */
  draftSourceByPath: Record<string, string>
  /** Last host-owned run id; evidence is re-read after a renderer or app restart. */
  lastRunId?: string | null
}

export type MentuSessionStatesByKey = Record<string, MentuSessionPersistedState>
