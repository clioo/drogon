// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3, src/shared/ai-vault-types.ts
// (SHA256 096fbb5b1c458243d2630f7e2e5506d929bbd044ff0caa70f4a9ed2d9b96a3e7),
// declarations: AI_VAULT_AGENTS, AiVaultAgent. Type-only extraction.

import type { TuiAgent } from './tui-agent'

export const AI_VAULT_AGENTS = [
  'claude',
  'codex',
  'hermes',
  'pi',
  'omp',
  'prime-agent',
  'cursor',
  'gemini',
  'antigravity',
  'rovo',
  'copilot',
  'opencode',
  'grok',
  'openclaw',
  'devin',
  'droid',
  'cline',
  'kimi'
] as const satisfies readonly TuiAgent[]

export type AiVaultAgent = (typeof AI_VAULT_AGENTS)[number]
