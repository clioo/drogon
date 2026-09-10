/* MIT Copyright (c) 2026 Lovecast Inc.
   Inert Linear surface for off-app renders (tests): disconnected, empty,
   no-op callbacks. Mirrors jira-surface-defaults for the Linear fields. */
import type { TaskPageLinearModelFields } from "../task-page-model";

export function linearSurfaceModelDefaults(): TaskPageLinearModelFields {
  return {
    linearConnected: false,
    linearConnectOpen: false,
    setLinearConnectOpen: () => {},
    refreshLinearStatus: () => {},
    linearIssues: [],
    linearLoading: false,
    linearError: null,
    linearSearchInput: "",
    setLinearSearchInput: () => {},
    handleRefreshLinearIssues: () => {},
    linearLinks: [],
    linearWorktrees: [],
    linearBusyKey: null,
    handleStartLinearItem: () => {},
    handleLinkLinearItem: () => {},
    handleUnlinkLinearItem: () => {},
    onOpenLinearWorktree: () => {},
    openLinearIssueUrl: () => {},
    writeLinearClipboardText: () => {},
  };
}
