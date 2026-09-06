// Negative compile-time fixtures — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3. Every expectation below must
// FAIL to compile; the @ts-expect-error directives make the owned tsconfig
// typecheck pass only when the contract rejects each malformed value. If a
// directive ever goes unused, tsc reports "Unused '@ts-expect-error' directive"
// and the gate fails — so these assertions cannot silently stop asserting.

import type { ExecutionHostId } from "../../../../../apps/desktop/src/shared/persistence-contracts/execution-host";
import type { WorkspaceKey } from "../../../../../apps/desktop/src/shared/persistence-contracts/folder-workspace-types";
import type { AgentStatusState } from "../../../../../apps/desktop/src/shared/persistence-contracts/agent-status-types";
import type { SleepingAgentSessionRecord } from "../../../../../apps/desktop/src/shared/persistence-contracts/agent-session-resume";
import type { TabContentType, WorkspaceVisibleTabType } from "../../../../../apps/desktop/src/shared/persistence-contracts/tab-types";
import type { TerminalTab } from "../../../../../apps/desktop/src/shared/persistence-contracts/terminal-tab-types";
import type { PersistedOpenFile, WorkspaceSessionState } from "../../../../../apps/desktop/src/shared/persistence-contracts/workspace-session-state-types";
import type { ClientHostedBrowserCloseIntent } from "../../../../../apps/desktop/src/shared/persistence-contracts/client-hosted-browser-close-intent";
import type { PersistedClientHostedBrowserPage } from "../../../../../apps/desktop/src/shared/persistence-contracts/client-hosted-browser-page-record";
import type { PersistedAutomationHostFilter } from "../../../../../apps/desktop/src/shared/persistence-contracts/automation-host-filter";
import type { WorkspaceSessionHostSnapshot } from "../../../../../apps/desktop/src/shared/persistence-contracts/workspace-session-host-persistence";
import type { MentuSessionPersistedState } from "../../../../../apps/desktop/src/shared/persistence-contracts/mentu-session-state-types";
import type { WorkspaceCleanupUIState } from "../../../../../apps/desktop/src/shared/persistence-contracts/workspace-cleanup";

// Malformed execution-host identity: the pinned union admits only the local
// literal and `ssh:`/`runtime:` template prefixes.
// @ts-expect-error — unknown host scheme must not satisfy ExecutionHostId.
const malformedHostId: ExecutionHostId = "ftp:host-1";

// Malformed workspace key: the pinned union admits only `worktree:`/`folder:`
// template prefixes.
// @ts-expect-error — unknown key scheme must not satisfy WorkspaceKey.
const malformedWorkspaceKey: WorkspaceKey = "repo:repo-1";

// Discriminated identity: the host-qualified snapshot's hostId cannot carry an
// unknown scheme.
const malformedSnapshot: WorkspaceSessionHostSnapshot = {
  state: {
    activeRepoId: null,
    activeWorktreeId: null,
    activeTabId: null,
    tabsByWorktree: {},
    terminalLayoutsByTabId: {},
  },
  // @ts-expect-error — snapshot hostId rejects the malformed host scheme.
  hostId: "container:abc",
};

// Discriminated union: the automation host filter admits only all/host kinds.
// @ts-expect-error — unknown discriminator must not satisfy the filter union.
const malformedAutomationFilter: PersistedAutomationHostFilter = { kind: "bogus" };

// Discriminated union: the Mentu pane mode union is closed.
const malformedMentuState: MentuSessionPersistedState = {
  selectedPath: null,
  // @ts-expect-error — unknown Mentu pane mode must be rejected.
  mode: "plotter",
  draftSourceByPath: {},
};

// Discriminated union: the sleeping-agent resume-block discriminator admits
// only the pinned legacy-orchestration-worker reason.
const malformedSleepingRecord: SleepingAgentSessionRecord = {
  paneKey: "pane-1",
  worktreeId: "repo-1::/src",
  agent: "codex",
  providerSession: { key: "session_id", id: "codex-session-1" },
  prompt: "continue",
  state: "working",
  capturedAt: 0,
  updatedAt: 0,
  // @ts-expect-error — unknown resume-block reason must be rejected.
  automaticResumeBlockedBy: "unrelated-reason",
};

// Required snapshot fields cannot be omitted.
// @ts-expect-error — missing activeTabId violates the session state contract.
const missingRequiredSnapshotFields: WorkspaceSessionState = {
  activeRepoId: null,
  activeWorktreeId: null,
  tabsByWorktree: {},
};

// Terminal tabs require customTitle/color/sortOrder/createdAt (the pinned
// TerminalTab carries no execution-host field at all).
// @ts-expect-error — missing required terminal tab fields.
const malformedTerminalTab: TerminalTab = {
  id: "tab-1",
  ptyId: null,
  worktreeId: "repo-1::/src",
  title: "t",
};

// Dirty editor drafts are strings and disk signatures are strings; numbers are
// rejected so downstream signature comparison cannot silently degrade.
const malformedOpenFile: PersistedOpenFile = {
  filePath: "/src/main.rs",
  relativePath: "src/main.rs",
  worktreeId: "repo-1::/src",
  language: "rust",
  // @ts-expect-error — dirty draft content must be a string.
  dirtyDraftContent: 42,
  // @ts-expect-error — the disk signature must be a string.
  lastKnownDiskSignature: 7,
};

// Client-hosted close intents require closedAt.
// @ts-expect-error — missing closedAt violates the close-intent contract.
const malformedCloseIntent: ClientHostedBrowserCloseIntent = {
  browserPageId: "cpage-1",
  worktreeId: "repo-1::/src",
};

// The client-hosted page record pins the row version to the exported literal.
const malformedPageRecordVersion: PersistedClientHostedBrowserPage = {
  // @ts-expect-error — row version is pinned to the exported literal 1.
  v: 2,
  browserPageId: "cpage-1",
  workspaceId: "ws-1",
  browserProfileId: "profile-1",
  url: "https://example.com/",
  title: "Example",
  pairedDeviceId: "device-1",
  savedAt: 0,
};

// Agent status and visible tab type unions are closed.
// @ts-expect-error — unknown agent status must be rejected.
const malformedAgentStatus: AgentStatusState = "napping";
// @ts-expect-error — unknown visible tab type must be rejected.
const malformedVisibleTabType: WorkspaceVisibleTabType = "diff";
// @ts-expect-error — unknown tab content type must be rejected.
const malformedTabContentType: TabContentType = "browser2";

// Cleanup UI state requires the dismissals map.
// @ts-expect-error — missing required dismissals map.
const malformedCleanupUi: WorkspaceCleanupUIState = {
  browse: undefined,
};

void [
  malformedHostId,
  malformedWorkspaceKey,
  malformedSnapshot,
  malformedAutomationFilter,
  malformedMentuState,
  missingRequiredSnapshotFields,
  malformedTerminalTab,
  malformedOpenFile,
  malformedCloseIntent,
  malformedPageRecordVersion,
  malformedAgentStatus,
  malformedVisibleTabType,
  malformedTabContentType,
  malformedCleanupUi,
];
