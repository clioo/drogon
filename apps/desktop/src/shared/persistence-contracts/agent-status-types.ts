// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3, src/shared/agent-status-types.ts
// (SHA256 0ba3ad47b07f5b1f7db1a24e2284d8f724180c0112a03f10b34853b482f6e72b),
// declarations: AGENT_STATUS_STATES, AgentStatusState, WellKnownAgentType,
// AgentType. Type-only extraction.

export const AGENT_STATUS_STATES = ['working', 'blocked', 'waiting', 'done'] as const
export type AgentStatusState = (typeof AGENT_STATUS_STATES)[number]
// Why: agent types aren't a fixed set (custom agents exist); any non-empty string is
// accepted — these well-known names are just a convenience union for pattern-matching.
export type WellKnownAgentType =
  | 'claude'
  | 'openclaude'
  | 'codex'
  | 'gemini'
  | 'antigravity'
  | 'amp'
  | 'opencode'
  | 'mimo-code'
  | 'cursor'
  | 'copilot'
  | 'aider'
  | 'pi'
  | 'omp'
  | 'prime-agent'
  | 'droid'
  | 'command-code'
  | 'grok'
  | 'hermes'
  | 'devin'
  | 'ante'
  | 'trae'
  | 'unknown'
export type AgentType = WellKnownAgentType | (string & {})
