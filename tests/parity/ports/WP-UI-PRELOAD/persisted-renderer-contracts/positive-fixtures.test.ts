// Compile-time positive fixtures — Lovecast Inc. MIT source
// c97906287bb7a390b25e2025b600d9fb3c25d9c3. These prove the complete
// persisted-renderer contract closure accepts representative full
// source-faithful snapshots and UI patches — local, SSH and runtime hosts,
// folder workspaces, dirty editor contents with disk signatures, browser
// ownership with deferred close intents, terminal authority
// (incarnations/topology/tombstones/resume provenance) and Mentu state — and
// that the host-qualified staging envelope binds the accepted generic
// checkpoint factory WITHOUT payload filtering.
//
// This is type-compatibility evidence only: it does NOT prove runtime
// admission (zod schemas), serialization, or durable round-trip persistence.
// Those remain open root gates.

import { describe, expect, it, vi } from "vitest";
import { createShutdownCheckpointPersist } from "../../../../../apps/desktop/src/renderer/src/app-shell/shutdown-checkpoint-persist";
import type {
  WorkspaceSessionState,
} from "../../../../../apps/desktop/src/shared/persistence-contracts/workspace-session-state-types";
import type {
  WorkspaceSessionHostSnapshot,
} from "../../../../../apps/desktop/src/shared/persistence-contracts/workspace-session-host-persistence";
import type {
  PersistedUIState,
} from "../../../../../apps/desktop/src/shared/persistence-contracts/persisted-ui-state-types";
import type {
  HostQualifiedCheckpointStageArgs,
  BoundCheckpointPersistDeps,
} from "../../../../../apps/desktop/src/shared/persistence-contracts/checkpoint-staging-envelope";
import type { ExecutionHostId } from "../../../../../apps/desktop/src/shared/persistence-contracts/execution-host";

/** A full source-faithful WorkspaceSessionState: every field of the pinned
 *  contract is populated, including legacy fields. */
function buildFullWorkspaceSessionState(): WorkspaceSessionState {
  return {
    activeRepoId: "repo-1",
    activeWorkspaceKey: "folder:fw-1",
    activeWorkspaceExecutionHostId: "runtime:env-7",
    activeWorktreeId: "repo-1::/src",
    activeTabId: "tab-1",
    tabsByWorktree: {
      "repo-1::/src": [
        {
          id: "tab-1",
          ptyId: "pty-1",
          worktreeId: "repo-1::/src",
          title: "Terminal 1",
          generatedTitle: null,
          aiVaultTitle: null,
          quickCommandLabel: null,
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1_700_000_000_000,
          isPinned: false,
          viewMode: "terminal",
          launchAgent: "codex",
        },
      ],
      "folder:fw-1": [],
    },
    terminalLayoutsByTabId: {
      "tab-1": {
        root: { type: "leaf", leafId: "leaf-1" },
        activeLeafId: "leaf-1",
        expandedLeafId: null,
        ptyIdsByLeafId: { "leaf-1": "pty-1" },
        buffersByLeafId: { "leaf-1": "scrollback-bytes" },
        scrollbackRefsByLeafId: {},
        titlesByLeafId: { "leaf-1": "main" },
      },
    },
    activeWorktreeIdsOnShutdown: ["repo-1::/src"],
    openFilesByWorktree: {
      "repo-1::/src": [
        {
          filePath: "/src/main.rs",
          relativePath: "src/main.rs",
          worktreeId: "repo-1::/src",
          language: "rust",
          isPreview: false,
          runtimeEnvironmentId: "env-7",
          externalSshTargetId: "ssh-target-42",
          dirtyDraftContent: "unsaved editor buffer for hot exit",
          lastKnownDiskSignature: "sha256:disk-signature",
          readOnly: true,
          liveTail: false,
        },
      ],
    },
    activeFileIdByWorktree: { "repo-1::/src": "/src/main.rs" },
    markdownFrontmatterVisible: { "/src/main.rs": true },
    browserTabsByWorktree: {
      "repo-1::/src": [
        {
          id: "browser-ws-1",
          worktreeId: "repo-1::/src",
          label: "Browser 1",
          sessionProfileId: "profile-1",
          sessionPartition: "persist:profile-1",
          activePageId: "page-1",
          pageIds: ["page-1"],
          url: "https://example.com/",
          title: "Example",
          loading: false,
          faviconUrl: null,
          canGoBack: false,
          canGoForward: true,
          loadError: null,
          createdAt: 1_700_000_000_000,
          docLocation: null,
        },
      ],
    },
    browserPagesByWorkspace: {
      "browser-ws-1": [
        {
          id: "page-1",
          workspaceId: "browser-ws-1",
          worktreeId: "repo-1::/src",
          url: "https://example.com/",
          title: "Example",
          loading: false,
          faviconUrl: null,
          canGoBack: false,
          canGoForward: true,
          loadError: null,
          createdAt: 1_700_000_000_000,
          browserRuntimeEnvironmentId: "env-7",
          remoteBrowserPageId: "runtime-page-1",
          remoteBrowserPageClientHosted: false,
          viewportPresetId: "desktop",
          docLocation: null,
          convertedFrom: null,
          convertedTo: null,
        },
      ],
    },
    activeBrowserTabIdByWorktree: { "repo-1::/src": "browser-ws-1" },
    clientHostedBrowserPagesByWorktree: {
      "repo-1::/src": [
        {
          v: 1,
          browserPageId: "cpage-1",
          workspaceId: "browser-ws-1",
          browserProfileId: "profile-1",
          url: "https://runtime.example/",
          title: "Runtime page",
          pairedDeviceId: "device-1",
          savedAt: 1_700_000_010_000,
        },
      ],
    },
    clientHostedBrowserCloseIntentsByEnvironment: {
      "env-7": [
        { browserPageId: "cpage-2", worktreeId: "repo-1::/src", closedAt: 1_700_000_020_000 },
      ],
    },
    activeTabTypeByWorktree: { "repo-1::/src": "terminal" },
    browserUrlHistory: [
      {
        url: "https://example.com/",
        normalizedUrl: "https://example.com/",
        title: "Example",
        faviconUrl: null,
        lastVisitedAt: 1_700_000_000_000,
        visitCount: 2,
      },
    ],
    workspaceDocHistory: [
      {
        docLocation: { kind: "workspace-doc", worktreeId: "repo-1::/src", filePath: "/src/README.md" },
        title: "README",
        lastVisitedAt: 1_700_000_030_000,
        visitCount: 1,
      },
    ],
    activeTabIdByWorktree: { "repo-1::/src": "tab-1" },
    unifiedTabs: { "repo-1::/src": [] },
    tabGroups: {
      "repo-1::/src": [
        {
          id: "group-1",
          worktreeId: "repo-1::/src",
          activeTabId: "tab-1",
          tabOrder: ["tab-1"],
          recentTabIds: ["tab-1"],
        },
      ],
    },
    tabGroupLayouts: {
      "repo-1::/src": {
        type: "split",
        direction: "horizontal",
        first: { type: "leaf", groupId: "group-1" },
        second: { type: "leaf", groupId: "group-2" },
        ratio: 0.5,
      },
    },
    activeGroupIdByWorktree: { "repo-1::/src": "group-1" },
    activeConnectionIdsAtShutdown: ["ssh-target-42"],
    remoteSessionIdsByTabId: { "tab-remote-1": "relay-pty-1" },
    lastVisitedAtByWorktreeId: { "local|repo-1::/src": 1_700_000_040_000 },
    defaultTerminalTabsAppliedByWorktreeId: { "repo-1::/src": true },
    sleepingAgentSessionsByPaneKey: {
      "pane-1": {
        paneKey: "pane-1",
        tabId: "tab-1",
        worktreeId: "repo-1::/src",
        agent: "codex",
        providerSession: {
          key: "session_id",
          id: "codex-session-1",
          transcriptPath: "/tmp/codex-session-1.jsonl",
        },
        prompt: "continue the migration",
        state: "working",
        capturedAt: 1_700_000_045_000,
        updatedAt: 1_700_000_046_000,
        terminalTitle: "codex",
        lastAssistantMessage: "working on it",
        interrupted: false,
        connectionId: "ssh-target-42",
        launchConfig: {
          agentCommand: "codex",
          agentArgs: "--resume",
          agentEnv: { CODEX_HOME: "/home/x" },
          ompResumeFilePath: undefined,
        },
        origin: "worktree-sleep",
        automaticResumeBlockedBy: "legacy-orchestration-worker",
        restoreOnTabOpenOnly: false,
      },
    },
    terminalPtyIncarnationsByPaneKey: { "pane-1": "incarnation-1" },
    terminalTopologyRevisionByRepoId: { "repo-1": 7 },
    terminalSurfaceTombstonesByPaneKey: {
      "pane-legacy-1": {
        worktreeId: "repo-1::/src",
        parentTabId: "tab-legacy",
        leafId: "leaf-legacy",
        ptyId: "pty-legacy",
        incarnationId: "incarnation-legacy",
        retiredAt: 1_699_000_000_000,
      },
    },
    closedTerminalTabTombstonesByTabId: {
      "tab-closed-1": {
        closedAt: 1_699_500_000_000,
        worktreeId: "repo-1::/src",
        ackRevision: 5,
      },
    },
  };
}

/** Full source-faithful UI patch: required fields plus the host, Mentu,
 *  browser and navigation state the pinned contract persists. */
function buildFullUiPatch(): Partial<PersistedUIState> {
  return {
    lastActiveRepoId: "repo-1",
    lastActiveWorktreeId: "repo-1::/src",
    activeView: "terminal",
    sidebarWidth: 280,
    rightSidebarOpen: true,
    rightSidebarTab: "mentu",
    rightSidebarExplorerView: "files",
    rightSidebarWidth: 320,
    groupBy: "workspace-status",
    sortBy: "smart",
    projectOrderBy: "manual",
    showActiveOnly: false,
    workspaceHostScope: "runtime:env-7",
    visibleWorkspaceHostIds: ["local", "ssh:ssh-target-42", "runtime:env-7"],
    workspaceHostOrder: ["local", "runtime:env-7"],
    automationHostFilter: { kind: "host", hostKey: "runtime:env-7" },
    manualRepoOrder: [{ hostId: "local", repoId: "repo-1" }],
    hideDefaultBranchWorkspace: false,
    filterRepoIds: [],
    collapsedGroups: [],
    uiZoomLevel: 1,
    editorFontZoomLevel: 1,
    worktreeCardProperties: ["status", "issue", "ports"],
    agentActivityDisplayMode: "full",
    workspaceStatuses: [{ id: "in-progress", label: "In progress", color: "#7aa2f7" }],
    statusBarItems: ["claude", "ports"],
    statusBarVisible: true,
    usagePercentageDisplay: "used",
    statusBarUsageMode: "compact",
    dismissedUpdateVersion: null,
    lastUpdateCheckAt: null,
    releaseChannelOverride: null,
    acknowledgedAgentsByPaneKey: { "pane-1": 1_700_000_000_000 },
    activityClearedAtByPaneKey: {},
    manuallyUnreadTurnsByPaneKey: {},
    mentuSessionStatesByKey: {
      "mentu:runtime%3Aenv-7:folder%3Afw-1:mentu-session-1": {
        selectedPath: "/recipes/check.md",
        mode: "run",
        draftSourceByPath: { "/recipes/check.md": "unsaved mentu source" },
        lastRunId: "run-1",
      },
    },
    browserDefaultUrl: null,
    browserDefaultSearchEngine: "kagi",
    browserKagiSessionLink: "https://kagi.com/session",
    windowBounds: { x: 0, y: 0, width: 1440, height: 900 },
    windowMaximized: false,
    starNagNextThreshold: 35,
    taskResumeState: { githubMode: "items", linearPreset: "assigned" },
    workspaceCleanup: {
      dismissals: {
        "repo-1::/src": {
          worktreeId: "repo-1::/src",
          dismissedAt: 1_700_000_000_000,
          fingerprint: "fp-1",
          classifierVersion: 3,
          executionHostId: "runtime:env-7",
        },
      },
      browse: {
        version: 1,
        filters: {
          query: "",
          activity: { idleSignal: "last-visited", idleMinDays: null, neverVisited: false },
          size: { minBytes: null, maxBytes: null, includeUnsized: true },
          status: { workspaceStatuses: [], matchStatusless: true, archived: "any", pinned: "any", unread: "any", comment: "any" },
          agent: { states: ["working"], retainedDoneAgents: "any" },
          git: { states: ["dirty"], minAhead: null, minBehind: null, branchQuery: "", prunable: "any", locked: "any" },
          review: { presence: "any", states: ["open"], providers: ["github"] },
          ticket: { presence: "any", sources: ["linear"] },
          context: { presence: "any", completelyEmpty: false },
          location: { hostIds: ["local"], repoIds: [], pathPrefix: "" },
          safety: { blockers: ["dirty-editor-buffer"], blockerMode: "any-of", dismissed: "any" },
        },
        sort: { field: "last-activity", direction: "desc" },
      },
    },
    featureTipsSeenIds: ["voice-dictation"],
    featureInteractions: { "cmd-j": { firstInteractedAt: 1_700_000_000_000, interactionCount: 3 } },
    contextualToursSeenIds: ["workspace-board"],
    contextualToursAutoEligible: true,
  };
}

/** Host-qualified snapshots: the same faithful state staged from three
 *  distinct execution hosts. */
const localSnapshot: WorkspaceSessionHostSnapshot = {
  state: buildFullWorkspaceSessionState(),
  hostId: "local",
};
const sshSnapshot: WorkspaceSessionHostSnapshot = {
  state: buildFullWorkspaceSessionState(),
  hostId: "ssh:ssh-target-42",
};
const runtimeSnapshot: WorkspaceSessionHostSnapshot = {
  state: buildFullWorkspaceSessionState(),
  hostId: "runtime:env-7",
};

/** Compile-time proof the host ids satisfy the pinned template-literal
 *  identity union (a malformed identity would fail the negative fixture). */
const hostProvenance: Record<string, ExecutionHostId> = {
  local: localSnapshot.hostId as ExecutionHostId,
  ssh: sshSnapshot.hostId as ExecutionHostId,
  runtime: runtimeSnapshot.hostId as ExecutionHostId,
};
void hostProvenance;

describe("persisted renderer contract envelope", () => {
  it("binds the accepted generic checkpoint factory to the complete envelope without filtering", () => {
    const stageBeforeUnloadSync = vi.fn((args: HostQualifiedCheckpointStageArgs) => {
      void args;
    });
    // Root contract: the deps bind through the envelope's direct instantiation
    // of the accepted generic dependency contract — no hand-copied field list.
    const deps: BoundCheckpointPersistDeps = {
      shouldCaptureSession: () => true,
      captureTerminalBuffers: vi.fn(),
      captureSleepingAgentSessions: vi.fn(),
      buildSessionSnapshots: () => [localSnapshot, sshSnapshot, runtimeSnapshot],
      buildUiPatch: buildFullUiPatch,
      hasDirtyOpenFiles: () => false,
      isDegradableShutdownInProgress: () => true,
      stageBeforeUnloadSync,
      recordCrashBreadcrumb: vi.fn(),
    };

    createShutdownCheckpointPersist(deps).run();

    // Exact pass-through, no payload filtering: the full snapshots and UI
    // patch reach staging unchanged, each with its owning execution host.
    expect(stageBeforeUnloadSync).toHaveBeenCalledTimes(1);
    const staged = stageBeforeUnloadSync.mock.calls[0]?.[0];
    expect(staged?.sessions).toEqual([localSnapshot, sshSnapshot, runtimeSnapshot]);
    expect(staged?.sessions[1]?.hostId).toBe("ssh:ssh-target-42");
    expect(staged?.sessions[2]?.hostId).toBe("runtime:env-7");
    expect(staged?.ui.mentuSessionStatesByKey?.[
      "mentu:runtime%3Aenv-7:folder%3Afw-1:mentu-session-1"
    ]?.draftSourceByPath).toEqual({ "/recipes/check.md": "unsaved mentu source" });
    expect(staged?.ui.workspaceHostScope).toBe("runtime:env-7");
  });
});
