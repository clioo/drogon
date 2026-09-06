// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3, src/shared/agent-session-resume.ts
// (SHA256 ebd386d6613f3d6251817039eff56c18e3bc4496dd6bd7cbc74322b9212442ae),
// declarations: RESUMABLE_TUI_AGENTS, ResumableTuiAgent,
// AgentProviderSessionKey, AgentProviderSessionMetadata,
// SleepingAgentLaunchConfig, SleepingAgentSessionRecord. Constant/type
// extraction; the resume argv builders and normalizers stay in the pinned
// source.

import type { AgentStatusState } from './agent-status-types'
import type { TuiAgent } from './tui-agent'

export const RESUMABLE_TUI_AGENTS = [
  'claude',
  'codex',
  'gemini',
  'antigravity',
  'opencode',
  'pi',
  'mimo-code',
  'droid',
  'grok',
  'devin',
  'omp',
  'prime-agent',
  'copilot',
  'kimi'
] as const satisfies readonly TuiAgent[]

export type ResumableTuiAgent = (typeof RESUMABLE_TUI_AGENTS)[number]

export type AgentProviderSessionKey = 'session_id' | 'conversation_id'

export type AgentProviderSessionMetadata = {
  key: AgentProviderSessionKey
  id: string
  /** Authoritative on-disk transcript/rollout path reported by the agent's hook
   *  (Claude/Codex `transcript_path`), when available. Native chat reads this
   *  directly because recent Claude Code versions name the transcript file with a
   *  UUID that differs from the hook `session_id`, so reconstructing the path from
   *  `id` alone fails. Claude/Codex still resume by id; Pi uses its reported
   *  `session_file` as the authoritative `--session` resume locator. */
  transcriptPath?: string
}

export type SleepingAgentLaunchConfig = {
  agentCommand?: string
  agentArgs: string
  agentEnv: Record<string, string>
  ompResumeFilePath?: string
}

export type SleepingAgentSessionRecord = {
  paneKey: string
  tabId?: string
  worktreeId: string
  agent: ResumableTuiAgent
  providerSession: AgentProviderSessionMetadata
  prompt: string
  state: AgentStatusState
  capturedAt: number
  updatedAt: number
  terminalTitle?: string
  lastAssistantMessage?: string
  interrupted?: boolean
  connectionId?: string | null
  launchConfig?: SleepingAgentLaunchConfig
  /** How the record was captured. Worktree-sleep records (legacy records have
   *  no origin) are consumed by worktree activation, which opens a fresh tab.
   *  Quit/live records describe panes that still exist in the restored session,
   *  so only the pane's own cold-restore path may consume them — activation
   *  launching a tab too would duplicate a warm-reattached session (#5232). */
  origin?: 'worktree-sleep' | 'quit' | 'live'
  /** Prevents provider-session relaunch while main reconciles a durable
   *  orchestration assignment against authoritative PTY inventory. */
  automaticResumeBlockedBy?: 'legacy-orchestration-worker'
  /** Set on a finished pane captured by an explicit workspace sleep. Its
   *  `--resume` is issued by the pane's own cold restore when its tab is
   *  opened, so a mobile wake must not background-mount every such tab and
   *  respawn the whole workspace the user just slept (#11598). */
  restoreOnTabOpenOnly?: boolean
}
