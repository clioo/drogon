// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/ai-vault-session-title.ts
// (SHA256 536df5ff26e96a377953abc42658223d222f9358671cc83cf4b8705dfaafc1bc),
// declarations: AiVaultSessionTitle. Type-only extraction.

import type { AiVaultAgent } from './ai-vault-types'

export type AiVaultSessionTitle = {
  agent: Extract<AiVaultAgent, 'claude' | 'codex'>
  sessionId: string
  title: string
}
