// Persisted-renderer contract extraction — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3, src/shared/ui-chrome-types.ts
// (SHA256 adecbc929dc5d57f38d8b5feda69d67e52fec3124f3b18e0d48798b24f6fa478),
// declarations: TaskViewPresetId, WorktreeCardProperty, AgentActivityDisplayMode,
// StatusBarItem, TaskResumeState, RightSidebarTab, RightSidebarExplorerView,
// ProjectOrderBy, WorkspaceHostScope, VisibleWorkspaceHostIds,
// WorkspaceHostOrder, ManualRepoOrderEntry, TopLevelView and the re-exported
// ActivityGroupBy/ThreadReadFilter pair. Type-only extraction; the other UI
// chrome types in that file stay in the pinned source.

import type { LinearConcreteWorkspaceId } from './linear-workspace-types'
import type { LinearCustomViewModel } from './linear-project-types'
import type { ActivityGroupBy, ThreadReadFilter } from './agents-view-thread-filters'

export type { ActivityGroupBy, ThreadReadFilter }

export type TaskViewPresetId = 'all' | 'issues' | 'review' | 'my-issues' | 'my-prs' | 'prs'

export type WorktreeCardProperty =
  | 'status'
  | 'unread'
  // Legacy persisted preference. CI status is now represented by linked PR metadata.
  | 'ci'
  // Migration-only: legacy detailed cards showed branch identity as a visible row.
  | 'branch'
  // Task metadata on workspace cards; provider-specific persisted values kept for older profiles.
  | 'issue'
  | 'linear-issue'
  | 'jira-issue'
  | 'pr'
  | 'automation'
  // Badge marking workspaces created through `orca worktree create`.
  | 'cli'
  | 'comment'
  | 'ports'
  // Inline agent-activity list rendered in each workspace card; on by default (see DEFAULT_WORKTREE_CARD_PROPERTIES in shared/constants.ts).
  | 'inline-agents'

export type WorktreeCardMode = 'Default' | 'Compact'

export type AgentActivityDisplayMode = 'compact' | 'full'

export type StatusBarItem =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'antigravity'
  | 'opencode-go'
  | 'kimi'
  | 'minimax'
  | 'grok'
  | 'ssh'
  | 'resource-usage'
  | 'ports'
export type TaskResumeState = {
  githubMode?: 'items' | 'project'
  githubItemsPreset?: TaskViewPresetId | null
  githubItemsQuery?: string
  githubProjectHiddenFieldIdsByView?: Record<string, string[]>
  linearMode?: 'issues' | 'projects' | 'views' | 'in-orca'
  linearPreset?: 'assigned' | 'created' | 'all' | 'completed'
  linearQuery?: string
  linearContext?: {
    kind: 'project' | 'view'
    id: string
    workspaceId: LinearConcreteWorkspaceId
    model?: LinearCustomViewModel
  }
  jiraPreset?: 'assigned' | 'reported' | 'all' | 'done'
  jiraQuery?: string
}

export type RightSidebarTab =
  | 'explorer'
  | 'search'
  | 'mentu'
  | 'vault'
  | 'workspaces'
  | 'pr-checks'
  | 'source-control'
  | 'checks'
  | 'ports'
  // Plugin-contributed panels are keyed `plugin:<pluginId>/<panelId>` so the
  // static union stays closed while plugin tabs remain type-representable.
  | `plugin:${string}`
export type RightSidebarExplorerView = 'files' | 'search'

export type ProjectOrderBy = 'manual' | 'recent'
export type WorkspaceHostScope = 'all' | 'local' | `ssh:${string}` | `runtime:${string}`
export type VisibleWorkspaceHostIds = Exclude<WorkspaceHostScope, 'all'>[] | null
export type WorkspaceHostOrder = Exclude<WorkspaceHostScope, 'all'>[]
export type ManualRepoOrderEntry = {
  hostId: WorkspaceHostOrder[number]
  repoId: string
}

/** The active top-level section shown in the main content area. */
export type TopLevelView =
  | 'terminal'
  | 'bots'
  | 'meetings'
  | 'settings'
  | 'tasks'
  | 'activity'
  | 'automations'
  | 'space'
  | 'skills'
  | 'artifacts'
  | 'mobile'
