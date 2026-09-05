# Bridge/RPC contract enumeration: renderer/service census

Planning-only, source-AST enumeration closing the "known omission" flagged in `parity-platform-audit.md` §8/§10 (partial ~70 domains / ~150 channels), corrected after coordinator review for recursive RPC method-array resolution, main-side ipcMain registrations, index.ts-assembly-derived domain identity, output-guard hardening, and syntax-occurrence vs. reachable-method accounting. No implementation performed, no daemons/apps started, no Git mutation.

- **Source:** `/Users/carlos/Documents/Drogon-mentu-session` at `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (frozen; tracked dirty: false).
- **Provenance:** source-only Babel AST enumeration; no eval, no import of source app/config, no test execution.

## Denominator counts (exact, not estimated)

- `bridgeFiles`: **83**
- `apiTypeFiles`: **53**
- `domainsAssembledInIndex`: **87**
- `domainsInPreloadApiType`: **87**
- `domainSourceMismatches`: **0**
- `preloadChannelsDistinct`: **947**
- `reachableBridgeMethodsDeduped`: **953**
- `allBridgeExportMethodsDeduped`: **953**
- `bridgeExportedObjectsTotal`: **79**
- `bridgeExportedObjectsOrphan`: **0**
- `syntaxIpcCallOccurrences`: **1132**
- `ipcInvokeCalls`: **714**
- `ipcSendCalls`: **51**
- `ipcSendSyncCalls`: **4**
- `ipcOnSubscriptions`: **181**
- `subscriptionsWithConfirmedDisposerPairing`: **180**
- `subscriptionsWithUnresolvedDisposerPairing`: **1**
- `unresolvedDynamicChannelRefs`: **1**
- `unresolvedComputedMethodKeys`: **0**
- `delegatedUnresolvedMethods`: **11**
- `rpcMethodGroups`: **48**
- `rpcMethodGroupsWithZeroMethods`: **0**
- `rpcMethodOccurrencesDeduped`: **615**
- `rpcMethodNamesResolvedUnique`: **615**
- `rpcMethodPlaceholderEntries`: **0**
- `rpcMethodDuplicateNames`: **0**
- `mainFilesTotal`: **4579**
- `mainFilesScanned`: **4579**
- `mainRegistrationsTotal`: **1135**
- `mainTeardownRegistrations`: **257**
- `requestChannelsTotal`: **712**
- `requestChannelsMatchedToHandler`: **658**
- `requestChannelsUnresolvedAgainstHandler`: **54**
- `fireAndForgetChannelsTotal`: **55**
- `fireAndForgetChannelsMatchedToListener`: **43**
- `fireAndForgetChannelsUnresolvedAgainstListener`: **12**
- `pushEventChannelsTotal`: **180**
- `pushEventChannelsMatchedToProducer`: **84**
- `pushEventChannelsUnresolvedAgainstProducer`: **96**
- `filesHashed`: **4734**

## Named-domain explicit checks (never "deprecated by omission")

| Domain | In index.ts assembly | In PreloadApi type | Reachable bridge exports | Inline-only channels | Total assembled channels |
|---|---|---|---|---|---|
| `mentu` | ✅ | ✅ | 1 | 0 | 14 |
| `bots` | ✅ | ✅ | 1 | 0 | 7 |
| `meetings` | ✅ | ✅ | 1 | 0 | 3 |
| `telemetry (flattened top-level: telemetryTrack/telemetrySetOptIn/telemetryGetConsentState/telemetryAcknowledgeBanner)` | ✅ | ✅ | 0 | 4 | 4 |

## Domain cross-check (index.ts assembly vs. PreloadApi type)

- In assembly only: (none)
- In PreloadApi type only: (none)
- Assembly-vs-satisfies domain mismatches: 0

## Bridge files enumerated

| File | Exported object(s) | Domain (source) | Methods | Reachable from index.ts assembly |
|---|---|---|---|---|
| `src/preload/api/agent-awake-bridge.ts:5` | `agentAwakeApi` | `agentAwake` (assembly-and-satisfies-agree) | 2 | ✅ |
| `src/preload/api/agent-status-bridge.ts:12` | `agentStatusApi` | `agentStatus` (assembly-and-satisfies-agree) | 17 | ✅ |
| `src/preload/api/agent-trust-bridge.ts:4` | `agentTrustApi` | `agentTrust` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/ai-vault-bridge.ts:15` | `aiVaultApi` | `aiVault` (assembly-and-satisfies-agree) | 8 | ✅ |
| `src/preload/api/app-bridge.ts:15` | `appApi` | `app` (assembly-and-satisfies-agree) | 22 | ✅ |
| `src/preload/api/automations-bridge.ts:20` | `automationsApi` | `automations` (assembly-and-satisfies-agree) | 12 | ✅ |
| `src/preload/api/bitbucket-bridge.ts:4` | `bitbucketApi` | `bitbucket` (assembly-and-satisfies-agree) | 3 | ✅ |
| `src/preload/api/bots-bridge.ts:4` | `botsApi` | `bots` (assembly-and-satisfies-agree) | 7 | ✅ |
| `src/preload/api/browser-bridge.ts:5` | `browserApi` | `browser` (assembly-and-satisfies-agree) | 49 | ✅ |
| `src/preload/api/cache-bridge.ts:4` | `cacheApi` | `cache` (assembly-and-satisfies-agree) | 2 | ✅ |
| `src/preload/api/claude-accounts-bridge.ts:4` | `claudeAccountsApi` | `claudeAccounts` (assembly-and-satisfies-agree) | 6 | ✅ |
| `src/preload/api/cli-bridge.ts:5` | `cliApi` | `cli` (assembly-and-satisfies-agree) | 6 | ✅ |
| `src/preload/api/codex-accounts-bridge.ts:4` | `codexAccountsApi` | `codexAccounts` (assembly-and-satisfies-agree) | 8 | ✅ |
| `src/preload/api/codex-config-sync-bridge.ts:5` | `codexConfigSyncApi` | `codexConfigSync` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/computer-use-permissions-bridge.ts:4` | `computerUsePermissionsApi` | `computerUsePermissions` (assembly-and-satisfies-agree) | 3 | ✅ |
| `src/preload/api/crash-reports-bridge.ts:16` | `crashReportsApi` | `crashReports` (assembly-and-satisfies-agree) | 9 | ✅ |
| `src/preload/api/dashboard-bridge.ts:10` | `dashboardApi` | `dashboard` (assembly-and-satisfies-agree) | 16 | ✅ |
| `src/preload/api/developer-permissions-bridge.ts:4` | `developerPermissionsApi` | `developerPermissions` (assembly-and-satisfies-agree) | 4 | ✅ |
| `src/preload/api/diagnostics-bridge.ts:4` | `diagnosticsApi` | `diagnostics` (assembly-and-satisfies-agree) | 6 | ✅ |
| `src/preload/api/doc-preview-bridge.ts:13` | `docPreviewApi` | `docPreview` (assembly-and-satisfies-agree) | 5 | ✅ |
| `src/preload/api/drogon-quick-session-bridge.ts:4` | `drogonQuickSessionApi` | `drogonQuickSession` (assembly-and-satisfies-agree) | 3 | ✅ |
| `src/preload/api/e2e-bridge.ts:4` | `e2eApi` | `e2e` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/emulator-bridge.ts:4` | `emulatorApi` | `emulator` (assembly-and-satisfies-agree) | 10 | ✅ |
| `src/preload/api/ephemeral-vm-bridge.ts:4` | `ephemeralVmApi` | `ephemeralVm` (assembly-and-satisfies-agree) | 13 | ✅ |
| `src/preload/api/export-bridge.ts:4` | `exportApi` | `export` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/feedback-bridge.ts:4` | `feedbackApi` | `feedback` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/folder-workspaces-bridge.ts:4` | `folderWorkspacesApi` | `folderWorkspaces` (assembly-and-satisfies-agree) | 5 | ✅ |
| `src/preload/api/fs-bridge.ts:13` | `fsApi` | `fs` (assembly-and-satisfies-agree) | 32 | ✅ |
| `src/preload/api/gh-bridge.ts:5` | `ghApi` | `gh` (assembly-and-satisfies-agree) | 59 | ✅ |
| `src/preload/api/git-bash-bridge.ts:4` | `gitBashApi` | `gitBash` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/git-bridge.ts:8` | `gitApi` | `git` (assembly-and-satisfies-agree) | 37 | ✅ |
| `src/preload/api/grok-accounts-bridge.ts:5` | `grokAccountsApi` | `grokAccounts` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/hooks-bridge.ts:6` | `hooksApi` | `hooks` (assembly-and-satisfies-agree) | 5 | ✅ |
| `src/preload/api/hosted-review-bridge.ts:5` | `hostedReviewApi` | `hostedReview` (assembly-and-satisfies-agree) | 4 | ✅ |
| `src/preload/api/jira-bridge.ts:5` | `jiraApi` | `jira` (assembly-and-satisfies-agree) | 24 | ✅ |
| `src/preload/api/keybindings-bridge.ts:5` | `keybindingsApi` | `keybindings` (assembly-and-satisfies-agree) | 7 | ✅ |
| `src/preload/api/linear-bridge.ts:5` | `linearApi` | `linear` (assembly-and-satisfies-agree) | 24 | ✅ |
| `src/preload/api/localhost-worktree-labels-bridge.ts:8` | `localhostWorktreeLabelsApi` | `localhostWorktreeLabels` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/macos-tcc-prompts-bridge.ts:4` | `macosTccPromptsApi` | `macosTccPrompts` (assembly-and-satisfies-agree) | 5 | ✅ |
| `src/preload/api/meetings-bridge.ts:4` | `meetingsApi` | `meetings` (assembly-and-satisfies-agree) | 3 | ✅ |
| `src/preload/api/memory-bridge.ts:5` | `memoryApi` | `memory` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/mentu-bridge.ts:4` | `mentuApi` | `mentu` (assembly-only (no satisfies annotation)) | 14 | ✅ |
| `src/preload/api/minimax-credentials-bridge.ts:4` | `minimaxCredentialsApi` | `minimaxCredentials` (assembly-and-satisfies-agree) | 3 | ✅ |
| `src/preload/api/mobile-bridge.ts:8` | `mobileApi` | `mobile` (assembly-and-satisfies-agree) | 15 | ✅ |
| `src/preload/api/native-chat-bridge.ts:10` | `nativeChatApi` | `nativeChat` (assembly-and-satisfies-agree) | 2 | ✅ |
| `src/preload/api/notebook-bridge.ts:4` | `notebookApi` | `notebook` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/notifications-bridge.ts:39` | `notificationsApi` | `notifications` (assembly-and-satisfies-agree) | 6 | ✅ |
| `src/preload/api/onboarding-bridge.ts:5` | `onboardingApi` | `onboarding` (assembly-and-satisfies-agree) | 2 | ✅ |
| `src/preload/api/orca-profiles-bridge.ts:4` | `orcaProfilesApi` | `orcaProfiles` (assembly-and-satisfies-agree) | 16 | ✅ |
| `src/preload/api/pet-bridge.ts:5` | `petApi` | `pet` (assembly-and-satisfies-agree) | 4 | ✅ |
| `src/preload/api/platform-bridge.ts:25` | `platformApi` | `platform` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/plugins-bridge.ts:16` | `pluginsApi` | `plugins` (assembly-and-satisfies-agree) | 21 | ✅ |
| `src/preload/api/preflight-bridge.ts:4` | `preflightApi` | `preflight` (assembly-and-satisfies-agree) | 5 | ✅ |
| `src/preload/api/project-groups-bridge.ts:5` | `projectGroupsApi` | `projectGroups` (assembly-and-satisfies-agree) | 9 | ✅ |
| `src/preload/api/projects-bridge.ts:4` | `projectsApi` | `projects` (assembly-and-satisfies-agree) | 7 | ✅ |
| `src/preload/api/pty-bridge.ts:5` | `ptyApi` | `pty` (assembly-and-satisfies-agree) | 49 | ✅ |
| `src/preload/api/pwsh-bridge.ts:4` | `pwshApi` | `pwsh` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/rate-limits-bridge.ts:9` | `rateLimitsApi` | `rateLimits` (assembly-and-satisfies-agree) | 11 | ✅ |
| `src/preload/api/remote-workspace-bridge.ts:5` | `remoteWorkspaceApi` | `remoteWorkspace` (assembly-and-satisfies-agree) | 6 | ✅ |
| `src/preload/api/repos-bridge.ts:10` | `reposApi` | `repos` (assembly-and-satisfies-agree) | 25 | ✅ |
| `src/preload/api/runtime-bridge.ts:14` | `runtimeApi` | `runtime` (assembly-and-satisfies-agree) | 17 | ✅ |
| `src/preload/api/runtime-environments-bridge.ts:14` | `runtimeEnvironmentsApi` | `runtimeEnvironments` (assembly-and-satisfies-agree) | 14 | ✅ |
| `src/preload/api/session-bridge.ts:4` | `sessionApi` | `session` (assembly-and-satisfies-agree) | 6 | ✅ |
| `src/preload/api/settings-bridge.ts:9` | `settingsApi` | `settings` (assembly-and-satisfies-agree) | 9 | ✅ |
| `src/preload/api/shell-bridge.ts:9` | `shellApi` | `shell` (assembly-and-satisfies-agree) | 13 | ✅ |
| `src/preload/api/skills-bridge.ts:42` | `skillsApi` | `skills` (assembly-and-satisfies-agree) | 32 | ✅ |
| `src/preload/api/sparse-presets-bridge.ts:4` | `sparsePresetsApi` | `sparsePresets` (assembly-and-satisfies-agree) | 4 | ✅ |
| `src/preload/api/speech-bridge.ts:11` | `speechApi` | `speech` (assembly-and-satisfies-agree) | 17 | ✅ |
| `src/preload/api/ssh-bridge.ts:23` | `sshApi` | `ssh` (assembly-and-satisfies-agree) | 27 | ✅ |
| `src/preload/api/star-nag-bridge.ts:4` | `starNagApi` | `starNag` (assembly-and-satisfies-agree) | 12 | ✅ |
| `src/preload/api/stats-bridge.ts:4` | `statsApi` | `stats` (assembly-and-satisfies-agree) | 1 | ✅ |
| `src/preload/api/terminal-preview-bridge.ts:8` | `terminalPreviewApi` | `terminalPreview` (assembly-and-satisfies-agree) | 6 | ✅ |
| `src/preload/api/ui-bridge.ts:7` | `uiApi` | `ui` (assembly-and-satisfies-agree) | 116 | ✅ |
| `src/preload/api/updater-bridge.ts:7` | `updaterApi` | `updater` (assembly-and-satisfies-agree) | 12 | ✅ |
| `src/preload/api/workspace-cleanup-bridge.ts:5` | `workspaceCleanupApi` | `workspaceCleanup` (assembly-and-satisfies-agree) | 8 | ✅ |
| `src/preload/api/workspace-ports-bridge.ts:5` | `workspacePortsApi` | `workspacePorts` (assembly-and-satisfies-agree) | 3 | ✅ |
| `src/preload/api/workspace-space-bridge.ts:5` | `workspaceSpaceApi` | `workspaceSpace` (assembly-and-satisfies-agree) | 4 | ✅ |
| `src/preload/api/worktrees-bridge.ts:13` | `worktreesApi` | `worktrees` (assembly-and-satisfies-agree) | 27 | ✅ |
| `src/preload/api/wsl-bridge.ts:4` | `wslApi` | `wsl` (assembly-and-satisfies-agree) | 2 | ✅ |

0 exported bridge object(s) are ORPHAN — never referenced by index.ts's `api` assembly (their own export is dead from index.ts's perspective, even where their content is also reachable via a spread into another, reachable export). `allBridgeExportMethodsDeduped` counts every export above; `reachableBridgeMethodsDeduped` counts only the ✅ rows.

## RPC method groups (src/main/runtime/rpc/methods/index.ts), recursively resolved

| Group local name | Module | Resolution | Method count |
|---|---|---|---|
| `STATUS_METHODS` | `src/main/runtime/rpc/methods/status.ts` | resolved | 1 |
| `AGENT_HOOK_METHODS` | `src/main/runtime/rpc/methods/agent-hooks.ts` | resolved | 1 |
| `AI_VAULT_METHODS` | `src/main/runtime/rpc/methods/ai-vault.ts` | resolved | 3 |
| `ARTIFACT_METHODS` | `src/main/runtime/rpc/methods/artifacts.ts` | resolved | 7 |
| `AUTOMATION_METHODS` | `src/main/runtime/rpc/methods/automations.ts` | resolved | 7 |
| `REPO_METHODS` | `src/main/runtime/rpc/methods/repo.ts` | resolved | 42 |
| `WORKTREE_METHODS` | `src/main/runtime/rpc/methods/worktree.ts` | resolved | 17 |
| `AGENT_SESSION_METHODS` | `src/main/runtime/rpc/methods/agent-session.ts` | resolved | 2 |
| `STRUCTURED_AGENT_SESSION_METHODS` | `src/main/runtime/rpc/methods/structured-agent-session.ts` | resolved | 16 |
| `TERMINAL_METHODS` | `src/main/runtime/rpc/methods/terminal.ts` | resolved | 34 |
| `TERMINAL_ORPHAN_METHODS` | `src/main/runtime/rpc/methods/terminal-orphan.ts` | resolved | 1 |
| `BROWSER_CORE_METHODS` | `src/main/runtime/rpc/methods/browser-core.ts` | resolved | 53 |
| `BROWSER_SCREENCAST_METHODS` | `src/main/runtime/rpc/methods/browser-screencast.ts` | resolved | 2 |
| `BROWSER_EXTRA_METHODS` | `src/main/runtime/rpc/methods/browser-extras.ts` | resolved | 28 |
| `BROWSER_CLIENT_HOST_METHODS` | `src/main/runtime/rpc/methods/browser-client-host.ts` | resolved | 3 |
| `BROWSER_CLIENT_FILE_CHANNEL_METHODS` | `src/main/runtime/rpc/methods/browser-client-file-channel.ts` | resolved | 3 |
| `BROWSER_NETWORK_TUNNEL_METHODS` | `src/main/runtime/rpc/methods/browser-network-tunnel.ts` | resolved | 1 |
| `ORCHESTRATION_METHODS` | `src/main/runtime/rpc/methods/orchestration.ts` | resolved | 39 |
| `NOTIFICATION_METHODS` | `src/main/runtime/rpc/methods/notifications.ts` | resolved | 3 |
| `STATS_METHODS` | `src/main/runtime/rpc/methods/stats.ts` | resolved | 1 |
| `DIAGNOSTICS_METHODS` | `src/main/runtime/rpc/methods/diagnostics.ts` | resolved | 1 |
| `ACCOUNT_METHODS` | `src/main/runtime/rpc/methods/accounts.ts` | resolved | 11 |
| `PREFLIGHT_METHODS` | `src/main/runtime/rpc/methods/preflight.ts` | resolved | 5 |
| `COMPUTER_METHODS` | `src/main/runtime/rpc/methods/computer.ts` | resolved | 15 |
| `SESSION_TAB_METHODS` | `src/main/runtime/rpc/methods/session-tabs.ts` | resolved | 15 |
| `NATIVE_CHAT_METHODS` | `src/main/runtime/rpc/methods/native-chat.ts` | resolved | 3 |
| `FILE_METHODS` | `src/main/runtime/rpc/methods/files.ts` | resolved | 30 |
| `GIT_METHODS` | `src/main/runtime/rpc/methods/git.ts` | resolved | 35 |
| `GITHUB_METHODS` | `src/main/runtime/rpc/methods/github.ts` | resolved | 50 |
| `GITLAB_METHODS` | `src/main/runtime/rpc/methods/gitlab.ts` | resolved | 21 |
| `HOSTED_REVIEW_METHODS` | `src/main/runtime/rpc/methods/hosted-review.ts` | resolved | 4 |
| `LINEAR_METHODS` | `src/main/runtime/rpc/methods/linear.ts` | resolved | 25 |
| `LINEAR_AGENT_ACCESS_METHODS` | `src/main/runtime/rpc/methods/linear-agent-access.ts` | resolved | 16 |
| `JIRA_METHODS` | `src/main/runtime/rpc/methods/jira.ts` | resolved | 24 |
| `SSH_METHODS` | `src/main/runtime/rpc/methods/ssh.ts` | resolved | 5 |
| `SPEECH_METHODS` | `src/main/runtime/rpc/methods/speech.ts` | resolved | 8 |
| `WORKSPACE_PORT_METHODS` | `src/main/runtime/rpc/methods/workspace-ports.ts` | resolved | 2 |
| `PLUGIN_METHODS` | `src/main/runtime/rpc/methods/plugins.ts` | resolved | 6 |
| `SKILL_METHODS` | `src/main/runtime/rpc/methods/skills.ts` | resolved | 15 |
| `CLIPBOARD_METHODS` | `src/main/runtime/rpc/methods/clipboard.ts` | resolved | 5 |
| `HOST_CAPABILITY_METHODS` | `src/main/runtime/rpc/methods/host-capabilities.ts` | resolved | 5 |
| `RUNTIME_CLIENT_CAPABILITY_METHODS` | `src/main/runtime/rpc/methods/runtime-client-capabilities.ts` | resolved | 1 |
| `CLIENT_EVENT_METHODS` | `src/main/runtime/rpc/methods/client-events.ts` | resolved | 2 |
| `CLIENT_UI_METHODS` | `src/main/runtime/rpc/methods/client-ui.ts` | resolved | 8 |
| `EMULATOR_METHODS` | `src/main/runtime/rpc/methods/emulator.ts` | resolved | 19 |
| `PAIRING_METHODS` | `src/main/runtime/rpc/methods/pairing.ts` | resolved | 2 |
| `UPDATER_METHODS` | `src/main/runtime/rpc/methods/updater.ts` | resolved | 4 |
| `MENTU_METHODS` | `src/main/runtime/rpc/methods/mentu.ts` | resolved | 14 |

RPC method census: 615 distinct RESOLVED literal names, 0 placeholder (unresolved) occurrence(s), 615 total occurrence identities (file+anchor+name deduped) — resolved-name count and occurrence count are DELIBERATELY different measures; see rpcMethodNamesResolved / rpcMethodPlaceholderEntries in the JSON artifact.

## Main-side census (read-only evidence; write ownership unchanged)

Scanned 4579/4579 `src/main/**/*.ts` files; found 1135 registration call sites (`ipcMain.handle/on/once/removeHandler/removeAllListeners` and `<expr>.webContents.send(...)`), of which 257 are teardown-only (`removeHandler`/`removeAllListeners`) and excluded from all matching below.

Matching is **direction-specific** — a preload `on`/`once` (push-event) channel is never matched against an `ipcMain.on` registration (the opposite direction: main RECEIVING from renderer), only against a `webContents.send` producer call site:

- `invoke` → `ipcMain.handle` (request-handler): 658/712 matched
- `send`/`sendSync` → `ipcMain.on`/`once` (fire-and-forget-listener): 43/55 matched
- `on`/`once` → `<expr>.webContents.send` (push-producer): 84/180 matched

### Request channels (invoke) vs. ipcMain.handle

| Preload channel | Status | Main registration(s) |
|---|---|---|
| `agentAwake:getStatus` | request-handler-matched | `src/main/ipc/settings.ts:75` (ipcMain.handle) |
| `agentStatus:getMigrationUnsupportedSnapshot` | request-handler-matched | `src/main/ipc/agent-hooks.ts:68` (ipcMain.handle) |
| `agentStatus:getSnapshot` | request-handler-matched | `src/main/ipc/agent-hooks.ts:48` (ipcMain.handle) |
| `agentStatus:inferInterrupt` | request-handler-matched | `src/main/ipc/agent-hooks.ts:56` (ipcMain.handle) |
| `agentStatus:inferQuestionAnswered` | request-handler-matched | `src/main/ipc/agent-hooks.ts:62` (ipcMain.handle) |
| `agentTrust:markTrusted` | request-handler-matched | `src/main/ipc/agent-trust.ts:21` (ipcMain.handle) |
| `aiVault:cancelListSessions` | request-handler-matched | `src/main/ipc/ai-vault.ts:305` (ipcMain.handle) |
| `aiVault:deleteSession` | request-handler-matched | `src/main/ipc/ai-vault-delete.ts:24` (ipcMain.handle) |
| `aiVault:getFirstUserPrompt` | request-handler-matched | `src/main/ipc/ai-vault.ts:319` (ipcMain.handle) |
| `aiVault:listSessions` | request-handler-matched | `src/main/ipc/ai-vault.ts:279` (ipcMain.handle) |
| `aiVault:listSubagentSessions` | request-handler-matched | `src/main/ipc/ai-vault.ts:314` (ipcMain.handle) |
| `aiVault:prepareSessionResume` | request-handler-matched | `src/main/ipc/ai-vault-resume.ts:20` (ipcMain.handle) |
| `aiVault:resolveSessionTitles` | request-handler-matched | `src/main/ipc/ai-vault.ts:300` (ipcMain.handle) |
| `app:awaitFirstWindowStartupServices` | request-handler-matched | `src/main/startup/main-process-ipc-bootstrap.ts:8` (ipcMain.handle) |
| `app:awaitGitEnvironmentStartupBarrier` | request-handler-matched | `src/main/startup/main-process-ipc-bootstrap.ts:18` (ipcMain.handle) |
| `app:getFeatureWallAssetBaseUrl` | request-handler-matched | `src/main/ipc/app.ts:251` (ipcMain.handle) |
| `app:getFloatingMarkdownDirectory` | request-handler-matched | `src/main/ipc/app.ts:321` (ipcMain.handle) |
| `app:getFloatingTerminalCwd` | request-handler-matched | `src/main/ipc/app.ts:317` (ipcMain.handle) |
| `app:getIdentity` | request-handler-matched | `src/main/ipc/app.ts:253` (ipcMain.handle) |
| `app:getKeyboardInputSourceId` | request-handler-matched | `src/main/ipc/app.ts:274` (ipcMain.handle) |
| `app:getKeyboardLayoutSnapshot` | request-handler-matched | `src/main/ipc/app.ts:289` (ipcMain.handle) |
| `app:getMacCapturedDigitRowChords` | request-handler-matched | `src/main/ipc/macos-symbolic-hotkeys-probe.ts:21` (ipcMain.handle) |
| `app:pickFloatingMarkdownDocument` | request-handler-matched | `src/main/ipc/app.ts:323` (ipcMain.handle) |
| `app:pickFloatingWorkspaceDirectory` | request-handler-matched | `src/main/ipc/app.ts:325` (ipcMain.handle) |
| `app:prepareTerminalStartupRestoration` | request-handler-matched | `src/main/startup/main-process-ipc-bootstrap.ts:21` (ipcMain.handle) |
| `app:recoverLegacyWorkerTerminalsForRendererStartup` | request-handler-matched | `src/main/startup/main-process-ipc-bootstrap.ts:28` (ipcMain.handle) |
| `app:relaunch` | request-handler-matched | `src/main/ipc/app.ts:291` (ipcMain.handle) |
| `app:reload` | request-handler-matched | `src/main/window/attach-main-window-services.ts:226` (ipcMain.handle) |
| `app:restart` | request-handler-matched | `src/main/ipc/app.ts:302` (ipcMain.handle) |
| `app:setUnreadDockBadgeCount` | request-handler-matched | `src/main/ipc/app.ts:313` (ipcMain.handle) |
| `app:startupDiagnostic` | request-handler-matched | `src/main/startup/main-process-ipc-bootstrap.ts:61` (ipcMain.handle) |
| `automations:createExternalForOwner` | request-handler-matched | `src/main/ipc/automations.ts:93` (ipcMain.handle) |
| `automations:listExternalManagerForOwner` | request-handler-matched | `src/main/ipc/automations.ts:80` (ipcMain.handle) |
| `automations:listExternalRunsForOwner` | request-handler-matched | `src/main/ipc/automations.ts:88` (ipcMain.handle) |
| `automations:markDispatchResult` | request-handler-matched | `src/main/ipc/automations.ts:125` (ipcMain.handle) |
| `automations:rendererReady` | request-handler-matched | `src/main/ipc/automations.ts:135` (ipcMain.handle) |
| `automations:retainExternalScopes` | request-handler-matched | `src/main/ipc/automations.ts:111` (ipcMain.handle) |
| `automations:runExternalActionForOwner` | request-handler-matched | `src/main/ipc/automations.ts:103` (ipcMain.handle) |
| `automations:runPrecheck` | request-handler-matched | `src/main/ipc/automations.ts:117` (ipcMain.handle) |
| `automations:snapshotWorkspaceName` | request-handler-matched | `src/main/ipc/automations.ts:130` (ipcMain.handle) |
| `automations:updateExternalForOwner` | request-handler-matched | `src/main/ipc/automations.ts:98` (ipcMain.handle) |
| `bitbucket:connect` | request-handler-matched | `src/main/ipc/bitbucket.ts:34` (ipcMain.handle) |
| `bitbucket:disconnect` | request-handler-matched | `src/main/ipc/bitbucket.ts:51` (ipcMain.handle) |
| `bitbucket:status` | request-handler-matched | `src/main/ipc/bitbucket.ts:56` (ipcMain.handle) |
| `bots:create` | request-handler-unresolved | — |
| `bots:createResponsibility` | request-handler-unresolved | — |
| `bots:delete` | request-handler-unresolved | — |
| `bots:list` | request-handler-unresolved | — |
| `bots:rotateSession` | request-handler-unresolved | — |
| `bots:runResponsibility` | request-handler-unresolved | — |
| `bots:update` | request-handler-unresolved | — |
| `browser:activeTabChanged` | request-handler-matched | `src/main/ipc/browser.ts:213` (ipcMain.handle) |
| `browser:awaitGrabSelection` | request-handler-matched | `src/main/ipc/browser-grab-ipc.ts:124` (ipcMain.handle) |
| `browser:cancelDownload` | request-handler-matched | `src/main/ipc/browser-guest-view-ipc.ts:172` (ipcMain.handle) |
| `browser:cancelGrab` | request-handler-matched | `src/main/ipc/browser-grab-ipc.ts:142` (ipcMain.handle) |
| `browser:captureSelectionScreenshot` | request-handler-matched | `src/main/ipc/browser-grab-ipc.ts:156` (ipcMain.handle) |
| `browser:extractHoverPayload` | request-handler-matched | `src/main/ipc/browser-grab-ipc.ts:181` (ipcMain.handle) |
| `browser:isGuestRegistered` | request-handler-matched | `src/main/ipc/browser.ts:143` (ipcMain.handle) |
| `browser:openDevTools` | request-handler-matched | `src/main/ipc/browser-guest-view-ipc.ts:26` (ipcMain.handle) |
| `browser:prepareSshWorkspacePartition` | request-handler-matched | `src/main/ipc/browser.ts:105` (ipcMain.handle) |
| `browser:proceedCertificate` | request-handler-matched | `src/main/ipc/browser.ts:193` (ipcMain.handle) |
| `browser:publishClientPageMetadata` | request-handler-matched | `src/main/ipc/browser-guest-view-ipc.ts:145` (ipcMain.handle) |
| `browser:registerGuest` | request-handler-matched | `src/main/ipc/browser.ts:99` (ipcMain.handle) |
| `browser:repairGuestRegistration` | request-handler-matched | `src/main/ipc/browser.ts:139` (ipcMain.handle) |
| `browser:respondWebAuthnAccount` | request-handler-matched | `src/main/ipc/browser.ts:183` (ipcMain.handle) |
| `browser:session:clearDefaultCookies` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:104` (ipcMain.handle) |
| `browser:session:clientRouteImportSources` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:145` (ipcMain.handle) |
| `browser:session:createProfile` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:35` (ipcMain.handle) |
| `browser:session:deleteProfile` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:53` (ipcMain.handle) |
| `browser:session:detectBrowsers` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:155` (ipcMain.handle) |
| `browser:session:detectBrowsersForClientHost` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:164` (ipcMain.handle) |
| `browser:session:importCookies` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:63` (ipcMain.handle) |
| `browser:session:importFromBrowser` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:177` (ipcMain.handle) |
| `browser:session:importFromBrowserForClientHost` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:118` (ipcMain.handle) |
| `browser:session:listProfiles` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:28` (ipcMain.handle) |
| `browser:session:resolvePartition` | request-handler-matched | `src/main/ipc/browser-session-profile-ipc.ts:92` (ipcMain.handle) |
| `browser:setAnnotationViewportBridge` | request-handler-matched | `src/main/ipc/browser-guest-view-ipc.ts:104` (ipcMain.handle) |
| `browser:setGrabMode` | request-handler-matched | `src/main/ipc/browser-grab-ipc.ts:77` (ipcMain.handle) |
| `browser:setViewportOverride` | request-handler-matched | `src/main/ipc/browser-guest-view-ipc.ts:33` (ipcMain.handle) |
| `browser:unregisterGuest` | request-handler-matched | `src/main/ipc/browser.ts:160` (ipcMain.handle) |
| `cache:getGitHub` | request-handler-matched | `src/main/ipc/settings.ts:330` (ipcMain.handle) |
| `cache:setGitHub` | request-handler-matched | `src/main/ipc/settings.ts:334` (ipcMain.handle) |
| `claudeAccounts:add` | request-handler-matched | `src/main/ipc/claude-accounts.ts:7` (ipcMain.handle) |
| `claudeAccounts:cancelPendingLogin` | request-handler-matched | `src/main/ipc/claude-accounts.ts:10` (ipcMain.handle) |
| `claudeAccounts:list` | request-handler-matched | `src/main/ipc/claude-accounts.ts:6` (ipcMain.handle) |
| `claudeAccounts:reauthenticate` | request-handler-matched | `src/main/ipc/claude-accounts.ts:11` (ipcMain.handle) |
| `claudeAccounts:remove` | request-handler-matched | `src/main/ipc/claude-accounts.ts:14` (ipcMain.handle) |
| `claudeAccounts:select` | request-handler-matched | `src/main/ipc/claude-accounts.ts:17` (ipcMain.handle) |
| `cli:getInstallStatus` | request-handler-matched | `src/main/ipc/cli.ts:92` (ipcMain.handle) |
| `cli:getWslInstallStatus` | request-handler-matched | `src/main/ipc/cli.ts:140` (ipcMain.handle) |
| `cli:install` | request-handler-matched | `src/main/ipc/cli.ts:130` (ipcMain.handle) |
| `cli:installWsl` | request-handler-matched | `src/main/ipc/cli.ts:150` (ipcMain.handle) |
| `cli:remove` | request-handler-matched | `src/main/ipc/cli.ts:135` (ipcMain.handle) |
| `cli:removeWsl` | request-handler-matched | `src/main/ipc/cli.ts:167` (ipcMain.handle) |
| `clipboard:readImageThumbnail` | request-handler-matched | `src/main/window/clipboard-ipc-handlers.ts:108` (ipcMain.handle) |
| `clipboard:readSelectionText` | request-handler-matched | `src/main/window/clipboard-ipc-handlers.ts:99` (ipcMain.handle) |
| `clipboard:readText` | request-handler-matched | `src/main/window/clipboard-ipc-handlers.ts:95` (ipcMain.handle) |
| `clipboard:saveImageAsTempFile` | request-handler-matched | `src/main/window/clipboard-ipc-handlers.ts:115` (ipcMain.handle) |
| `clipboard:writeFile` | request-handler-matched | `src/main/window/clipboard-ipc-handlers.ts:142` (ipcMain.handle) |
| `clipboard:writeImage` | request-handler-matched | `src/main/window/clipboard-ipc-handlers.ts:187` (ipcMain.handle) |
| `clipboard:writeSelectionText` | request-handler-matched | `src/main/window/clipboard-ipc-handlers.ts:180` (ipcMain.handle) |
| `clipboard:writeTerminalText` | request-handler-matched | `src/main/window/clipboard-ipc-handlers.ts:176` (ipcMain.handle) |
| `clipboard:writeText` | request-handler-matched | `src/main/window/clipboard-ipc-handlers.ts:172` (ipcMain.handle) |
| `codexAccounts:add` | request-handler-matched | `src/main/ipc/codex-accounts.ts:38` (ipcMain.handle) |
| `codexAccounts:forgetStalePanes` | request-handler-matched | `src/main/ipc/codex-accounts.ts:31` (ipcMain.handle) |
| `codexAccounts:list` | request-handler-matched | `src/main/ipc/codex-accounts.ts:37` (ipcMain.handle) |
| `codexAccounts:listRecordedPaneLanes` | request-handler-matched | `src/main/ipc/codex-accounts.ts:23` (ipcMain.handle) |
| `codexAccounts:listStalePanes` | request-handler-matched | `src/main/ipc/codex-accounts.ts:12` (ipcMain.handle) |
| `codexAccounts:reauthenticate` | request-handler-matched | `src/main/ipc/codex-accounts.ts:41` (ipcMain.handle) |
| `codexAccounts:remove` | request-handler-matched | `src/main/ipc/codex-accounts.ts:48` (ipcMain.handle) |
| `codexAccounts:select` | request-handler-matched | `src/main/ipc/codex-accounts.ts:51` (ipcMain.handle) |
| `codexConfigSync:status` | request-handler-matched | `src/main/ipc/codex-config-sync.ts:16` (ipcMain.handle) |
| `computerUsePermissions:getStatus` | request-handler-matched | `src/main/ipc/computer-use-permissions.ts:21` (ipcMain.handle) |
| `computerUsePermissions:openSetup` | request-handler-matched | `src/main/ipc/computer-use-permissions.ts:10` (ipcMain.handle) |
| `computerUsePermissions:reset` | request-handler-matched | `src/main/ipc/computer-use-permissions.ts:29` (ipcMain.handle) |
| `crashReports:copyLatestDiagnostics` | request-handler-matched | `src/main/ipc/crash-reporting.ts:78` (ipcMain.handle) |
| `crashReports:dismiss` | request-handler-matched | `src/main/ipc/crash-reporting.ts:54` (ipcMain.handle) |
| `crashReports:getLatestPending` | request-handler-matched | `src/main/ipc/crash-reporting.ts:48` (ipcMain.handle) |
| `crashReports:getLatestReport` | request-handler-matched | `src/main/ipc/crash-reporting.ts:51` (ipcMain.handle) |
| `crashReports:recordRendererError` | request-handler-matched | `src/main/ipc/crash-reporting.ts:102` (ipcMain.handle) |
| `crashReports:submit` | request-handler-matched | `src/main/ipc/crash-reporting.ts:112` (ipcMain.handle) |
| `dashboard:getPopoutOpen` | request-handler-matched | `src/main/ipc/dashboard-popout.ts:110` (ipcMain.handle) |
| `dashboard:publishSnapshot` | request-handler-matched | `src/main/ipc/dashboard-popout.ts:73` (ipcMain.handle) |
| `dashboard:requestSnapshot` | request-handler-matched | `src/main/ipc/dashboard-popout.ts:100` (ipcMain.handle) |
| `dashboardPopout:ackAgent` | request-handler-matched | `src/main/ipc/dashboard-popout.ts:118` (ipcMain.handle) |
| `dashboardPopout:open` | request-handler-matched | `src/main/ipc/dashboard-popout.ts:60` (ipcMain.handle) |
| `dashboardPopout:revealAgent` | request-handler-matched | `src/main/ipc/dashboard-popout.ts:132` (ipcMain.handle) |
| `dashboardPopout:sleepWorkspace` | request-handler-matched | `src/main/ipc/dashboard-popout.ts:166` (ipcMain.handle) |
| `dashboardPopout:spawnAgent` | request-handler-matched | `src/main/ipc/dashboard-popout.ts:155` (ipcMain.handle) |
| `developerPermissions:getStatus` | request-handler-matched | `src/main/ipc/developer-permissions.ts:215` (ipcMain.handle) |
| `developerPermissions:openSettings` | request-handler-matched | `src/main/ipc/developer-permissions.ts:235` (ipcMain.handle) |
| `developerPermissions:request` | request-handler-matched | `src/main/ipc/developer-permissions.ts:222` (ipcMain.handle) |
| `developerPermissions:testLocalNetworkConnection` | request-handler-matched | `src/main/ipc/developer-permissions.ts:242` (ipcMain.handle) |
| `diagnostics:collectBundle` | request-handler-matched | `src/main/ipc/diagnostics.ts:212` (ipcMain.handle) |
| `diagnostics:deleteBundle` | request-handler-matched | `src/main/ipc/diagnostics.ts:298` (ipcMain.handle) |
| `diagnostics:discardBundlePreview` | request-handler-matched | `src/main/ipc/diagnostics.ts:294` (ipcMain.handle) |
| `diagnostics:getStatus` | request-handler-matched | `src/main/ipc/diagnostics.ts:208` (ipcMain.handle) |
| `diagnostics:openBundlePreview` | request-handler-matched | `src/main/ipc/diagnostics.ts:282` (ipcMain.handle) |
| `diagnostics:uploadBundle` | request-handler-matched | `src/main/ipc/diagnostics.ts:243` (ipcMain.handle) |
| `docPreview:authorizeDirectory` | request-handler-matched | `src/main/ipc/doc-preview-grant-ipc.ts:92` (ipcMain.handle) |
| `docPreview:mintGrant` | request-handler-matched | `src/main/ipc/doc-preview-grant-ipc.ts:56` (ipcMain.handle) |
| `docPreview:revokeGrant` | request-handler-matched | `src/main/ipc/doc-preview-grant-ipc.ts:88` (ipcMain.handle) |
| `drogonQuickSession:create` | request-handler-matched | `src/main/ipc/drogon-quick-session-handlers.ts:54` (ipcMain.handle) |
| `drogonQuickSession:promote` | request-handler-matched | `src/main/ipc/drogon-quick-session-handlers.ts:71` (ipcMain.handle) |
| `drogonQuickSession:restore` | request-handler-matched | `src/main/ipc/drogon-quick-session-handlers.ts:62` (ipcMain.handle) |
| `emulator:frameStreamStart` | request-handler-matched | `src/main/ipc/emulator-frame-stream.ts:32` (ipcMain.handle) |
| `emulator:frameStreamStop` | request-handler-matched | `src/main/ipc/emulator-frame-stream.ts:72` (ipcMain.handle) |
| `emulator:videoStreamStart` | request-handler-matched | `src/main/ipc/emulator-video-stream.ts:30` (ipcMain.handle) |
| `emulator:videoStreamStop` | request-handler-matched | `src/main/ipc/emulator-video-stream.ts:83` (ipcMain.handle) |
| `ephemeralVm:attachWorkspace` | request-handler-matched | `src/main/ipc/ephemeral-vm-runtime-handlers.ts:57` (ipcMain.handle) |
| `ephemeralVm:cancelProvision` | request-handler-matched | `src/main/ipc/ephemeral-vm.ts:284` (ipcMain.handle) |
| `ephemeralVm:cleanup` | request-handler-matched | `src/main/ipc/ephemeral-vm-runtime-handlers.ts:68` (ipcMain.handle) |
| `ephemeralVm:doctor` | request-handler-matched | `src/main/ipc/ephemeral-vm.ts:86` (ipcMain.handle) |
| `ephemeralVm:getCleanupCommand` | request-handler-matched | `src/main/ipc/ephemeral-vm-runtime-handlers.ts:250` (ipcMain.handle) |
| `ephemeralVm:listRecipeCatalog` | request-handler-matched | `src/main/ipc/ephemeral-vm.ts:79` (ipcMain.handle) |
| `ephemeralVm:listRecipes` | request-handler-matched | `src/main/ipc/ephemeral-vm.ts:75` (ipcMain.handle) |
| `ephemeralVm:listRuntimes` | request-handler-matched | `src/main/ipc/ephemeral-vm-runtime-handlers.ts:53` (ipcMain.handle) |
| `ephemeralVm:provision` | request-handler-matched | `src/main/ipc/ephemeral-vm.ts:106` (ipcMain.handle) |
| `ephemeralVm:resumeWorkspace` | request-handler-matched | `src/main/ipc/ephemeral-vm-runtime-handlers.ts:192` (ipcMain.handle) |
| `ephemeralVm:stopCleanup` | request-handler-matched | `src/main/ipc/ephemeral-vm-runtime-handlers.ts:127` (ipcMain.handle) |
| `ephemeralVm:suspendWorkspace` | request-handler-matched | `src/main/ipc/ephemeral-vm-runtime-handlers.ts:156` (ipcMain.handle) |
| `export:html-to-pdf` | request-handler-matched | `src/main/ipc/export.ts:16` (ipcMain.handle) |
| `feedback:submit` | request-handler-matched | `src/main/ipc/feedback.ts:345` (ipcMain.handle) |
| `folderWorkspaces:create` | request-handler-matched | `src/main/ipc/repos/folder-workspace-handlers.ts:38` (ipcMain.handle) |
| `folderWorkspaces:delete` | request-handler-matched | `src/main/ipc/repos/folder-workspace-handlers.ts:115` (ipcMain.handle) |
| `folderWorkspaces:getPathStatus` | request-handler-matched | `src/main/ipc/repos/folder-workspace-handlers.ts:29` (ipcMain.handle) |
| `folderWorkspaces:list` | request-handler-matched | `src/main/ipc/repos/folder-workspace-handlers.ts:27` (ipcMain.handle) |
| `folderWorkspaces:update` | request-handler-matched | `src/main/ipc/repos/folder-workspace-handlers.ts:75` (ipcMain.handle) |
| `fs:appendDownloadedFileChunk` | request-handler-matched | `src/main/ipc/filesystem/filesystem-download-handlers.ts:163` (ipcMain.handle) |
| `fs:authorizeExternalPath` | request-handler-matched | `src/main/ipc/filesystem/filesystem-write-handlers.ts:88` (ipcMain.handle) |
| `fs:cancelDownloadedFile` | request-handler-matched | `src/main/ipc/filesystem/filesystem-download-handlers.ts:208` (ipcMain.handle) |
| `fs:cancelListFiles` | request-handler-matched | `src/main/ipc/filesystem/filesystem-search-handlers.ts:239` (ipcMain.handle) |
| `fs:copy` | request-handler-matched | `src/main/ipc/filesystem-mutations.ts:108` (ipcMain.handle) |
| `fs:createDir` | request-handler-matched | `src/main/ipc/filesystem-mutations.ts:55` (ipcMain.handle) |
| `fs:createFile` | request-handler-matched | `src/main/ipc/filesystem-mutations.ts:28` (ipcMain.handle) |
| `fs:deletePath` | request-handler-matched | `src/main/ipc/filesystem/filesystem-write-handlers.ts:46` (ipcMain.handle) |
| `fs:downloadFile` | request-handler-matched | `src/main/ipc/filesystem/filesystem-download-handlers.ts:29` (ipcMain.handle) |
| `fs:downloadFolder` | request-handler-matched | `src/main/ipc/filesystem-download-folder.ts:50` (ipcMain.handle) |
| `fs:finishDownloadedFile` | request-handler-matched | `src/main/ipc/filesystem/filesystem-download-handlers.ts:180` (ipcMain.handle) |
| `fs:importExternalPaths` | request-handler-matched | `src/main/ipc/filesystem-mutations.ts:141` (ipcMain.handle) |
| `fs:listFiles` | request-handler-matched | `src/main/ipc/filesystem/filesystem-search-handlers.ts:178` (ipcMain.handle) |
| `fs:listMarkdownDocuments` | request-handler-matched | `src/main/ipc/filesystem/filesystem-read-handlers.ts:117` (ipcMain.handle) |
| `fs:pathExists` | request-handler-matched | `src/main/ipc/filesystem/filesystem-read-handlers.ts:150` (ipcMain.handle) |
| `fs:readDir` | request-handler-matched | `src/main/ipc/filesystem/filesystem-read-handlers.ts:28` (ipcMain.handle) |
| `fs:readFile` | request-handler-matched | `src/main/ipc/filesystem/filesystem-read-handlers.ts:64` (ipcMain.handle) |
| `fs:readLocalLogTail` | request-handler-matched | `src/main/ipc/local-log-tail.ts:59` (ipcMain.handle) |
| `fs:rename` | request-handler-matched | `src/main/ipc/filesystem-mutations.ts:80` (ipcMain.handle) |
| `fs:resolveDroppedPathsForAgent` | request-handler-matched | `src/main/ipc/filesystem-mutations.ts:212` (ipcMain.handle) |
| `fs:saveDownloadedFile` | request-handler-matched | `src/main/ipc/filesystem/filesystem-download-handlers.ts:75` (ipcMain.handle) |
| `fs:search` | request-handler-matched | `src/main/ipc/filesystem/filesystem-search-handlers.ts:37` (ipcMain.handle) |
| `fs:stageExternalPathsForRuntimeUpload` | request-handler-matched | `src/main/ipc/filesystem-mutations.ts:192` (ipcMain.handle) |
| `fs:startDownloadedFile` | request-handler-matched | `src/main/ipc/filesystem/filesystem-download-handlers.ts:114` (ipcMain.handle) |
| `fs:startLocalLogTail` | request-handler-matched | `src/main/ipc/local-log-tail.ts:67` (ipcMain.handle) |
| `fs:stat` | request-handler-matched | `src/main/ipc/filesystem/filesystem-read-handlers.ts:133` (ipcMain.handle) |
| `fs:stopLocalLogTail` | request-handler-matched | `src/main/ipc/local-log-tail.ts:94` (ipcMain.handle) |
| `fs:unwatchWorktree` | request-handler-matched | `src/main/ipc/filesystem-watcher-handlers.ts:69` (ipcMain.handle) |
| `fs:watchWorktree` | request-handler-matched | `src/main/ipc/filesystem-watcher-handlers.ts:30` (ipcMain.handle) |
| `fs:writeFile` | request-handler-matched | `src/main/ipc/filesystem/filesystem-write-handlers.ts:15` (ipcMain.handle) |
| `gh:addIssueComment` | request-handler-matched | `src/main/ipc/github-issue-mutation-handlers.ts:43` (ipcMain.handle) |
| `gh:addIssueCommentBySlug` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:68` (ipcMain.handle) |
| `gh:addPRReviewComment` | request-handler-matched | `src/main/ipc/github-pr-review-handlers.ts:115` (ipcMain.handle) |
| `gh:addPRReviewCommentReply` | request-handler-matched | `src/main/ipc/github-pr-review-handlers.ts:58` (ipcMain.handle) |
| `gh:checkOrcaStarred` | request-handler-matched | `src/main/ipc/github-account-handlers.ts:11` (ipcMain.handle) |
| `gh:clearProjectItemField` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:59` (ipcMain.handle) |
| `gh:countWorkItems` | request-handler-matched | `src/main/ipc/github-work-item-handlers.ts:108` (ipcMain.handle) |
| `gh:createIssue` | request-handler-matched | `src/main/ipc/github-work-item-handlers.ts:58` (ipcMain.handle) |
| `gh:deleteIssueCommentBySlug` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:74` (ipcMain.handle) |
| `gh:diagnoseAuth` | request-handler-matched | `src/main/ipc/github-account-handlers.ts:28` (ipcMain.handle) |
| `gh:enqueuePRRefresh` | request-handler-matched | `src/main/ipc/github-pr-refresh-handlers.ts:123` (ipcMain.handle) |
| `gh:getProjectViewTable` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:49` (ipcMain.handle) |
| `gh:issue` | request-handler-matched | `src/main/ipc/github-work-item-handlers.ts:26` (ipcMain.handle) |
| `gh:listAccessibleProjects` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:40` (ipcMain.handle) |
| `gh:listAssignableUsers` | request-handler-matched | `src/main/ipc/github-issue-mutation-handlers.ts:97` (ipcMain.handle) |
| `gh:listAssignableUsersBySlug` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:80` (ipcMain.handle) |
| `gh:listIssueTypesBySlug` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:83` (ipcMain.handle) |
| `gh:listIssues` | request-handler-matched | `src/main/ipc/github-work-item-handlers.ts:47` (ipcMain.handle) |
| `gh:listLabels` | request-handler-matched | `src/main/ipc/github-issue-mutation-handlers.ts:87` (ipcMain.handle) |
| `gh:listLabelsBySlug` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:77` (ipcMain.handle) |
| `gh:listProjectViews` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:46` (ipcMain.handle) |
| `gh:listWorkItems` | request-handler-matched | `src/main/ipc/github-work-item-handlers.ts:81` (ipcMain.handle) |
| `gh:markPRReadyForReview` | request-handler-matched | `src/main/ipc/github-pr-mutation-handlers.ts:137` (ipcMain.handle) |
| `gh:mergePR` | request-handler-matched | `src/main/ipc/github-pr-mutation-handlers.ts:56` (ipcMain.handle) |
| `gh:notifyWorkItemMutated` | request-handler-matched | `src/main/ipc/github-work-item-handlers.ts:159` (ipcMain.handle) |
| `gh:prCheckDetails` | request-handler-matched | `src/main/ipc/github-pr-read-handlers.ts:69` (ipcMain.handle) |
| `gh:prChecks` | request-handler-matched | `src/main/ipc/github-pr-read-handlers.ts:42` (ipcMain.handle) |
| `gh:prComments` | request-handler-matched | `src/main/ipc/github-pr-read-handlers.ts:100` (ipcMain.handle) |
| `gh:prFileContents` | request-handler-matched | `src/main/ipc/github-work-item-handlers.ts:184` (ipcMain.handle) |
| `gh:prForBranch` | request-handler-matched | `src/main/ipc/github-pr-refresh-handlers.ts:51` (ipcMain.handle) |
| `gh:projectWorkItemDetailsBySlug` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:52` (ipcMain.handle) |
| `gh:rateLimit` | request-handler-matched | `src/main/ipc/github-account-handlers.ts:24` (ipcMain.handle) |
| `gh:refreshPRNow` | request-handler-matched | `src/main/ipc/github-pr-refresh-handlers.ts:107` (ipcMain.handle) |
| `gh:removePRReviewers` | request-handler-matched | `src/main/ipc/github-pr-mutation-handlers.ts:219` (ipcMain.handle) |
| `gh:repoSlug` | request-handler-matched | `src/main/ipc/github-pr-read-handlers.ts:22` (ipcMain.handle) |
| `gh:repoUpstream` | request-handler-matched | `src/main/ipc/github-pr-read-handlers.ts:32` (ipcMain.handle) |
| `gh:reportVisiblePRRefreshCandidates` | request-handler-matched | `src/main/ipc/github-pr-refresh-handlers.ts:142` (ipcMain.handle) |
| `gh:requestPRReviewers` | request-handler-matched | `src/main/ipc/github-pr-mutation-handlers.ts:195` (ipcMain.handle) |
| `gh:rerunPRChecks` | request-handler-matched | `src/main/ipc/github-pr-mutation-handlers.ts:166` (ipcMain.handle) |
| `gh:resolveProjectRef` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:43` (ipcMain.handle) |
| `gh:resolveReviewThread` | request-handler-matched | `src/main/ipc/github-pr-read-handlers.ts:154` (ipcMain.handle) |
| `gh:setPRAutoMerge` | request-handler-matched | `src/main/ipc/github-pr-mutation-handlers.ts:80` (ipcMain.handle) |
| `gh:setPRCommentReaction` | request-handler-matched | `src/main/ipc/github-pr-read-handlers.ts:124` (ipcMain.handle) |
| `gh:setPRFileViewed` | request-handler-matched | `src/main/ipc/github-pr-review-handlers.ts:14` (ipcMain.handle) |
| `gh:starOrca` | request-handler-matched | `src/main/ipc/github-account-handlers.ts:12` (ipcMain.handle) |
| `gh:updateIssue` | request-handler-matched | `src/main/ipc/github-issue-mutation-handlers.ts:16` (ipcMain.handle) |
| `gh:updateIssueBySlug` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:62` (ipcMain.handle) |
| `gh:updateIssueCommentBySlug` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:71` (ipcMain.handle) |
| `gh:updateIssueTypeBySlug` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:86` (ipcMain.handle) |
| `gh:updatePRState` | request-handler-matched | `src/main/ipc/github-pr-mutation-handlers.ts:106` (ipcMain.handle) |
| `gh:updatePRTitle` | request-handler-matched | `src/main/ipc/github-pr-mutation-handlers.ts:36` (ipcMain.handle) |
| `gh:updateProjectItemField` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:56` (ipcMain.handle) |
| `gh:updatePullRequestBySlug` | request-handler-matched | `src/main/ipc/github-project-view-handlers.ts:65` (ipcMain.handle) |
| `gh:viewer` | request-handler-matched | `src/main/ipc/github-account-handlers.ts:10` (ipcMain.handle) |
| `gh:workItem` | request-handler-matched | `src/main/ipc/github-work-item-handlers.ts:119` (ipcMain.handle) |
| `gh:workItemByOwnerRepo` | request-handler-matched | `src/main/ipc/github-work-item-handlers.ts:124` (ipcMain.handle) |
| `gh:workItemDetails` | request-handler-matched | `src/main/ipc/github-work-item-handlers.ts:149` (ipcMain.handle) |
| `git:abortMerge` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:235` (ipcMain.handle) |
| `git:abortRebase` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:255` (ipcMain.handle) |
| `git:appendGitignore` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:179` (ipcMain.handle) |
| `git:branchCompare` | request-handler-matched | `src/main/ipc/filesystem/git-remote/compare-handlers.ts:20` (ipcMain.handle) |
| `git:branchDiff` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-diff-handlers.ts:18` (ipcMain.handle) |
| `git:bulkDiscard` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-index-handlers.ts:93` (ipcMain.handle) |
| `git:bulkStage` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-index-handlers.ts:120` (ipcMain.handle) |
| `git:bulkUnstage` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-index-handlers.ts:147` (ipcMain.handle) |
| `git:cancelGenerateCommitMessage` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-commit-generation-handlers.ts:142` (ipcMain.handle) |
| `git:cancelGeneratePullRequestFields` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-pull-request-generation-handlers.ts:211` (ipcMain.handle) |
| `git:cancelStatus` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:98` (ipcMain.handle) |
| `git:checkIgnored` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:140` (ipcMain.handle) |
| `git:commit` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-commit-handlers.ts:13` (ipcMain.handle) |
| `git:commitCompare` | request-handler-matched | `src/main/ipc/filesystem/git-remote/compare-handlers.ts:55` (ipcMain.handle) |
| `git:commitDiff` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-diff-handlers.ts:79` (ipcMain.handle) |
| `git:conflictOperation` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:212` (ipcMain.handle) |
| `git:diff` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:275` (ipcMain.handle) |
| `git:discard` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-index-handlers.ts:69` (ipcMain.handle) |
| `git:discoverCommitMessageModels` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-model-discovery-handlers.ts:23` (ipcMain.handle) |
| `git:fastForward` | request-handler-matched | `src/main/ipc/filesystem/git-remote/branch-mutation-handlers.ts:149` (ipcMain.handle) |
| `git:fetch` | request-handler-matched | `src/main/ipc/filesystem/git-remote/sync-handlers.ts:55` (ipcMain.handle) |
| `git:findHugeFoldersToIgnore` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:166` (ipcMain.handle) |
| `git:generateCommitMessage` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-commit-generation-handlers.ts:32` (ipcMain.handle) |
| `git:generatePullRequestFields` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-pull-request-generation-handlers.ts:36` (ipcMain.handle) |
| `git:history` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:187` (ipcMain.handle) |
| `git:pull` | request-handler-matched | `src/main/ipc/filesystem/git-remote/branch-mutation-handlers.ts:89` (ipcMain.handle) |
| `git:push` | request-handler-matched | `src/main/ipc/filesystem/git-remote/branch-mutation-handlers.ts:21` (ipcMain.handle) |
| `git:rebaseFromBase` | request-handler-matched | `src/main/ipc/filesystem/git-remote/branch-mutation-handlers.ts:209` (ipcMain.handle) |
| `git:remoteCommitUrl` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-url-handlers.ts:34` (ipcMain.handle) |
| `git:remoteFileUrl` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-url-handlers.ts:14` (ipcMain.handle) |
| `git:setStatusUpstreamRefWatch` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:102` (ipcMain.handle) |
| `git:stage` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-index-handlers.ts:21` (ipcMain.handle) |
| `git:status` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:42` (ipcMain.handle) |
| `git:submoduleStatus` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-status-handlers.ts:109` (ipcMain.handle) |
| `git:syncFork` | request-handler-matched | `src/main/ipc/filesystem/git-remote/sync-handlers.ts:115` (ipcMain.handle) |
| `git:unstage` | request-handler-matched | `src/main/ipc/filesystem/filesystem-git-index-handlers.ts:45` (ipcMain.handle) |
| `git:upstreamStatus` | request-handler-matched | `src/main/ipc/filesystem/git-remote/sync-handlers.ts:29` (ipcMain.handle) |
| `gitBash:isAvailable` | request-handler-matched | `src/main/ipc/app.ts:271` (ipcMain.handle) |
| `grokAccounts:getStatus` | request-handler-matched | `src/main/ipc/grok-accounts.ts:5` (ipcMain.handle) |
| `hooks:check` | request-handler-matched | `src/main/ipc/hooks/register-worktree-hook-check-handler.ts:14` (ipcMain.handle) |
| `hooks:createIssueCommandRunner` | request-handler-matched | `src/main/ipc/hooks/register-worktree-hook-runner-handler.ts:12` (ipcMain.handle) |
| `hooks:inspectSetupScriptImports` | request-handler-matched | `src/main/ipc/hooks/register-worktree-hook-inspection-handler.ts:15` (ipcMain.handle) |
| `hooks:readIssueCommand` | request-handler-matched | `src/main/ipc/hooks/register-worktree-hook-file-handlers.ts:15` (ipcMain.handle) |
| `hooks:writeIssueCommand` | request-handler-matched | `src/main/ipc/hooks/register-worktree-hook-file-handlers.ts:82` (ipcMain.handle) |
| `hostedReview:create` | request-handler-matched | `src/main/ipc/hosted-review.ts:153` (ipcMain.handle) |
| `hostedReview:createStacked` | request-handler-matched | `src/main/ipc/hosted-review.ts:198` (ipcMain.handle) |
| `hostedReview:forBranch` | request-handler-matched | `src/main/ipc/hosted-review.ts:107` (ipcMain.handle) |
| `hostedReview:getCreationEligibility` | request-handler-matched | `src/main/ipc/hosted-review.ts:138` (ipcMain.handle) |
| `jira:addIssueComment` | request-handler-matched | `src/main/ipc/jira.ts:233` (ipcMain.handle) |
| `jira:cancelIssueSummary` | request-handler-matched | `src/main/ipc/jira.ts:191` (ipcMain.handle) |
| `jira:cancelSearchIssues` | request-handler-matched | `src/main/ipc/jira.ts:150` (ipcMain.handle) |
| `jira:connect` | request-handler-matched | `src/main/ipc/jira.ts:90` (ipcMain.handle) |
| `jira:createIssue` | request-handler-matched | `src/main/ipc/jira.ts:195` (ipcMain.handle) |
| `jira:disconnect` | request-handler-matched | `src/main/ipc/jira.ts:110` (ipcMain.handle) |
| `jira:getIssue` | request-handler-matched | `src/main/ipc/jira.ts:167` (ipcMain.handle) |
| `jira:getProjectStatusOrder` | request-handler-matched | `src/main/ipc/jira.ts:316` (ipcMain.handle) |
| `jira:issueComments` | request-handler-matched | `src/main/ipc/jira.ts:246` (ipcMain.handle) |
| `jira:listAssignableUsers` | request-handler-matched | `src/main/ipc/jira.ts:288` (ipcMain.handle) |
| `jira:listCreateFields` | request-handler-matched | `src/main/ipc/jira.ts:267` (ipcMain.handle) |
| `jira:listIssueTypes` | request-handler-matched | `src/main/ipc/jira.ts:257` (ipcMain.handle) |
| `jira:listIssues` | request-handler-matched | `src/main/ipc/jira.ts:154` (ipcMain.handle) |
| `jira:listPriorities` | request-handler-matched | `src/main/ipc/jira.ts:284` (ipcMain.handle) |
| `jira:listProjects` | request-handler-matched | `src/main/ipc/jira.ts:253` (ipcMain.handle) |
| `jira:listTransitions` | request-handler-matched | `src/main/ipc/jira.ts:309` (ipcMain.handle) |
| `jira:lookupIssueSummary` | request-handler-matched | `src/main/ipc/jira.ts:174` (ipcMain.handle) |
| `jira:readStatus` | request-handler-matched | `src/main/ipc/jira.ts:127` (ipcMain.handle) |
| `jira:searchIssues` | request-handler-matched | `src/main/ipc/jira.ts:135` (ipcMain.handle) |
| `jira:searchUsers` | request-handler-matched | `src/main/ipc/jira.ts:302` (ipcMain.handle) |
| `jira:selectSite` | request-handler-matched | `src/main/ipc/jira.ts:115` (ipcMain.handle) |
| `jira:status` | request-handler-matched | `src/main/ipc/jira.ts:123` (ipcMain.handle) |
| `jira:testConnection` | request-handler-matched | `src/main/ipc/jira.ts:131` (ipcMain.handle) |
| `jira:updateIssue` | request-handler-matched | `src/main/ipc/jira.ts:219` (ipcMain.handle) |
| `keybindings:ensureFile` | request-handler-matched | `src/main/ipc/keybindings.ts:22` (ipcMain.handle) |
| `keybindings:get` | request-handler-matched | `src/main/ipc/keybindings.ts:20` (ipcMain.handle) |
| `keybindings:openFile` | request-handler-matched | `src/main/ipc/keybindings.ts:49` (ipcMain.handle) |
| `keybindings:reload` | request-handler-matched | `src/main/ipc/keybindings.ts:42` (ipcMain.handle) |
| `keybindings:revealFile` | request-handler-matched | `src/main/ipc/keybindings.ts:59` (ipcMain.handle) |
| `keybindings:setAction` | request-handler-matched | `src/main/ipc/keybindings.ts:32` (ipcMain.handle) |
| `linear:addIssueComment` | request-handler-matched | `src/main/ipc/linear-issue-handlers.ts:168` (ipcMain.handle) |
| `linear:connect` | request-handler-matched | `src/main/ipc/linear.ts:11` (ipcMain.handle) |
| `linear:createIssue` | request-handler-matched | `src/main/ipc/linear-issue-handlers.ts:56` (ipcMain.handle) |
| `linear:createProject` | request-handler-matched | `src/main/ipc/linear-project-handlers.ts:35` (ipcMain.handle) |
| `linear:disconnect` | request-handler-matched | `src/main/ipc/linear.ts:22` (ipcMain.handle) |
| `linear:getCustomView` | request-handler-matched | `src/main/ipc/linear-custom-view-handlers.ts:39` (ipcMain.handle) |
| `linear:getIssue` | request-handler-matched | `src/main/ipc/linear-issue-handlers.ts:109` (ipcMain.handle) |
| `linear:getProject` | request-handler-matched | `src/main/ipc/linear-project-handlers.ts:101` (ipcMain.handle) |
| `linear:issueComments` | request-handler-matched | `src/main/ipc/linear-issue-handlers.ts:185` (ipcMain.handle) |
| `linear:listCustomViewIssues` | request-handler-matched | `src/main/ipc/linear-custom-view-handlers.ts:62` (ipcMain.handle) |
| `linear:listCustomViewProjects` | request-handler-matched | `src/main/ipc/linear-custom-view-handlers.ts:81` (ipcMain.handle) |
| `linear:listCustomViews` | request-handler-matched | `src/main/ipc/linear-custom-view-handlers.ts:18` (ipcMain.handle) |
| `linear:listIssues` | request-handler-matched | `src/main/ipc/linear-issue-handlers.ts:29` (ipcMain.handle) |
| `linear:listProjectIssues` | request-handler-matched | `src/main/ipc/linear-project-handlers.ts:115` (ipcMain.handle) |
| `linear:listProjects` | request-handler-matched | `src/main/ipc/linear-project-handlers.ts:14` (ipcMain.handle) |
| `linear:listTeams` | request-handler-matched | `src/main/ipc/linear-team-handlers.ts:7` (ipcMain.handle) |
| `linear:searchIssues` | request-handler-matched | `src/main/ipc/linear-issue-handlers.ts:15` (ipcMain.handle) |
| `linear:selectWorkspace` | request-handler-matched | `src/main/ipc/linear.ts:27` (ipcMain.handle) |
| `linear:status` | request-handler-matched | `src/main/ipc/linear.ts:35` (ipcMain.handle) |
| `linear:teamLabels` | request-handler-matched | `src/main/ipc/linear-team-handlers.ts:24` (ipcMain.handle) |
| `linear:teamMembers` | request-handler-matched | `src/main/ipc/linear-team-handlers.ts:34` (ipcMain.handle) |
| `linear:teamStates` | request-handler-matched | `src/main/ipc/linear-team-handlers.ts:14` (ipcMain.handle) |
| `linear:testConnection` | request-handler-matched | `src/main/ipc/linear.ts:39` (ipcMain.handle) |
| `linear:updateIssue` | request-handler-matched | `src/main/ipc/linear-issue-handlers.ts:116` (ipcMain.handle) |
| `localhostWorktreeLabels:register` | request-handler-matched | `src/main/ipc/localhost-worktree-labels.ts:17` (ipcMain.handle) |
| `macosTccPrompts:acknowledgePending` | request-handler-unresolved | — |
| `macosTccPrompts:consumePending` | request-handler-unresolved | — |
| `macosTccPrompts:dismiss` | request-handler-unresolved | — |
| `macosTccPrompts:releasePending` | request-handler-unresolved | — |
| `meetings:list` | request-handler-matched | `src/main/meetings/write-that-down-bridge.ts:186` (ipcMain.handle) |
| `meetings:mount` | request-handler-matched | `src/main/meetings/write-that-down-bridge.ts:191` (ipcMain.handle) |
| `meetings:select-root` | request-handler-matched | `src/main/meetings/write-that-down-bridge.ts:172` (ipcMain.handle) |
| `memory:getSnapshot` | request-handler-matched | `src/main/ipc/memory.ts:7` (ipcMain.handle) |
| `mentu:capability` | request-handler-unresolved | — |
| `mentu:check` | request-handler-unresolved | — |
| `mentu:doctor` | request-handler-unresolved | — |
| `mentu:listRecipes` | request-handler-unresolved | — |
| `mentu:loadRecipe` | request-handler-unresolved | — |
| `mentu:readRun` | request-handler-unresolved | — |
| `mentu:resume` | request-handler-unresolved | — |
| `mentu:retryStep` | request-handler-unresolved | — |
| `mentu:run` | request-handler-unresolved | — |
| `mentu:saveRecipe` | request-handler-unresolved | — |
| `mentu:sessionApprove` | request-handler-unresolved | — |
| `mentu:sessionCancel` | request-handler-unresolved | — |
| `mentu:sessionExecute` | request-handler-unresolved | — |
| `mentu:sessionReview` | request-handler-unresolved | — |
| `minimaxCredentials:clearCookie` | request-handler-matched | `src/main/ipc/minimax-credentials.ts:42` (ipcMain.handle) |
| `minimaxCredentials:getStatus` | request-handler-matched | `src/main/ipc/minimax-credentials.ts:31` (ipcMain.handle) |
| `minimaxCredentials:saveCookie` | request-handler-matched | `src/main/ipc/minimax-credentials.ts:32` (ipcMain.handle) |
| `mobile:consumePendingUnpairedDeviceAuthFailure` | request-handler-matched | `src/main/ipc/mobile.ts:294` (ipcMain.handle) |
| `mobile:getPairingQR` | request-handler-matched | `src/main/ipc/mobile.ts:79` (ipcMain.handle) |
| `mobile:getRelayStatus` | request-handler-matched | `src/main/ipc/mobile.ts:290` (ipcMain.handle) |
| `mobile:getRuntimePairingUrl` | request-handler-matched | `src/main/ipc/mobile.ts:148` (ipcMain.handle) |
| `mobile:getWindowsFirewallStatus` | request-handler-matched | `src/main/ipc/mobile.ts:265` (ipcMain.handle) |
| `mobile:isWebSocketReady` | request-handler-matched | `src/main/ipc/mobile.ts:258` (ipcMain.handle) |
| `mobile:listDevices` | request-handler-matched | `src/main/ipc/mobile.ts:205` (ipcMain.handle) |
| `mobile:listNetworkInterfaces` | request-handler-matched | `src/main/ipc/mobile.ts:72` (ipcMain.handle) |
| `mobile:listRuntimeAccessGrants` | request-handler-matched | `src/main/ipc/mobile.ts:226` (ipcMain.handle) |
| `mobile:openWindowsNetworkSettings` | request-handler-matched | `src/main/ipc/mobile.ts:279` (ipcMain.handle) |
| `mobile:repairWindowsFirewall` | request-handler-matched | `src/main/ipc/mobile.ts:270` (ipcMain.handle) |
| `mobile:revokeDevice` | request-handler-matched | `src/main/ipc/mobile.ts:242` (ipcMain.handle) |
| `mobile:revokeRuntimeAccess` | request-handler-matched | `src/main/ipc/mobile.ts:250` (ipcMain.handle) |
| `nativeChat:readSession` | request-handler-matched | `src/main/ipc/native-chat.ts:306` (ipcMain.handle) |
| `notebook:runPythonCell` | request-handler-matched | `src/main/ipc/notebook.ts:219` (ipcMain.handle) |
| `notifications:dismiss` | request-handler-matched | `src/main/ipc/notifications.ts:89` (ipcMain.handle) |
| `notifications:dispatch` | request-handler-matched | `src/main/ipc/notifications.ts:107` (ipcMain.handle) |
| `notifications:getPermissionStatus` | request-handler-matched | `src/main/ipc/notifications.ts:47` (ipcMain.handle) |
| `notifications:loadSound` | request-handler-matched | `src/main/ipc/notification-sound-ipc.ts:34` (ipcMain.handle) |
| `notifications:openSystemSettings` | request-handler-matched | `src/main/ipc/notifications.ts:36` (ipcMain.handle) |
| `notifications:probeDelivery` | request-handler-matched | `src/main/ipc/notifications.ts:48` (ipcMain.handle) |
| `notifications:resolveSoundPath` | request-handler-matched | `src/main/ipc/notification-sound-ipc.ts:16` (ipcMain.handle) |
| `onboarding:get` | request-handler-matched | `src/main/ipc/onboarding.ts:9` (ipcMain.handle) |
| `onboarding:update` | request-handler-matched | `src/main/ipc/onboarding.ts:13` (ipcMain.handle) |
| `orcaProfiles:authStatus` | request-handler-matched | `src/main/ipc/orca-profiles.ts:177` (ipcMain.handle) |
| `orcaProfiles:connectCurrent` | request-handler-matched | `src/main/ipc/orca-profiles.ts:261` (ipcMain.handle) |
| `orcaProfiles:createCloudLinked` | request-handler-matched | `src/main/ipc/orca-profiles.ts:272` (ipcMain.handle) |
| `orcaProfiles:createLocal` | request-handler-matched | `src/main/ipc/orca-profiles.ts:181` (ipcMain.handle) |
| `orcaProfiles:findProjectProfiles` | request-handler-matched | `src/main/ipc/orca-profiles.ts:252` (ipcMain.handle) |
| `orcaProfiles:list` | request-handler-matched | `src/main/ipc/orca-profiles.ts:172` (ipcMain.handle) |
| `orcaProfiles:orgInviteRevoke` | request-handler-matched | `src/main/ipc/orca-profile-org-members-handlers.ts:99` (ipcMain.handle) |
| `orcaProfiles:orgMemberChangeRole` | request-handler-matched | `src/main/ipc/orca-profile-org-members-handlers.ts:108` (ipcMain.handle) |
| `orcaProfiles:orgMemberInvite` | request-handler-matched | `src/main/ipc/orca-profile-org-members-handlers.ts:90` (ipcMain.handle) |
| `orcaProfiles:orgMemberRemove` | request-handler-matched | `src/main/ipc/orca-profile-org-members-handlers.ts:120` (ipcMain.handle) |
| `orcaProfiles:orgMembersList` | request-handler-matched | `src/main/ipc/orca-profile-org-members-handlers.ts:81` (ipcMain.handle) |
| `orcaProfiles:refreshAuth` | request-handler-matched | `src/main/ipc/orca-profiles.ts:290` (ipcMain.handle) |
| `orcaProfiles:selectOrg` | request-handler-matched | `src/main/ipc/orca-profiles.ts:309` (ipcMain.handle) |
| `orcaProfiles:signOutCurrent` | request-handler-matched | `src/main/ipc/orca-profiles.ts:301` (ipcMain.handle) |
| `orcaProfiles:switch` | request-handler-matched | `src/main/ipc/orca-profiles.ts:190` (ipcMain.handle) |
| `orcaProfiles:transferProject` | request-handler-matched | `src/main/ipc/orca-profiles.ts:222` (ipcMain.handle) |
| `pet:delete` | request-handler-matched | `src/main/ipc/pet.ts:118` (ipcMain.handle) |
| `pet:import` | request-handler-matched | `src/main/ipc/pet.ts:20` (ipcMain.handle) |
| `pet:importPetBundle` | request-handler-matched | `src/main/ipc/pet.ts:84` (ipcMain.handle) |
| `pet:read` | request-handler-matched | `src/main/ipc/pet.ts:88` (ipcMain.handle) |
| `plugins:addMarketplace` | request-handler-matched | `src/main/ipc/plugin-marketplaces.ts:36` (ipcMain.handle) |
| `plugins:consent` | request-handler-matched | `src/main/ipc/plugins.ts:119` (ipcMain.handle) |
| `plugins:getLogs` | request-handler-matched | `src/main/ipc/plugins.ts:239` (ipcMain.handle) |
| `plugins:install` | request-handler-matched | `src/main/ipc/plugins.ts:182` (ipcMain.handle) |
| `plugins:installMarketplacePlugin` | request-handler-matched | `src/main/ipc/plugin-marketplaces.ts:56` (ipcMain.handle) |
| `plugins:invokeCommand` | request-handler-matched | `src/main/ipc/plugins.ts:176` (ipcMain.handle) |
| `plugins:list` | request-handler-matched | `src/main/ipc/plugins.ts:114` (ipcMain.handle) |
| `plugins:listLanguagePacks` | request-handler-matched | `src/main/ipc/plugins.ts:115` (ipcMain.handle) |
| `plugins:listMarketplacePlugins` | request-handler-matched | `src/main/ipc/plugin-marketplaces.ts:51` (ipcMain.handle) |
| `plugins:listMarketplaces` | request-handler-matched | `src/main/ipc/plugin-marketplaces.ts:35` (ipcMain.handle) |
| `plugins:panelAction` | request-handler-matched | `src/main/ipc/plugins.ts:168` (ipcMain.handle) |
| `plugins:previewMarketplacePlugin` | request-handler-matched | `src/main/ipc/plugin-marketplaces.ts:52` (ipcMain.handle) |
| `plugins:previewMarketplaceUpdate` | request-handler-matched | `src/main/ipc/plugin-marketplaces.ts:63` (ipcMain.handle) |
| `plugins:readPanelEntry` | request-handler-matched | `src/main/ipc/plugins.ts:148` (ipcMain.handle) |
| `plugins:refresh` | request-handler-matched | `src/main/ipc/plugins.ts:246` (ipcMain.handle) |
| `plugins:refreshMarketplaces` | request-handler-matched | `src/main/ipc/plugin-marketplaces.ts:45` (ipcMain.handle) |
| `plugins:remove` | request-handler-matched | `src/main/ipc/plugins.ts:210` (ipcMain.handle) |
| `plugins:removeMarketplace` | request-handler-matched | `src/main/ipc/plugin-marketplaces.ts:40` (ipcMain.handle) |
| `plugins:rollbackMarketplacePlugin` | request-handler-matched | `src/main/ipc/plugin-marketplaces.ts:67` (ipcMain.handle) |
| `plugins:setEnabled` | request-handler-matched | `src/main/ipc/plugins.ts:133` (ipcMain.handle) |
| `preflight:check` | request-handler-matched | `src/main/ipc/preflight.ts:21` (ipcMain.handle) |
| `preflight:detectAgents` | request-handler-matched | `src/main/ipc/preflight.ts:31` (ipcMain.handle) |
| `preflight:detectRemoteAgents` | request-handler-matched | `src/main/ipc/preflight.ts:43` (ipcMain.handle) |
| `preflight:detectRemoteWindowsTerminalCapabilities` | request-handler-matched | `src/main/ipc/preflight.ts:50` (ipcMain.handle) |
| `preflight:refreshAgents` | request-handler-matched | `src/main/ipc/preflight.ts:35` (ipcMain.handle) |
| `projectGroups:cancelNestedScan` | request-handler-matched | `src/main/ipc/repos/project-group-handlers.ts:102` (ipcMain.handle) |
| `projectGroups:create` | request-handler-matched | `src/main/ipc/repos/project-group-handlers.ts:24` (ipcMain.handle) |
| `projectGroups:delete` | request-handler-matched | `src/main/ipc/repos/project-group-handlers.ts:54` (ipcMain.handle) |
| `projectGroups:importNested` | request-handler-matched | `src/main/ipc/repos/nested-repo-import-handler.ts:33` (ipcMain.handle) |
| `projectGroups:list` | request-handler-matched | `src/main/ipc/repos/project-group-handlers.ts:22` (ipcMain.handle) |
| `projectGroups:moveProject` | request-handler-matched | `src/main/ipc/repos/project-group-handlers.ts:77` (ipcMain.handle) |
| `projectGroups:scanNested` | request-handler-matched | `src/main/ipc/repos/project-group-handlers.ts:90` (ipcMain.handle) |
| `projectGroups:update` | request-handler-matched | `src/main/ipc/repos/project-group-handlers.ts:41` (ipcMain.handle) |
| `projectHostSetups:create` | request-handler-matched | `src/main/ipc/repos/project-host-setup-handlers.ts:81` (ipcMain.handle) |
| `projectHostSetups:delete` | request-handler-matched | `src/main/ipc/repos/project-host-setup-handlers.ts:119` (ipcMain.handle) |
| `projectHostSetups:list` | request-handler-matched | `src/main/ipc/repos/repo-catalog-handlers.ts:49` (ipcMain.handle) |
| `projectHostSetups:setupExistingFolder` | request-handler-matched | `src/main/ipc/repos/project-host-setup-handlers.ts:136` (ipcMain.handle) |
| `projectHostSetups:update` | request-handler-matched | `src/main/ipc/repos/project-host-setup-handlers.ts:98` (ipcMain.handle) |
| `projects:list` | request-handler-matched | `src/main/ipc/repos/repo-catalog-handlers.ts:35` (ipcMain.handle) |
| `projects:update` | request-handler-matched | `src/main/ipc/repos/repo-catalog-handlers.ts:40` (ipcMain.handle) |
| `pty:clearPendingPaneSerializer` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:267` (ipcMain.handle) |
| `pty:confirmForegroundProcess` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:200` (ipcMain.handle) |
| `pty:declarePendingPaneSerializer` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:241` (ipcMain.handle) |
| `pty:getAuthoritativeBufferSnapshotCapabilities` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:75` (ipcMain.handle) |
| `pty:getCwd` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:213` (ipcMain.handle) |
| `pty:getForegroundProcess` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:161` (ipcMain.handle) |
| `pty:getMainBufferSnapshot` | request-handler-matched | `src/main/ipc/pty/ipc/snapshot.ts:27` (ipcMain.handle) |
| `pty:getRendererDeliveryDebugSnapshot` | request-handler-matched | `src/main/ipc/pty/ipc/snapshot.ts:100` (ipcMain.handle) |
| `pty:getSize` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:222` (ipcMain.handle) |
| `pty:hasChildProcesses` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:151` (ipcMain.handle) |
| `pty:hasPty` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:123` (ipcMain.handle) |
| `pty:inspectProcess` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:171` (ipcMain.handle) |
| `pty:kill` | request-handler-matched | `src/main/ipc/pty/ipc/renderer-kill.ts:39` (ipcMain.handle) |
| `pty:listSessions` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:43` (ipcMain.handle) |
| `pty:reportRendererDeliveryState` | request-handler-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:150` (ipcMain.handle) |
| `pty:reportRendererSerializerReady` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:278` (ipcMain.handle) |
| `pty:resetRendererDeliveryDebug` | request-handler-matched | `src/main/ipc/pty/ipc/snapshot.ts:103` (ipcMain.handle) |
| `pty:settlePaneSerializer` | request-handler-matched | `src/main/ipc/pty/ipc/inspect.ts:251` (ipcMain.handle) |
| `pty:sideEffectSnapshot` | request-handler-matched | `src/main/ipc/pty/ipc/snapshot.ts:92` (ipcMain.handle) |
| `pty:spawn` | request-handler-matched | `src/main/ipc/pty/ipc/spawn.ts:9` (ipcMain.handle) |
| `pty:writeAccepted` | request-handler-matched | `src/main/ipc/pty/ipc/write.ts:34` (ipcMain.handle) |
| `pwsh:isAvailable` | request-handler-matched | `src/main/ipc/app.ts:270` (ipcMain.handle) |
| `rateLimits:consumeCodexResetCredit` | request-handler-matched | `src/main/ipc/rate-limits.ts:16` (ipcMain.handle) |
| `rateLimits:fetchInactiveClaudeAccounts` | request-handler-matched | `src/main/ipc/rate-limits.ts:25` (ipcMain.handle) |
| `rateLimits:fetchInactiveCodexAccounts` | request-handler-matched | `src/main/ipc/rate-limits.ts:28` (ipcMain.handle) |
| `rateLimits:get` | request-handler-matched | `src/main/ipc/rate-limits.ts:10` (ipcMain.handle) |
| `rateLimits:refresh` | request-handler-matched | `src/main/ipc/rate-limits.ts:11` (ipcMain.handle) |
| `rateLimits:refreshClaudeForTarget` | request-handler-matched | `src/main/ipc/rate-limits.ts:19` (ipcMain.handle) |
| `rateLimits:refreshCodexForTarget` | request-handler-matched | `src/main/ipc/rate-limits.ts:12` (ipcMain.handle) |
| `rateLimits:refreshGrok` | request-handler-matched | `src/main/ipc/rate-limits.ts:32` (ipcMain.handle) |
| `rateLimits:refreshMiniMax` | request-handler-matched | `src/main/ipc/rate-limits.ts:31` (ipcMain.handle) |
| `rateLimits:setPollingInterval` | request-handler-matched | `src/main/ipc/rate-limits.ts:22` (ipcMain.handle) |
| `remoteWorkspace:clientId` | request-handler-matched | `src/main/ipc/remote-workspace.ts:335` (ipcMain.handle) |
| `remoteWorkspace:get` | request-handler-matched | `src/main/ipc/remote-workspace.ts:231` (ipcMain.handle) |
| `remoteWorkspace:listConnectedClients` | request-handler-matched | `src/main/ipc/remote-workspace.ts:330` (ipcMain.handle) |
| `remoteWorkspace:listEnabledConnectedTargets` | request-handler-matched | `src/main/ipc/remote-workspace.ts:321` (ipcMain.handle) |
| `remoteWorkspace:setForConnectedTargets` | request-handler-matched | `src/main/ipc/remote-workspace.ts:239` (ipcMain.handle) |
| `repos:add` | request-handler-matched | `src/main/ipc/repos/repo-creation-handlers.ts:69` (ipcMain.handle) |
| `repos:addRemote` | request-handler-matched | `src/main/ipc/repos/repo-creation-handlers.ts:89` (ipcMain.handle) |
| `repos:clone` | request-handler-matched | `src/main/ipc/repos/repo-clone-lifecycle.ts:116` (ipcMain.handle) |
| `repos:cloneAbort` | request-handler-matched | `src/main/ipc/repos/repo-clone-lifecycle.ts:101` (ipcMain.handle) |
| `repos:cloneRemote` | request-handler-matched | `src/main/ipc/repos/repo-clone-lifecycle.ts:294` (ipcMain.handle) |
| `repos:create` | request-handler-matched | `src/main/ipc/repos/repo-creation-handlers.ts:131` (ipcMain.handle) |
| `repos:createRemote` | request-handler-matched | `src/main/ipc/repos/repo-creation-handlers.ts:110` (ipcMain.handle) |
| `repos:getBaseRefDefault` | request-handler-matched | `src/main/ipc/repos/base-ref-query-handlers.ts:27` (ipcMain.handle) |
| `repos:getDefaultCreateProjectParent` | request-handler-matched | `src/main/ipc/repos/repo-creation-handlers.ts:67` (ipcMain.handle) |
| `repos:getGitUsername` | request-handler-matched | `src/main/ipc/repos/repo-git-username-handler.ts:8` (ipcMain.handle) |
| `repos:isGitAvailable` | request-handler-matched | `src/main/ipc/repos/repo-creation-handlers.ts:66` (ipcMain.handle) |
| `repos:list` | request-handler-matched | `src/main/ipc/repos/repo-catalog-handlers.ts:22` (ipcMain.handle) |
| `repos:listForExecutionHost` | request-handler-matched | `src/main/ipc/repos/repo-catalog-handlers.ts:29` (ipcMain.handle) |
| `repos:pickDirectory` | request-handler-matched | `src/main/ipc/repos/repo-folder-picker-handlers.ts:26` (ipcMain.handle) |
| `repos:pickFolder` | request-handler-matched | `src/main/ipc/repos/repo-folder-picker-handlers.ts:5` (ipcMain.handle) |
| `repos:pickFolders` | request-handler-matched | `src/main/ipc/repos/repo-folder-picker-handlers.ts:15` (ipcMain.handle) |
| `repos:remove` | request-handler-matched | `src/main/ipc/repos/repo-catalog-handlers.ts:88` (ipcMain.handle) |
| `repos:removeForHost` | request-handler-matched | `src/main/ipc/repos/repo-catalog-handlers.ts:95` (ipcMain.handle) |
| `repos:reorder` | request-handler-matched | `src/main/ipc/repos/repo-catalog-handlers.ts:54` (ipcMain.handle) |
| `repos:reorderForHost` | request-handler-matched | `src/main/ipc/repos/repo-catalog-handlers.ts:68` (ipcMain.handle) |
| `repos:searchBaseRefDetails` | request-handler-matched | `src/main/ipc/repos/base-ref-query-handlers.ts:100` (ipcMain.handle) |
| `repos:searchBaseRefs` | request-handler-matched | `src/main/ipc/repos/base-ref-query-handlers.ts:90` (ipcMain.handle) |
| `repos:update` | request-handler-matched | `src/main/ipc/repos/repo-update-handler.ts:19` (ipcMain.handle) |
| `runtime:call` | request-handler-matched | `src/main/ipc/runtime.ts:59` (ipcMain.handle) |
| `runtime:getBrowserDrivers` | request-handler-matched | `src/main/ipc/runtime.ts:165` (ipcMain.handle) |
| `runtime:getBrowserRemoteViewerPages` | request-handler-matched | `src/main/ipc/runtime.ts:177` (ipcMain.handle) |
| `runtime:getClientHostedBrowserRows` | request-handler-matched | `src/main/ipc/runtime.ts:183` (ipcMain.handle) |
| `runtime:getStatus` | request-handler-matched | `src/main/ipc/runtime.ts:55` (ipcMain.handle) |
| `runtime:getTerminalDrivers` | request-handler-matched | `src/main/ipc/runtime.ts:156` (ipcMain.handle) |
| `runtime:getTerminalFitOverrides` | request-handler-matched | `src/main/ipc/runtime.ts:139` (ipcMain.handle) |
| `runtime:reclaimBrowserForDesktop` | request-handler-matched | `src/main/ipc/runtime.ts:236` (ipcMain.handle) |
| `runtime:restoreTerminalFit` | request-handler-matched | `src/main/ipc/runtime.ts:192` (ipcMain.handle) |
| `runtime:subscribe` | request-handler-matched | `src/main/ipc/runtime.ts:85` (ipcMain.handle) |
| `runtime:syncWindowGraph` | request-handler-matched | `src/main/ipc/runtime.ts:36` (ipcMain.handle) |
| `runtimeEnvironments:addFromPairingCode` | request-handler-matched | `src/main/ipc/runtime-environment-connectivity-handlers.ts:66` (ipcMain.handle) |
| `runtimeEnvironments:call` | request-handler-matched | `src/main/ipc/runtime-environment-connectivity-handlers.ts:206` (ipcMain.handle) |
| `runtimeEnvironments:connect` | request-handler-matched | `src/main/ipc/runtime-environment-connectivity-handlers.ts:127` (ipcMain.handle) |
| `runtimeEnvironments:disconnect` | request-handler-matched | `src/main/ipc/runtime-environment-connectivity-handlers.ts:117` (ipcMain.handle) |
| `runtimeEnvironments:getStatus` | request-handler-matched | `src/main/ipc/runtime-environment-connectivity-handlers.ts:163` (ipcMain.handle) |
| `runtimeEnvironments:list` | request-handler-matched | `src/main/ipc/runtime-environment-connectivity-handlers.ts:63` (ipcMain.handle) |
| `runtimeEnvironments:prepareBrowserClientHostPlacement` | request-handler-matched | `src/main/ipc/runtime-environment-browser-client-host-handler.ts:20` (ipcMain.handle) |
| `runtimeEnvironments:remove` | request-handler-matched | `src/main/ipc/runtime-environment-connectivity-handlers.ts:90` (ipcMain.handle) |
| `runtimeEnvironments:resolve` | request-handler-matched | `src/main/ipc/runtime-environment-connectivity-handlers.ts:87` (ipcMain.handle) |
| `runtimeEnvironments:retryConnectionsNow` | request-handler-matched | `src/main/ipc/runtime-environment-recovery-handler.ts:8` (ipcMain.handle) |
| `runtimeEnvironments:retryControlConnection` | request-handler-matched | `src/main/ipc/runtime-environment-connectivity-handlers.ts:138` (ipcMain.handle) |
| `runtimeEnvironments:verifyAndAddFromPairingCode` | request-handler-matched | `src/main/ipc/runtime-environment-connectivity-handlers.ts:77` (ipcMain.handle) |
| `session:flush` | request-handler-matched | `src/main/ipc/session.ts:24` (ipcMain.handle) |
| `session:get` | request-handler-matched | `src/main/ipc/session.ts:12` (ipcMain.handle) |
| `session:patch` | request-handler-matched | `src/main/ipc/session.ts:20` (ipcMain.handle) |
| `session:set` | request-handler-matched | `src/main/ipc/session.ts:16` (ipcMain.handle) |
| `settings:get` | request-handler-matched | `src/main/ipc/settings.ts:97` (ipcMain.handle) |
| `settings:listFonts` | request-handler-matched | `src/main/ipc/settings.ts:317` (ipcMain.handle) |
| `settings:previewGhosttyImport` | request-handler-matched | `src/main/ipc/settings.ts:321` (ipcMain.handle) |
| `settings:previewWarpThemeImport` | request-handler-matched | `src/main/ipc/settings.ts:325` (ipcMain.handle) |
| `settings:set` | request-handler-matched | `src/main/ipc/settings.ts:123` (ipcMain.handle) |
| `settings:set-active-runtime-environment-preference` | request-handler-matched | `src/main/ipc/settings.ts:300` (ipcMain.handle) |
| `settings:update-pr-bot-author-override` | request-handler-matched | `src/main/ipc/settings.ts:101` (ipcMain.handle) |
| `shell:copyFile` | request-handler-matched | `src/main/ipc/shell.ts:299` (ipcMain.handle) |
| `shell:openFilePath` | request-handler-matched | `src/main/ipc/shell.ts:171` (ipcMain.handle) |
| `shell:openFileUri` | request-handler-matched | `src/main/ipc/shell.ts:175` (ipcMain.handle) |
| `shell:openInExternalEditor` | request-handler-matched | `src/main/ipc/shell.ts:150` (ipcMain.handle) |
| `shell:openInFileManager` | request-handler-matched | `src/main/ipc/shell.ts:145` (ipcMain.handle) |
| `shell:openPath` | request-handler-matched | `src/main/ipc/shell.ts:139` (ipcMain.handle) |
| `shell:openUrl` | request-handler-matched | `src/main/ipc/shell.ts:156` (ipcMain.handle) |
| `shell:pathExists` | request-handler-matched | `src/main/ipc/shell.ts:207` (ipcMain.handle) |
| `shell:pickAttachment` | request-handler-matched | `src/main/ipc/shell.ts:229` (ipcMain.handle) |
| `shell:pickAudio` | request-handler-matched | `src/main/ipc/shell.ts:285` (ipcMain.handle) |
| `shell:pickDirectory` | request-handler-matched | `src/main/ipc/shell.ts:211` (ipcMain.handle) |
| `shell:pickImage` | request-handler-matched | `src/main/ipc/shell.ts:241` (ipcMain.handle) |
| `shell:pickRepoIconImage` | request-handler-matched | `src/main/ipc/shell.ts:254` (ipcMain.handle) |
| `skills:acknowledgeUpdateRun` | request-handler-unresolved | — |
| `skills:cancelInstall` | request-handler-unresolved | — |
| `skills:cancelShare` | request-handler-unresolved | — |
| `skills:cancelUpdateRun` | request-handler-unresolved | — |
| `skills:delete` | request-handler-unresolved | — |
| `skills:deletePackage` | request-handler-unresolved | — |
| `skills:deletePackageVersion` | request-handler-unresolved | — |
| `skills:discover` | request-handler-unresolved | — |
| `skills:freshnessInventory` | request-handler-unresolved | — |
| `skills:getPackage` | request-handler-unresolved | — |
| `skills:getUpdateRun` | request-handler-unresolved | — |
| `skills:installBundlePackageVersion` | request-handler-unresolved | — |
| `skills:installBundleShare` | request-handler-unresolved | — |
| `skills:installPackageVersion` | request-handler-unresolved | — |
| `skills:installShare` | request-handler-unresolved | — |
| `skills:listManagedInstalls` | request-handler-unresolved | — |
| `skills:listOwnedShares` | request-handler-unresolved | — |
| `skills:listWslDistros` | request-handler-unresolved | — |
| `skills:prepareShare` | request-handler-unresolved | — |
| `skills:previewBundleInstall` | request-handler-unresolved | — |
| `skills:previewDelete` | request-handler-unresolved | — |
| `skills:previewInstall` | request-handler-unresolved | — |
| `skills:publishShare` | request-handler-unresolved | — |
| `skills:releaseShare` | request-handler-unresolved | — |
| `skills:removeInstall` | request-handler-unresolved | — |
| `skills:resolveShare` | request-handler-unresolved | — |
| `skills:revokeShare` | request-handler-unresolved | — |
| `skills:startUpdateRun` | request-handler-unresolved | — |
| `sparsePresets:list` | request-handler-matched | `src/main/ipc/repos/sparse-preset-handlers.ts:12` (ipcMain.handle) |
| `sparsePresets:remove` | request-handler-matched | `src/main/ipc/repos/sparse-preset-handlers.ts:46` (ipcMain.handle) |
| `sparsePresets:save` | request-handler-matched | `src/main/ipc/repos/sparse-preset-handlers.ts:16` (ipcMain.handle) |
| `speech:cancelDownload` | request-handler-matched | `src/main/ipc/speech.ts:68` (ipcMain.handle) |
| `speech:clearOpenAiApiKey` | request-handler-matched | `src/main/ipc/speech.ts:33` (ipcMain.handle) |
| `speech:deleteModel` | request-handler-matched | `src/main/ipc/speech.ts:72` (ipcMain.handle) |
| `speech:downloadModel` | request-handler-matched | `src/main/ipc/speech.ts:38` (ipcMain.handle) |
| `speech:feedAudio` | request-handler-matched | `src/main/ipc/speech.ts:196` (ipcMain.handle) |
| `speech:getCatalog` | request-handler-matched | `src/main/ipc/speech.ts:16` (ipcMain.handle) |
| `speech:getModelStates` | request-handler-matched | `src/main/ipc/speech.ts:20` (ipcMain.handle) |
| `speech:getOpenAiApiKeyStatus` | request-handler-matched | `src/main/ipc/speech.ts:24` (ipcMain.handle) |
| `speech:saveOpenAiApiKey` | request-handler-matched | `src/main/ipc/speech.ts:28` (ipcMain.handle) |
| `speech:startDictation` | request-handler-matched | `src/main/ipc/speech.ts:91` (ipcMain.handle) |
| `speech:stopDictation` | request-handler-matched | `src/main/ipc/speech.ts:210` (ipcMain.handle) |
| `ssh:addPortForward` | request-handler-matched | `src/main/ipc/ssh-port-forward-handlers.ts:17` (ipcMain.handle) |
| `ssh:addTarget` | request-handler-matched | `src/main/ipc/ssh-target-crud-handlers.ts:51` (ipcMain.handle) |
| `ssh:browseDir` | request-handler-matched | `src/main/ipc/ssh-browse.ts:41` (ipcMain.handle) |
| `ssh:connect` | request-handler-matched | `src/main/ipc/ssh-connection-handlers.ts:111` (ipcMain.handle) |
| `ssh:disconnect` | request-handler-matched | `src/main/ipc/ssh-connection-handlers.ts:115` (ipcMain.handle) |
| `ssh:getState` | request-handler-matched | `src/main/ipc/ssh-connection-handlers.ts:224` (ipcMain.handle) |
| `ssh:importConfig` | request-handler-matched | `src/main/ipc/ssh-target-crud-handlers.ts:74` (ipcMain.handle) |
| `ssh:listConfigHosts` | request-handler-matched | `src/main/ipc/ssh-target-crud-handlers.ts:82` (ipcMain.handle) |
| `ssh:listDetectedPorts` | request-handler-matched | `src/main/ipc/ssh-port-forward-handlers.ts:103` (ipcMain.handle) |
| `ssh:listPortForwards` | request-handler-matched | `src/main/ipc/ssh-port-forward-handlers.ts:94` (ipcMain.handle) |
| `ssh:listRemovedTargetLabels` | request-handler-matched | `src/main/ipc/ssh-target-crud-handlers.ts:47` (ipcMain.handle) |
| `ssh:listTargets` | request-handler-matched | `src/main/ipc/ssh-target-crud-handlers.ts:43` (ipcMain.handle) |
| `ssh:needsPassphrasePrompt` | request-handler-matched | `src/main/ipc/ssh-connection-handlers.ts:229` (ipcMain.handle) |
| `ssh:removePortForward` | request-handler-matched | `src/main/ipc/ssh-port-forward-handlers.ts:85` (ipcMain.handle) |
| `ssh:removeTarget` | request-handler-matched | `src/main/ipc/ssh-target-crud-handlers.ts:70` (ipcMain.handle) |
| `ssh:resetRelay` | request-handler-matched | `src/main/ipc/ssh-connection-handlers.ts:199` (ipcMain.handle) |
| `ssh:resolveConfigHost` | request-handler-matched | `src/main/ipc/ssh-target-crud-handlers.ts:91` (ipcMain.handle) |
| `ssh:submitCredential` | request-handler-matched | `src/main/ipc/ssh-passphrase.ts:55` (ipcMain.handle) |
| `ssh:terminateSessions` | request-handler-matched | `src/main/ipc/ssh-connection-handlers.ts:119` (ipcMain.handle) |
| `ssh:testConnection` | request-handler-matched | `src/main/ipc/ssh-connection-handlers.ts:238` (ipcMain.handle) |
| `ssh:updatePortForward` | request-handler-matched | `src/main/ipc/ssh-port-forward-handlers.ts:47` (ipcMain.handle) |
| `ssh:updateTarget` | request-handler-matched | `src/main/ipc/ssh-target-crud-handlers.ts:60` (ipcMain.handle) |
| `star-nag:agentValueMoment` | request-handler-matched | `src/main/star-nag/service.ts:85` (ipcMain.handle) |
| `star-nag:complete` | request-handler-matched | `src/main/star-nag/service.ts:80` (ipcMain.handle) |
| `star-nag:disable` | request-handler-matched | `src/main/star-nag/service.ts:81` (ipcMain.handle) |
| `star-nag:dismiss` | request-handler-matched | `src/main/star-nag/service.ts:78` (ipcMain.handle) |
| `star-nag:forceShow` | request-handler-matched | `src/main/star-nag/service.ts:84` (ipcMain.handle) |
| `star-nag:later` | request-handler-matched | `src/main/star-nag/service.ts:79` (ipcMain.handle) |
| `star-nag:onboardingCompleted` | request-handler-matched | `src/main/star-nag/service.ts:87` (ipcMain.handle) |
| `star-nag:openWeb` | request-handler-matched | `src/main/star-nag/service.ts:82` (ipcMain.handle) |
| `star-nag:showAgentValueMoment` | request-handler-matched | `src/main/star-nag/service.ts:86` (ipcMain.handle) |
| `star-nag:starOrca` | request-handler-matched | `src/main/star-nag/service.ts:83` (ipcMain.handle) |
| `stats:summary` | request-handler-matched | `src/main/ipc/stats.ts:5` (ipcMain.handle) |
| `telemetry:acknowledgeBanner` | request-handler-matched | `src/main/ipc/telemetry.ts:110` (ipcMain.handle) |
| `telemetry:getConsentState` | request-handler-matched | `src/main/ipc/telemetry.ts:102` (ipcMain.handle) |
| `telemetry:setOptIn` | request-handler-matched | `src/main/ipc/telemetry.ts:83` (ipcMain.handle) |
| `telemetry:track` | request-handler-matched | `src/main/ipc/telemetry.ts:57` (ipcMain.handle) |
| `terminal:writeRenderDesyncEvidence` | request-handler-matched | `src/main/ipc/terminal-render-desync-evidence.ts:20` (ipcMain.handle) |
| `terminalPreview:ack` | request-handler-matched | `src/main/ipc/terminal-preview.ts:179` (ipcMain.handle) |
| `terminalPreview:connect` | request-handler-matched | `src/main/ipc/terminal-preview.ts:87` (ipcMain.handle) |
| `terminalPreview:fit` | request-handler-matched | `src/main/ipc/terminal-preview.ts:200` (ipcMain.handle) |
| `terminalPreview:input` | request-handler-matched | `src/main/ipc/terminal-preview.ts:165` (ipcMain.handle) |
| `terminalPreview:unsubscribe` | request-handler-matched | `src/main/ipc/terminal-preview.ts:253` (ipcMain.handle) |
| `ui:consumePendingMarkdownFileOpens` | request-handler-matched | `src/main/startup/main-process-ipc-bootstrap.ts:50` (ipcMain.handle) |
| `ui:consumePendingOpenSettings` | request-handler-matched | `src/main/startup/main-process-ipc-bootstrap.ts:43` (ipcMain.handle) |
| `ui:consumePendingSkillShare` | request-handler-matched | `src/main/startup/main-process-ipc-bootstrap.ts:46` (ipcMain.handle) |
| `ui:get` | request-handler-matched | `src/main/ipc/ui.ts:62` (ipcMain.handle) |
| `ui:recordFeatureInteraction` | request-handler-matched | `src/main/ipc/ui.ts:70` (ipcMain.handle) |
| `ui:set` | request-handler-matched | `src/main/ipc/ui.ts:66` (ipcMain.handle) |
| `updater:check` | request-handler-matched | `src/main/window/main-window-updater.ts:96` (ipcMain.handle) |
| `updater:dismissAvailableUpdate` | request-handler-matched | `src/main/window/main-window-updater.ts:103` (ipcMain.handle) |
| `updater:dismissNudge` | request-handler-matched | `src/main/window/main-window-updater.ts:102` (ipcMain.handle) |
| `updater:download` | request-handler-matched | `src/main/window/main-window-updater.ts:100` (ipcMain.handle) |
| `updater:getLinuxPackageInstallInstructions` | request-handler-matched | `src/main/window/main-window-updater.ts:106` (ipcMain.handle) |
| `updater:getStatus` | request-handler-matched | `src/main/window/main-window-updater.ts:94` (ipcMain.handle) |
| `updater:getVersion` | request-handler-matched | `src/main/window/main-window-updater.ts:95` (ipcMain.handle) |
| `updater:listBuilds` | request-handler-matched | `src/main/window/main-window-updater.ts:114` (ipcMain.handle) |
| `updater:quitAndInstall` | request-handler-matched | `src/main/window/main-window-updater.ts:101` (ipcMain.handle) |
| `updater:showLinuxPackage` | request-handler-matched | `src/main/window/main-window-updater.ts:110` (ipcMain.handle) |
| `window:isMaximized` | request-handler-unresolved | — |
| `workspaceCleanup:beginRemovalSnapshotPruneBatch` | request-handler-matched | `src/main/ipc/workspace-cleanup.ts:149` (ipcMain.handle) |
| `workspaceCleanup:cancelScan` | request-handler-matched | `src/main/ipc/workspace-cleanup.ts:105` (ipcMain.handle) |
| `workspaceCleanup:clearDismissals` | request-handler-matched | `src/main/ipc/workspace-cleanup.ts:145` (ipcMain.handle) |
| `workspaceCleanup:dismiss` | request-handler-matched | `src/main/ipc/workspace-cleanup.ts:119` (ipcMain.handle) |
| `workspaceCleanup:finishRemovalSnapshotPruneBatch` | request-handler-matched | `src/main/ipc/workspace-cleanup.ts:172` (ipcMain.handle) |
| `workspaceCleanup:getCachedScan` | request-handler-matched | `src/main/ipc/workspace-cleanup.ts:115` (ipcMain.handle) |
| `workspaceCleanup:recordRemovalSnapshotPrune` | request-handler-matched | `src/main/ipc/workspace-cleanup.ts:158` (ipcMain.handle) |
| `workspaceCleanup:scan` | request-handler-matched | `src/main/ipc/workspace-cleanup.ts:50` (ipcMain.handle) |
| `workspacePorts:kill` | request-handler-matched | `src/main/ipc/workspace-ports.ts:68` (ipcMain.handle) |
| `workspacePorts:scan` | request-handler-matched | `src/main/ipc/workspace-ports.ts:43` (ipcMain.handle) |
| `workspaceSpace:analyze` | request-handler-matched | `src/main/ipc/workspace-space.ts:33` (ipcMain.handle) |
| `workspaceSpace:cancel` | request-handler-matched | `src/main/ipc/workspace-space.ts:121` (ipcMain.handle) |
| `workspaceSpace:getCachedAnalysis` | request-handler-matched | `src/main/ipc/workspace-space.ts:117` (ipcMain.handle) |
| `worktrees:adoptProvisionedRoot` | request-handler-matched | `src/main/ipc/worktrees/create/register-worktree-create-handlers.ts:119` (ipcMain.handle) |
| `worktrees:cancelListDetected` | request-handler-matched | `src/main/ipc/worktrees/listing/register-detected-worktree-handlers.ts:128` (ipcMain.handle) |
| `worktrees:create` | request-handler-matched | `src/main/ipc/worktrees/create/register-worktree-create-handlers.ts:38` (ipcMain.handle) |
| `worktrees:forceDeletePreservedBranch` | request-handler-matched | `src/main/ipc/worktrees/removal/register-worktree-forget-handlers.ts:151` (ipcMain.handle) |
| `worktrees:forgetLocal` | request-handler-matched | `src/main/ipc/worktrees/removal/register-worktree-forget-handlers.ts:42` (ipcMain.handle) |
| `worktrees:forgetRemovedForExecutionHost` | request-handler-matched | `src/main/ipc/worktrees/listing/register-host-catalog-handlers.ts:94` (ipcMain.handle) |
| `worktrees:getBranchRenameFailureOutput` | request-handler-matched | `src/main/ipc/worktrees/metadata/register-worktree-metadata-handlers.ts:106` (ipcMain.handle) |
| `worktrees:list` | request-handler-matched | `src/main/ipc/worktrees/listing/register-worktree-catalog-handlers.ts:170` (ipcMain.handle) |
| `worktrees:listAll` | request-handler-matched | `src/main/ipc/worktrees/listing/register-worktree-catalog-handlers.ts:57` (ipcMain.handle) |
| `worktrees:listDetected` | request-handler-matched | `src/main/ipc/worktrees/listing/register-detected-worktree-handlers.ts:29` (ipcMain.handle) |
| `worktrees:listKnownForExecutionHost` | request-handler-matched | `src/main/ipc/worktrees/listing/register-host-catalog-handlers.ts:31` (ipcMain.handle) |
| `worktrees:listLineage` | request-handler-matched | `src/main/ipc/worktrees/metadata/register-worktree-metadata-handlers.ts:62` (ipcMain.handle) |
| `worktrees:listLineageForHost` | request-handler-matched | `src/main/ipc/worktrees/metadata/register-worktree-metadata-handlers.ts:70` (ipcMain.handle) |
| `worktrees:listRetiredNames` | request-handler-matched | `src/main/ipc/worktrees/listing/register-worktree-catalog-handlers.ts:162` (ipcMain.handle) |
| `worktrees:persistSortOrder` | request-handler-matched | `src/main/ipc/worktrees/metadata/register-worktree-metadata-handlers.ts:92` (ipcMain.handle) |
| `worktrees:prefetchCreateBase` | request-handler-matched | `src/main/ipc/worktrees/create/register-worktree-prefetch-handler.ts:10` (ipcMain.handle) |
| `worktrees:remove` | request-handler-matched | `src/main/ipc/worktrees/removal/register-worktree-removal-handlers.ts:18` (ipcMain.handle) |
| `worktrees:resolveMrBase` | request-handler-matched | `src/main/ipc/worktrees/create/register-review-base-handlers.ts:96` (ipcMain.handle) |
| `worktrees:resolvePrBase` | request-handler-matched | `src/main/ipc/worktrees/create/register-review-base-handlers.ts:21` (ipcMain.handle) |
| `worktrees:updateLineage` | request-handler-matched | `src/main/ipc/worktrees/metadata/register-worktree-metadata-handlers.ts:76` (ipcMain.handle) |
| `worktrees:updateMeta` | request-handler-matched | `src/main/ipc/worktrees/metadata/register-worktree-metadata-handlers.ts:21` (ipcMain.handle) |
| `wsl:isAvailable` | request-handler-matched | `src/main/ipc/app.ts:268` (ipcMain.handle) |
| `wsl:listDistros` | request-handler-matched | `src/main/ipc/app.ts:269` (ipcMain.handle) |

### Fire-and-forget channels (send/sendSync) vs. ipcMain.on/once

| Preload channel | Status | Main registration(s) |
|---|---|---|
| `agentStatus:drop` | fire-and-forget-listener-matched | `src/main/ipc/agent-status-row-teardown-ipc.ts:29` (ipcMain.on) |
| `agentStatus:dropByTabPrefix` | fire-and-forget-listener-matched | `src/main/ipc/agent-status-row-teardown-ipc.ts:94` (ipcMain.on) |
| `agentStatus:dropPersisted` | fire-and-forget-listener-matched | `src/main/ipc/agent-status-row-teardown-ipc.ts:45` (ipcMain.on) |
| `agentStatus:dropPersistedBatch` | fire-and-forget-listener-matched | `src/main/ipc/agent-status-row-teardown-ipc.ts:58` (ipcMain.on) |
| `agentStatus:reconcileEndedProcess` | fire-and-forget-listener-matched | `src/main/ipc/agent-status-row-teardown-ipc.ts:75` (ipcMain.on) |
| `agentStatus:restorePaneAuthority` | fire-and-forget-listener-matched | `src/main/ipc/agent-pane-authority-ipc.ts:17` (ipcMain.on) |
| `agentStatus:retirePaneAuthority` | fire-and-forget-listener-matched | `src/main/ipc/agent-pane-authority-ipc.ts:27` (ipcMain.on) |
| `agentStatus:transferPaneAuthority` | fire-and-forget-listener-matched | `src/main/ipc/agent-pane-authority-ipc.ts:38` (ipcMain.on) |
| `app:stage-before-unload-sync` | fire-and-forget-listener-matched | `src/main/ipc/renderer-shutdown-checkpoint.ts:48` (ipcMain.on) |
| `browser:reportViewportScrollState` | fire-and-forget-listener-unresolved | — |
| `browser:tabCloseReply` | fire-and-forget-listener-matched | `src/main/runtime/runtime-browser-commands-browser-tab-close.ts:168` (ipcMain.on) |
| `browser:tabCreateReply` | fire-and-forget-listener-matched | `src/main/runtime/runtime-browser-commands-list-logical-browser-tabs.ts:133` (ipcMain.on) |
| `browser:tabSetProfileReply` | fire-and-forget-listener-matched | `src/main/runtime/runtime-browser-commands-browser-tab-set-profile.ts:78` (ipcMain.on) |
| `crashReports:recordBreadcrumb` | fire-and-forget-listener-matched | `src/main/ipc/crash-reporting.ts:66` (ipcMain.on) |
| `menu:popup` | fire-and-forget-listener-unresolved | — |
| `nativeChat:subscribe` | fire-and-forget-listener-matched | `src/main/ipc/native-chat.ts:309` (ipcMain.on) |
| `nativeChat:unsubscribe` | fire-and-forget-listener-matched | `src/main/ipc/native-chat.ts:312` (ipcMain.on) |
| `pty:ackColdRestore` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:89` (ipcMain.on) |
| `pty:ackData` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:98` (ipcMain.on) |
| `pty:claimViewport` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/write.ts:45` (ipcMain.on) |
| `pty:clearBuffer` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:332` (ipcMain.on) |
| `pty:deliveryResyncResponse` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:121` (ipcMain.on) |
| `pty:rendererDispatcherReady` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:195` (ipcMain.on) |
| `pty:reportGeometry` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:83` (ipcMain.on) |
| `pty:resize` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:42` (ipcMain.on) |
| `pty:serializeBuffer:response` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/serialize-buffer.ts:24` (ipcMain.on) |
| `pty:setActiveRendererPty` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:212` (ipcMain.on) |
| `pty:setHiddenRendererPty` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:245` (ipcMain.on) |
| `pty:setPtyDeliveryInterest` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:311` (ipcMain.on) |
| `pty:setRendererPtyVisible` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:229` (ipcMain.on) |
| `pty:signal` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:325` (ipcMain.on) |
| `pty:terminalViewAttributes` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/resize-visibility.ts:302` (ipcMain.on) |
| `pty:write` | fire-and-forget-listener-matched | `src/main/ipc/pty/ipc/write.ts:23` (ipcMain.on) |
| `rich-markdown:context-target` | fire-and-forget-listener-matched | `src/main/window/main-window-focus-lifecycle.ts:100` (ipcMain.on) |
| `runtime:unsubscribe` | fire-and-forget-listener-matched | `src/main/ipc/runtime.ts:132` (ipcMain.on) |
| `session:read-terminal-scrollback-sync` | fire-and-forget-listener-matched | `src/main/ipc/session.ts:40` (ipcMain.on) |
| `session:set-sync` | fire-and-forget-listener-matched | `src/main/ipc/session.ts:34` (ipcMain.on) |
| `settings:get-sync` | fire-and-forget-listener-matched | `src/main/ipc/settings.ts:119` (ipcMain.on) |
| `terminal:tabCreateReply` | fire-and-forget-listener-matched | `src/main/window/runtime-window-lifecycle.ts:116` (ipcMain.on) |
| `ui:mobileMarkdownResponse` | fire-and-forget-listener-matched | `src/main/window/mobile-markdown-request-relay.ts:51` (ipcMain.on) |
| `ui:performNativePaste` | fire-and-forget-listener-matched | `src/main/ipc/ui.ts:78` (ipcMain.on) |
| `ui:performNativeSelectionAction` | fire-and-forget-listener-matched | `src/main/ipc/ui.ts:93` (ipcMain.on) |
| `ui:sessionTabCloseResponse` | fire-and-forget-listener-matched | `src/main/window/session-tab-close-request-relay.ts:56` (ipcMain.on) |
| `ui:setFloatingFocus` | fire-and-forget-listener-unresolved | — |
| `ui:setMarkdownEditorFocused` | fire-and-forget-listener-unresolved | — |
| `ui:setShortcutRecorderFocused` | fire-and-forget-listener-unresolved | — |
| `ui:setTerminalInputFocused` | fire-and-forget-listener-unresolved | — |
| `ui:sync-traffic-lights` | fire-and-forget-listener-unresolved | — |
| `ui:terminalTabCloseResponse` | fire-and-forget-listener-matched | `src/main/window/terminal-tab-close-request-relay.ts:40` (ipcMain.on) |
| `ui:window-revealed` | fire-and-forget-listener-matched | `src/main/window/main-window-visual-lifecycle.ts:82` (ipcMain.on) |
| `window:close-request-received` | fire-and-forget-listener-unresolved | — |
| `window:confirm-close` | fire-and-forget-listener-unresolved | — |
| `window:maximize` | fire-and-forget-listener-unresolved | — |
| `window:minimize` | fire-and-forget-listener-unresolved | — |
| `window:request-close` | fire-and-forget-listener-unresolved | — |

### Push-event channels (on/once) vs. webContents.send

| Preload channel | Status | Main registration(s) |
|---|---|---|
| `agentAwake:changed` | push-producer-matched | `src/main/ipc/settings.ts:82` (webContents.send) |
| `agentStatus:clear` | push-producer-unresolved | — |
| `agentStatus:legacyWorkerTerminalRecovery` | push-producer-unresolved | — |
| `agentStatus:migrationUnsupported` | push-producer-unresolved | — |
| `agentStatus:migrationUnsupportedClear` | push-producer-unresolved | — |
| `agentStatus:set` | push-producer-unresolved | — |
| `aiVault:windowFocused` | push-producer-matched | `src/main/ipc/ai-vault.ts:326` (webContents.send) |
| `app:keyboardLayoutChanged` | push-producer-matched | `src/main/ipc/macos-keyboard-layout-change-notifications.ts:23` (webContents.send) |
| `automations:changed` | push-producer-unresolved | — |
| `automations:dispatchRequested` | push-producer-unresolved | — |
| `browser:activateView` | push-producer-matched | `src/main/runtime/runtime-browser-commands-active-screencasts-by-page-id.ts:162` (webContents.send); `src/main/runtime/runtime-browser-commands-active-screencasts-by-page-id.ts:172` (webContents.send) |
| `browser:certificate-failure-changed` | push-producer-unresolved | — |
| `browser:context-menu-dismissed` | push-producer-unresolved | — |
| `browser:context-menu-requested` | push-producer-unresolved | — |
| `browser:download-finished` | push-producer-unresolved | — |
| `browser:download-progress` | push-producer-unresolved | — |
| `browser:download-requested` | push-producer-unresolved | — |
| `browser:grabActionShortcut` | push-producer-unresolved | — |
| `browser:grabModeToggle` | push-producer-unresolved | — |
| `browser:guest-load-failed` | push-producer-unresolved | — |
| `browser:navigation-update` | push-producer-matched | `src/main/runtime/runtime-browser-commands-active-screencasts-by-page-id.ts:183` (webContents.send) |
| `browser:open-link-in-orca-tab` | push-producer-unresolved | — |
| `browser:pane-focus` | push-producer-matched | `src/main/runtime/runtime-browser-commands-active-screencasts-by-page-id.ts:196` (webContents.send) |
| `browser:permission-denied` | push-producer-unresolved | — |
| `browser:popup` | push-producer-unresolved | — |
| `browser:requestTabClose` | push-producer-matched | `src/main/runtime/runtime-browser-commands-browser-tab-close.ts:170` (webContents.send) |
| `browser:requestTabCreate` | push-producer-matched | `src/main/runtime/runtime-browser-commands-list-logical-browser-tabs.ts:134` (webContents.send) |
| `browser:requestTabSetProfile` | push-producer-matched | `src/main/runtime/runtime-browser-commands-browser-tab-set-profile.ts:79` (webContents.send) |
| `browser:webauthn-account-request-closed` | push-producer-unresolved | — |
| `browser:webauthn-account-requested` | push-producer-unresolved | — |
| `createWorktree:progress` | push-producer-matched | `src/main/ipc/worktree-remote.ts:1836` (webContents.send) |
| `dashboard:popoutOpenChanged` | push-producer-unresolved | — |
| `dashboard:snapshot` | push-producer-unresolved | — |
| `dashboard:snapshotRequested` | push-producer-unresolved | — |
| `dashboard:viewRequested` | push-producer-matched | `src/main/window/dashboard-popout-window.ts:153` (webContents.send) |
| `docPreview:externalLink` | push-producer-unresolved | — |
| `docPreview:loadFailure` | push-producer-unresolved | — |
| `emulator:frameStreamError` | push-producer-unresolved | — |
| `emulator:frameStreamFrame` | push-producer-unresolved | — |
| `emulator:pane-focus` | push-producer-unresolved | — |
| `emulator:videoStreamFrame` | push-producer-unresolved | — |
| `emulator:videoStreamMeta` | push-producer-unresolved | — |
| `ephemeralVm:provisionEvent` | push-producer-unresolved | — |
| `export:requestPdf` | push-producer-unresolved | — |
| `fs:changed` | push-producer-unresolved | — |
| `fs:localLogTailChanged` | push-producer-unresolved | — |
| `gh:prRefreshEvent` | push-producer-unresolved | — |
| `gh:workItemMutated` | push-producer-unresolved | — |
| `keybindings:changed` | push-producer-matched | `src/main/ipc/keybindings.ts:10` (webContents.send) |
| `macosTccPrompts:threshold` | push-producer-matched | `src/main/macos-tcc-prompt-notice.ts:177` (webContents.send) |
| `mobile:relayStatusChanged` | push-producer-unresolved | — |
| `mobile:unpairedDeviceAuthFailure` | push-producer-matched | `src/main/startup/main-process-runtime-launch.ts:113` (webContents.send) |
| `nativeChat:appended` | push-producer-unresolved | — |
| `plugins:changed` | push-producer-matched | `src/main/startup/main-process-plugins.ts:147` (webContents.send) |
| `projectGroups:scanNestedProgress` | push-producer-unresolved | — |
| `pty:clearBuffer:request` | push-producer-matched | `src/main/ipc/pty/runtime/operations.ts:166` (webContents.send) |
| `pty:data` | push-producer-matched | `src/main/ipc/pty/delivery/payload.ts:81` (webContents.send); `src/main/startup/synthetic-title-runtime.ts:52` (webContents.send) |
| `pty:exit` | push-producer-matched | `src/main/ipc/pty/delivery/exit.ts:148` (webContents.send); `src/main/ssh/ssh-relay-session.ts:2290` (webContents.send); `src/main/ssh/ssh-relay-session.ts:2923` (webContents.send) |
| `pty:modelRestoreNeeded` | push-producer-matched | `src/main/ipc/pty/delivery/payload.ts:45` (webContents.send) |
| `pty:replay` | push-producer-matched | `src/main/ssh/ssh-relay-session.ts:1825` (webContents.send); `src/main/ssh/ssh-relay-session.ts:2300` (webContents.send) |
| `pty:requestDeliveryResync` | push-producer-matched | `src/main/ipc/pty/delivery/accounting.ts:158` (webContents.send) |
| `pty:serializeBuffer:request` | push-producer-matched | `src/main/ipc/pty/ipc/serialize-buffer.ts:109` (webContents.send) |
| `pty:sideEffect` | push-producer-matched | `src/main/startup/main-process-runtime-service.ts:75` (webContents.send) |
| `pty:spawned` | push-producer-matched | `src/main/ipc/pty/delivery/exit.ts:175` (webContents.send) |
| `pty:writeUnavailable` | push-producer-matched | `src/main/ipc/pty/agent-session-write-refusal-report.ts:19` (webContents.send); `src/main/ipc/pty/ipc/write-input.ts:62` (webContents.send); `src/main/ipc/pty/provider/bind-listeners.ts:37` (webContents.send) |
| `rateLimits:update` | push-producer-matched | `src/main/rate-limits/service/service-state.ts:163` (webContents.send) |
| `remoteWorkspace:changed` | push-producer-matched | `src/main/ipc/remote-workspace.ts:177` (webContents.send) |
| `repos:changed` | push-producer-matched | `src/main/ipc/repos/repos-changed-notification.ts:18` (webContents.send); `src/main/ipc/ssh-target-crud-handlers.ts:32` (webContents.send) |
| `repos:clone-progress` | push-producer-matched | `src/main/ipc/repos/remote-repo-clone.ts:95` (webContents.send); `src/main/ipc/repos/repo-clone-lifecycle.ts:51` (webContents.send) |
| `rich-markdown:context-command` | push-producer-unresolved | — |
| `runtime:browserDriverChanged` | push-producer-unresolved | — |
| `runtime:browserRemoteViewersChanged` | push-producer-unresolved | — |
| `runtime:clientHostedBrowserRowsChanged` | push-producer-unresolved | — |
| `runtime:nativeChatLaunchDraftResolved` | push-producer-unresolved | — |
| `runtime:terminalDriverChanged` | push-producer-unresolved | — |
| `runtime:terminalFitOverrideChanged` | push-producer-unresolved | — |
| `runtimeEnvironments:sharedControlDiagnostics` | push-producer-matched | `src/main/ipc/runtime-environment-diagnostics-broadcast.ts:21` (webContents.send) |
| `settings:changed` | push-producer-matched | `src/main/ipc/settings.ts:92` (webContents.send) |
| `skills:installProgress` | push-producer-unresolved | — |
| `skills:shareProgress` | push-producer-matched | `src/main/ipc/skill-cloud-ipc-handlers.ts:79` (webContents.send) |
| `skills:updateRun` | push-producer-matched | `src/main/ipc/skills.ts:61` (webContents.send) |
| `sparsePresets:changed` | push-producer-matched | `src/main/ipc/repos/sparse-preset-handlers.ts:58` (webContents.send) |
| `speech:downloadProgress` | push-producer-matched | `src/main/ipc/speech.ts:46` (webContents.send) |
| `speech:error` | push-producer-matched | `src/main/ipc/speech.ts:172` (webContents.send) |
| `speech:final` | push-producer-matched | `src/main/ipc/speech.ts:165` (webContents.send) |
| `speech:partial` | push-producer-matched | `src/main/ipc/speech.ts:162` (webContents.send) |
| `speech:ready` | push-producer-matched | `src/main/ipc/speech.ts:159` (webContents.send) |
| `speech:stopped` | push-producer-matched | `src/main/ipc/speech.ts:169` (webContents.send) |
| `ssh:credential-request` | push-producer-matched | `src/main/ipc/ssh-passphrase.ts:46` (webContents.send) |
| `ssh:credential-resolved` | push-producer-matched | `src/main/ipc/ssh-passphrase.ts:12` (webContents.send) |
| `ssh:detected-ports-changed` | push-producer-matched | `src/main/ipc/ssh-renderer-broadcast.ts:108` (webContents.send); `src/main/ssh/ssh-relay-session.ts:1745` (webContents.send) |
| `ssh:port-forwards-changed` | push-producer-matched | `src/main/ipc/ssh-renderer-broadcast.ts:92` (webContents.send); `src/main/ssh/ssh-relay-session.ts:1741` (webContents.send) |
| `ssh:state-changed` | push-producer-matched | `src/main/ipc/ssh-renderer-broadcast.ts:40` (webContents.send) |
| `star-nag:hide` | push-producer-matched | `src/main/star-nag/service.ts:195` (webContents.send) |
| `star-nag:show` | push-producer-matched | `src/main/star-nag/service.ts:184` (webContents.send) |
| `system:resumed` | push-producer-matched | `src/main/system-resume-broadcast.ts:61` (webContents.send); `src/main/window/createMainWindow.ts:160` (webContents.send) |
| `terminal:requestTabCreate` | push-producer-matched | `src/main/runtime/orca-runtime-create-terminal-desktop.ts:52` (webContents.send); `src/main/runtime/orca-runtime-run-create-mobile-session-terminal.ts:118` (webContents.send) |
| `terminal:requestTabMount` | push-producer-matched | `src/main/runtime/orca-runtime-wait-for-leaf-pty-id.ts:81` (webContents.send) |
| `terminal:zoom` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:15` (webContents.send); `src/main/window/main-window-shortcut-routing.ts:256` (webContents.send) |
| `terminalPreview:data` | push-producer-unresolved | — |
| `ui:ackDashboardAgent` | push-producer-unresolved | — |
| `ui:activateWorktree` | push-producer-matched | `src/main/ipc/native-notification-delivery.ts:88` (webContents.send) |
| `ui:appMenuPaste` | push-producer-matched | `src/main/menu/register-app-menu.ts:194` (webContents.send); `src/main/window/main-window-shortcut-routing.ts:132` (webContents.send) |
| `ui:appMenuSelectionAction` | push-producer-matched | `src/main/menu/app-menu-selection-item.ts:29` (webContents.send) |
| `ui:browserHistoryNavigate` | push-producer-unresolved | — |
| `ui:closeActiveTab` | push-producer-unresolved | — |
| `ui:closeFloatingItem` | push-producer-unresolved | — |
| `ui:closeSessionTab` | push-producer-unresolved | — |
| `ui:closeTerminal` | push-producer-unresolved | — |
| `ui:createTerminal` | push-producer-unresolved | — |
| `ui:ctrlTabKeyDown` | push-producer-unresolved | — |
| `ui:ctrlTabKeyUp` | push-producer-unresolved | — |
| `ui:deleteCurrentWorkspace` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:46` (webContents.send) |
| `ui:dictationKeyDown` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:12` (webContents.send); `src/main/window/main-window-shortcut-routing.ts:91` (webContents.send) |
| `ui:editableContextPaste` | push-producer-unresolved | — |
| `ui:emulatorAutoAttach` | push-producer-unresolved | — |
| `ui:focusBrowserAddressBar` | push-producer-unresolved | — |
| `ui:focusEditorTab` | push-producer-unresolved | — |
| `ui:focusTerminal` | push-producer-matched | `src/main/ipc/native-notification-delivery.ts:95` (webContents.send) |
| `ui:hardReloadBrowserPage` | push-producer-unresolved | — |
| `ui:jumpToTabIndex` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:64` (webContents.send) |
| `ui:jumpToWorktreeIndex` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:61` (webContents.send) |
| `ui:mobileMarkdownRequest` | push-producer-matched | `src/main/window/mobile-markdown-request-relay.ts:52` (webContents.send) |
| `ui:moveSessionTab` | push-producer-unresolved | — |
| `ui:newBrowserTab` | push-producer-unresolved | — |
| `ui:newMarkdownTab` | push-producer-unresolved | — |
| `ui:newSimulatorTab` | push-producer-unresolved | — |
| `ui:newTerminalTab` | push-producer-unresolved | — |
| `ui:openCrashReport` | push-producer-unresolved | — |
| `ui:openDiffFromMobile` | push-producer-unresolved | — |
| `ui:openFeatureTour` | push-producer-unresolved | — |
| `ui:openFileFromMobile` | push-producer-unresolved | — |
| `ui:openMarkdownFiles` | push-producer-matched | `src/main/index.ts:63` (webContents.send) |
| `ui:openNewWorkspace` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:43` (webContents.send) |
| `ui:openQuickOpen` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:37` (webContents.send) |
| `ui:openSettings` | push-producer-matched | `src/main/startup/main-window-actions.ts:58` (webContents.send); `src/main/window/main-window-shortcut-actions.ts:18` (webContents.send) |
| `ui:openSetupGuide` | push-producer-unresolved | — |
| `ui:openSkillShare` | push-producer-unresolved | — |
| `ui:openTasks` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:52` (webContents.send) |
| `ui:openWorkspaceBoard` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:49` (webContents.send) |
| `ui:reloadBrowserPage` | push-producer-unresolved | — |
| `ui:renameTerminal` | push-producer-unresolved | — |
| `ui:resumeSleepingAgents` | push-producer-unresolved | — |
| `ui:revealDashboardAgent` | push-producer-matched | `src/main/ipc/dashboard-popout.ts:145` (webContents.send) |
| `ui:scrollBrowserPage` | push-producer-unresolved | — |
| `ui:selectFloatingIndex` | push-producer-unresolved | — |
| `ui:sessionTabCloseRequest` | push-producer-unresolved | — |
| `ui:sleepDashboardWorkspace` | push-producer-unresolved | — |
| `ui:sleepWorktree` | push-producer-unresolved | — |
| `ui:spawnDashboardAgent` | push-producer-unresolved | — |
| `ui:splitTerminal` | push-producer-unresolved | — |
| `ui:stateChanged` | push-producer-matched | `src/main/ipc/ui.ts:57` (webContents.send) |
| `ui:switchRecentTab` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:58` (webContents.send) |
| `ui:switchTab` | push-producer-unresolved | — |
| `ui:switchTabAcrossAllTypes` | push-producer-unresolved | — |
| `ui:switchTerminalTab` | push-producer-unresolved | — |
| `ui:terminalShortcutCaptured` | push-producer-matched | `src/main/window/main-window-shortcut-routing.ts:87` (webContents.send); `src/main/window/main-window-shortcut-routing.ts:105` (webContents.send) |
| `ui:terminalTabCloseRequest` | push-producer-matched | `src/main/window/terminal-tab-close-request-relay.ts:42` (webContents.send) |
| `ui:toggleAgentDashboard` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:55` (webContents.send) |
| `ui:toggleFloatingTerminal` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:34` (webContents.send) |
| `ui:toggleLeftSidebar` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:25` (webContents.send) |
| `ui:toggleQuickCommandsMenu` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:40` (webContents.send) |
| `ui:toggleRightSidebar` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:28` (webContents.send) |
| `ui:toggleStatusBar` | push-producer-unresolved | — |
| `ui:toggleWorktreePalette` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:31` (webContents.send) |
| `ui:worktreeHistoryNavigate` | push-producer-matched | `src/main/window/main-window-shortcut-actions.ts:67` (webContents.send) |
| `ui:zoomBrowserPage` | push-producer-unresolved | — |
| `updater:clearDismissal` | push-producer-unresolved | — |
| `updater:status` | push-producer-unresolved | — |
| `window:close-requested` | push-producer-matched | `src/main/window/main-window-close-lifecycle.ts:122` (webContents.send); `src/main/window/main-window-close-lifecycle.ts:176` (webContents.send) |
| `window:fullscreen-changed` | push-producer-matched | `src/main/window/main-window-state-lifecycle.ts:139` (webContents.send); `src/main/window/main-window-state-lifecycle.ts:143` (webContents.send) |
| `window:maximize-changed` | push-producer-matched | `src/main/window/main-window-state-lifecycle.ts:121` (webContents.send); `src/main/window/main-window-state-lifecycle.ts:127` (webContents.send) |
| `workspaceCleanup:scanProgress` | push-producer-unresolved | — |
| `workspacePorts:advertised-url-changed` | push-producer-unresolved | — |
| `workspaceSpace:progress` | push-producer-unresolved | — |
| `worktree:baseStatus` | push-producer-unresolved | — |
| `worktree:remoteBranchConflict` | push-producer-unresolved | — |
| `worktrees:changed` | push-producer-matched | `src/main/ipc/worktree-remote.ts:1804` (webContents.send) |
| `worktrees:gitStatusMetadataChanged` | push-producer-matched | `src/main/ipc/worktree-remote.ts:1814` (webContents.send) |
| `worktrees:headIdentitiesChanged` | push-producer-matched | `src/main/ipc/worktree-remote.ts:1825` (webContents.send) |

## Gaps register (explicit, not deferred)

- RPC method keys (e.g. "status.get") and preload IPC channels (e.g. "settings:get") are separate identifiers, not a literal-equality coverage join. This pass records dynamic-dispatch channels ["runtime:call","runtime:subscribe","runtimeEnvironments:call"] but does not resolve their method arguments or trace all main-handler-to-RPC calls. Such links may be statically resolvable by a more complete analysis; they remain unknown here, not absent or inherently unresolvable.
- 0 RPC method-array element(s) out of 615 total occurrences could not be statically resolved to a literal defineMethod/defineStreamingMethod name (factory calls with no discoverable return array, non-identifier spread targets, a "name" field that is neither a string literal nor a statically-resolvable member-constant reference, etc.) — see rpcMethodGroups[].methods entries whose name is wrapped in parentheses (e.g. starts with "(non-" or "(unresolved"); these NEVER count toward rpcMethodNamesResolvedUnique or the zero-resolved guard.
- main-side census scanned 4579/4579 src/main/**/*.ts files for ipcMain.handle/on/once/removeHandler/removeAllListeners AND <expr>.webContents.send(...) call sites (read-only evidence; this script's WRITE ownership remains the four docs/scripts paths only), found 1135 registrations (257 of them teardown-only, excluded from matching). Matching is DIRECTION-SPECIFIC, never pooled: invoke channels vs. ipcMain.handle (658/712 matched); send/sendSync channels vs. ipcMain.on/once (43/55 matched); on/once (push-event) channels vs. <expr>.webContents.send(...) producer call sites (84/180 matched, a syntactic heuristic on the literal ".webContents.send(" shape — a producer reached through other indirection is invisible to this pass, not proof no producer exists). Unresolved entries in any direction are explicit, never treated as coverage or as proof of a missing implementation — see requestChannelToHandlerMapping / fireAndForgetChannelToListenerMapping / pushEventChannelToProducerMapping.
- *-api.ts member extraction records signature NAMES only (no full type resolution of parameter/return shapes); full structural typing remains unresolved by this pass.
- channel identifiers and computed object keys are resolved against same-file AND cross-file imported string constants up to depth 6 (re-export chains beyond that depth, or non-string-literal computed expressions, are recorded unresolved-identifier-ref / unresolved-computed-*-key, not chased further). RPC "name" member-constant references (e.g. MENTU_RPC_METHODS.capability) are resolved the same way, additionally following `export * from` re-export chains up to depth 8.
- counts distinguish "syntaxIpcCallOccurrences" (every ipcRenderer.* call site parsed, including any duplicate composition paths before dedup) from "reachableBridgeMethodsDeduped" (the (file,anchor,name)-deduped method list belonging ONLY to exported objects index.ts's `api` assembly directly references) from "allBridgeExportMethodsDeduped" (the same dedup over EVERY exported bridge object regardless of reachability — an all-export inventory count that is NEVER proof of the public API surface). 0 exported bridge object(s) are not referenced by the index.ts assembly at all (see orphanBridgeExports) — their own export is dead from index.ts's perspective even where their content happens to also be reachable via a spread into another, reachable export.

## Reruns

This document and its paired JSON are regenerated byte-identically for the same frozen source SHA by `node scripts/inventory-source-bridges.mjs`. Raw run records from any single execution (including `.preflight/bridge-audit/*.json`) are fixture evidence of one invocation, never proof of a formal Commitment Protocol record.
