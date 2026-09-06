# Source-to-candidate declaration and field mapping

Pinned source: Lovecast Inc. MIT, `/Users/carlos/Documents/Drogon-mentu-session`
at `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (read-only, never a test cwd).
Candidate root: `apps/desktop/src/shared/persistence-contracts/`.

Extraction rules applied (dependency contract
`docs/migration/persisted-renderer-contract-migration.md`): type-only
extraction from runtime-heavy source modules with exact file/declaration/hash
provenance; no services copied for a type; no any/unknown/JSON weakening; no
invented schemas; every union, optional/null distinction and legacy field
preserved. Runtime admission (zod schemas), serialization, database ownership
and native durability are NOT part of this delivery and remain root gates.

## Entry contracts

| Source file | Source SHA256 | Candidate file | Declarations ported |
| --- | --- | --- | --- |
| `src/shared/workspace-session-state-types.ts` | `fc6c6c52c303fd50fbb9720b94e9cd9e1c98cff9fffa084623530a41892a0fcd` | `persistence-contracts/workspace-session-state-types.ts` | `PersistedOpenFile`, `WorkspaceSessionState` (all 30 fields), `WorkspaceSessionPatch` — wholesale |
| `src/shared/persisted-ui-state-types.ts` | `b7162f2c1982b2353d4cc6db11c68077909236546e3414509e96f3c057434244` | `persistence-contracts/persisted-ui-state-types.ts` | `PersistedUIState` — wholesale (every field incl. all `_` migration flags, Mentu, host scope/order, pet/sidekick legacy keys, star-nag, browser defaults) |
| `src/renderer/src/lib/workspace-session-host-persistence.ts` | `cc4edd0b06b6bda36bf76e0ff38962768f7e0780944335483724d0ed000041e1` | `persistence-contracts/workspace-session-host-persistence.ts` | `WorkspaceSessionHostSnapshot` (type only) |

## Referenced type closure (extraction per source file)

| Source file | Source SHA256 | Candidate file | Declarations ported | Boundary notes |
| --- | --- | --- | --- | --- |
| `execution-host.ts` | `b50beb1c179026e1457e490455fdcad1ebfa500b714635b598aa52dd6e55247a` | `execution-host.ts` | `LOCAL_EXECUTION_HOST_ID`, `ExecutionHostId`, `ExecutionHostKind` | runtime parsers/normalizers not ported |
| `agent-session-resume.ts` | `ebd386d6613f3d6251817039eff56c18e3bc4496dd6bd7cbc74322b9212442ae` | `agent-session-resume.ts` | `RESUMABLE_TUI_AGENTS`, `ResumableTuiAgent`, `AgentProviderSessionKey`, `AgentProviderSessionMetadata`, `SleepingAgentLaunchConfig`, `SleepingAgentSessionRecord` (incl. `automaticResumeBlockedBy` / `restoreOnTabOpenOnly`, restored after root AST review) | resume argv builders/normalizers not ported |
| `agent-status-types.ts` | `0ba3ad47b07f5b1f7db1a24e2284d8f724180c0112a03f10b34853b482f6e72b` | `agent-status-types.ts` | `AGENT_STATUS_STATES`, `AgentStatusState`, `WellKnownAgentType`, `AgentType` | status-row/observation types not ported |
| `tui-agent.ts` | `7c470c858ddc10988ea2b7e230d127a8d9bc70acf03e8dc8226d799749ce023b` | `tui-agent.ts` | `TuiAgent` | wholesale |
| `ai-vault-types.ts` | `096fbb5b1c458243d2630f7e2e5506d929bbd044ff0caa70f4a9ed2d9b96a3e7` | `ai-vault-types.ts` | `AI_VAULT_AGENTS`, `AiVaultAgent` | 18-entry array preserved exactly incl. `satisfies readonly TuiAgent[]` |
| `ai-vault-session-title.ts` | `536df5ff26e96a377953abc42658223d222f9358671cc83cf4b8705dfaafc1bc` | `ai-vault-session-title.ts` | `AiVaultSessionTitle` | request/result records not ported (not referenced) |
| `mentu-pane-types.ts` | `a24a74da344b24689574a0a193e81b809eb8bf897ab7af7f695f321b347cd0ab` | `mentu-pane-types.ts` | `MentuPaneMode` | runtime-message kinds not ported (not referenced) |
| `mentu-session-state-types.ts` | `4d16f4f48e0a07c1cd67ff9e1801e52e733971bdafdb7e957c2a4403a51fce1d` | `mentu-session-state-types.ts` | `MentuSessionPersistedState`, `MentuSessionStatesByKey` | key builder stays in source |
| `folder-workspace-types.ts` | `5992e2cfe64f272a370f1817efce6ac70ba41ec9dde4452e0ac9ed22945396a6` | `folder-workspace-types.ts` | `WorkspaceScope`, `WorkspaceKey` | FolderWorkspace record + service closures not ported (not referenced by the persisted contract) |
| `tab-types.ts` | `52f7c9931a012a53be6c7a302c72fe8adc27570d48adf2e1f8dc7197c82faeba` | `tab-types.ts` | `TabGroupSplitDirection`, `TabGroupLayoutNode`, `TabContentType`, `WorkspaceVisibleTabType`, `Tab`, `TabGroup` | `toVisibleTabType`, `CtrlTabOrderMode` not ported |
| `terminal-tab-types.ts` | `8d57d32c4e18382e0fc355941d1f3460849799b0aabac0bce06bea6f0954d751` | `terminal-tab-types.ts` | `TerminalTab`, `TerminalPaneSplitDirection`, `TerminalPaneLayoutNode`, `TerminalLayoutSnapshot` | wholesale type content |
| `browser-workspace-types.ts` | `392a1ac963b32250344a14b275a69cddcfed6c099c9e435ada6d0f8f59104f5b` | `browser-workspace-types.ts` | wholesale (all types incl. `BrowserHistoryEntry`, `BrowserPageDocLocation`, `BrowserPageConversionOrigin`, `BrowserPage`, `BrowserWorkspace`) | file is entirely type declarations |
| `workspace-doc-history.ts` | `995d983d1d514b906e647823abfb33d0fd017b425c37d7aac09a76d8b1566aea` | `workspace-doc-history.ts` | `WorkspaceDocHistoryEntry` | normalizers stay in source |
| `client-hosted-browser-close-intent.ts` | `1db01720b3fc1d43d3b591c4b8246c99a5ef7986e364ddfc4a471c57cead91dd` | `client-hosted-browser-close-intent.ts` | `ClientHostedBrowserCloseIntent` | zod schema + replay bounds stay in source |
| `client-hosted-browser-page-record.ts` | `e0690807d2a71b2e59c5f4519c90ae80f1299298823f095f8d681106af6f0bd8` | `client-hosted-browser-page-record.ts` | `CLIENT_HOSTED_BROWSER_PAGE_RECORD_VERSION`, `PersistedClientHostedBrowserPage`, `ForbiddenAuthorityField` compile-time proof | zod schema/age bounds stay in source |
| `closed-terminal-tab-tombstones.ts` | `19b72f09734d8f1877a9d204f71dac5781697e2dd6ebebf5a7e08bdd32cb9e4b` | `closed-terminal-tab-tombstones.ts` | `ClosedTerminalTabTombstone`, `ClosedTerminalTabTombstonesByTabId` | zod schema/TTL/prune helpers stay in source |
| `workspace-cleanup.ts` | `ca72f7ab6fe6707da86ca0ef421f028c8a677a8c5e1508fc90c6171701c7a552` | `workspace-cleanup.ts` | `WorkspaceCleanupBlocker`, `WorkspaceCleanupDismissal`, `WorkspaceCleanupUIState` | candidate/verdict/classifier records not ported (not referenced) |
| `workspace-cleanup-filter-model.ts` | `f06aa15537ef2c4207ddf2e67ddfe7a840c275618d079cb2c58300d9eb429378` | `workspace-cleanup-filter-model.ts` | all facet unions + `WorkspaceCleanupSortState`, `WorkspaceCleanupFilterState` + sub-filters | default-state factories stay in source |
| `workspace-cleanup-browse-state.ts` | `e6986579b9a70f02e32749af48f405d42445dc3497c6ae23ad3d0568e824d710` | `workspace-cleanup-browse-state.ts` | `WORKSPACE_CLEANUP_BROWSE_STATE_VERSION`, `WorkspaceCleanupBrowseState` | normalizer stays in source |
| `hosted-review.ts` | `deb4b17dc65a8dea8769fb7696423274f890c94de5079508936d6fc247f3a6d6` | `hosted-review.ts` | `HostedReviewProvider` | review-state types not ported (not referenced) |
| `feature-interaction-catalog.ts` | `0015a3cfc624d9dd800d54dba6cc420e4e7505131cedc3314f38c1ed03eeda80` | `feature-interaction-catalog.ts` | `FeatureInteractionId` (full union) | definition table/id array stay in source |
| `feature-interactions.ts` | `d0f06fea1a436f77584b8bc3c93a944ee0cc1504cb0b12fc08cf49eb2d6dec7a` | `feature-interactions.ts` | `FeatureInteractionRecord`, `FeatureInteractionState` | usage buckets/telemetry not ported (not referenced) |
| `feature-tips.ts` | `64d74435b3828ccb2fb3482882bae18edb097d3cf0fa9e33e8d1a95a6779fcd3` | `feature-tips.ts` | `FeatureTipId` | tip records not ported |
| `contextual-tours.ts` | `1f2eb5085d2046cf18f1849969913826e2431def6668d889f3cdebb77659007a` | `contextual-tours.ts` | `ContextualTourId` | step definitions not ported |
| `status-bar-usage-mode.ts` | `c22756bb3267a5d5e75432cabedf11f700c0cfab88aeb449f0296a6f8937433b` | `status-bar-usage-mode.ts` | `StatusBarUsageMode` | default/normalizer stay in source |
| `usage-percentage-display.ts` | `80f313fb44921c382cbabcab78d9dadbde65fe1c57350a40e177a7574012d778` | `usage-percentage-display.ts` | `UsagePercentageDisplay` | default/normalizer/clamp stay in source |
| `orca-yaml-hook-types.ts` | `ba972643fe2686e9d896e7867aae149385e9e88d927f3cb7ed66590c6e180d10` | `orca-yaml-hook-types.ts` | `PersistedTrustedOrcaHookEntry`, `PersistedTrustedOrcaHookRepo`, `PersistedTrustedOrcaHooks` | other hook-policy types stay in source |
| `pet-types.ts` | `e14c9cd9f6cce7c19c1860f89e21b10a91c3c1b66ed0e0a429617ea7d6a1f811` | `pet-types.ts` | `CustomPet`, `SpriteAnimation` | size constants stay in source |
| `ui-chrome-types.ts` | `adecbc929dc5d57f38d8b5feda69d67e52fec3124f3b18e0d48798b24f6fa478` | `ui-chrome-types.ts` | the 14 persisted-contract names (+ `TaskViewPresetId`, `WorktreeCardMode`) | OpenInApplication/source-control/branch-prefix/floating-terminal/dashboard types not ported (not referenced) |
| `linear/workspace-types.ts` | `d17af78903031f72df62a5c66a670c51d3ae31f43b19f3f0960e234657e2bde0` | `linear-workspace-types.ts` | `LinearWorkspaceSelection`, `LinearConcreteWorkspaceId` | only referenced members |
| `linear/project-types.ts` | `3d964779b6382f6b792f8501ae3a7db42dccc3bc0f29544e9ac5002f40cb0119` | `linear-project-types.ts` | `LinearCustomViewModel` | only referenced member |
| `agents-view-thread-filters.ts` | `0d20a03449f279aae478c2593cd1a5207466cc3062b4f684edf805ca3a343d1f` | `agents-view-thread-filters.ts` | `THREAD_READ_FILTER_VALUES`, `ACTIVITY_GROUP_BY_VALUES`, `ThreadReadFilter`, `ActivityGroupBy` | normalizers stay in source |
| `worktree/types.ts` | `97a7d676f27eb18f5be3a82deb930c407f492b2de1134d0e7d3564d1f40b764d` | `worktree-types.ts` | `WorkspaceStatus`, `WorkspaceStatusDefinition` | Worktree/lineage/provenance records not ported (not referenced by the persisted contracts) |
| `automation-host-filter.ts` | `b82d3598d10eecde2f03e32cd46fbbfe59cc7d206fa7dd233143fff3d7d7bd48` | `automation-host-filter.ts` | `PersistedAutomationHostFilter` | runtime filter union/converters stay in source |
| `release-channel.ts` | (reuse, see below) | — (imports `../update-status-types`) | `ReleaseChannel` | structurally identical candidate declaration |

## Reuse of an existing candidate type (structurally equivalent)

- `ReleaseChannel`: source `src/shared/release-channel.ts` line 3 declares
  `'stable' | 'rc' | 'hourly' | 'daily' | 'adhoc'`; the accepted candidate
  `apps/desktop/src/shared/update-status-types.ts` (from the WP-UI-PRELOAD
  preload work, hash recorded in that leaf's report) declares the identical
  union, so `persisted-ui-state-types.ts` imports it instead of duplicating.
  The thin process `Session` in `src/shared/session-contract.ts` was compared
  and is NOT the source renderer workspace snapshot; it was not used.

## Closure boundaries (explicit non-goals / not ported)

- All zod schemas and tolerant normalizers (runtime admission) — root gate.
- Serialization/durable round-trip, `Store`, native staging/flush — root gate.
- Runtime service implementations (host parsers, resume argv builders, key
  builders, default factories) — remain in the pinned source.
- Type-only declarations NOT referenced by the persisted contracts (e.g.
  `ParsedExecutionHost`, `ExecutionHostScope`… were included only where
  actually referenced; unused sibling types remain in source).

## Constant verification

All eight extracted constant declarations were re-diffed against the pin
(bracket-balanced block extraction, normalized whitespace/quote style):
`LOCAL_EXECUTION_HOST_ID`, `AGENT_STATUS_STATES`, `AI_VAULT_AGENTS`,
`RESUMABLE_TUI_AGENTS`, `CLIENT_HOSTED_BROWSER_PAGE_RECORD_VERSION`,
`WORKSPACE_CLEANUP_BROWSE_STATE_VERSION`, `THREAD_READ_FILTER_VALUES`,
`ACTIVITY_GROUP_BY_VALUES` — 8/8 identical to
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Import resolutions are proven by
the typechecks (any unresolved import fails them).

## Implementation port

| Source file | Source SHA256 | Candidate file | Notes |
| --- | --- | --- | --- |
| `src/renderer/src/lib/updater-beforeunload.ts` | `79b67eb76e596dd79d1373205ffc2333c312cd45614e69cf60f110a98a4c8886` | `apps/desktop/src/renderer/src/lib/updater-beforeunload.ts` | faithful implementation port (all 4 exports + behavior) |
| `src/renderer/src/lib/updater-beforeunload.test.ts` | (see suite) | `tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/updater-beforeunload.test.ts` | all 4 source cases preserved against the real module |

## Envelope binding

`persistence-contracts/checkpoint-staging-envelope.ts` binds
`ShutdownCheckpointStageArgs<WorkspaceSessionHostSnapshot, Partial<PersistedUIState>>`
as `HostQualifiedCheckpointStageArgs` and a matching deps shape
(`BoundCheckpointPersistDeps`); `positive-fixtures.test.ts` instantiates the
accepted generic factory `createShutdownCheckpointPersist` with exactly these
types and asserts exact pass-through of three host-qualified snapshots and the
full UI patch — no payload filtering.
