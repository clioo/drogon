**E1 final caller-boundary source handoff**

Proposed disposition: **ready for root review**. All **13/13** inherited deeper caller routes from the frozen web/navigation table now have concrete renderer → controller → named web/desktop boundary evidence. This completes the assigned finite source follow-up; unexecuted implementation, rendered and platform tests remain separate gates. Root alone accepts E1/the entire audit, ratifies Settings and supplemental IDs, and updates central ledgers. No other non-Drogon semantic gap is silently claimed closed.

Task `task_5f2606b1a214`, Dispatch `ctx_0677ac521e0a`. Source: `/Users/carlos/Documents/Drogon-mentu-session` at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, read-only. All **110 cited source/test files** exactly match their pinned Git blobs; SHA-256 and reviewed ranges are in the matching [JSON](followup-caller-boundaries.json) and hash table below. The range is the read-evidence boundary; a whole-file hash is not a claim of whole-file review. **17 test files have selected assertion bodies reviewed; none was executed by this worker.**

Audit estimate remains approximately **60%**, unweighted **7/12 accepted groups**, medium-low confidence; accepted-group change **0**. Local 13-route completeness is not an accepted audit percentage. Next milestone is root’s independent source review and E1 acceptance; the flexible 24-hour implementation target remains at risk from full audit acceptance, test migration and native/remote/platform execution.

**Evidence precedence and corrections**

- Remote Claude/Codex account subscription and select/remove bypass the local web account defaults; do not classify all web account callers as empty/no-op.
- GitHub PR page and GitLab MR dialog are distinct caller/controller paths; retain the GitLab file/review/pipeline obligations despite stale opening comments.
- Checks polling backoff follows successful unchanged signatures, including empty success; thrown failure itself does not increase backoff.
- Split test explicitly expects offscreen isVisible=false and isFocused=false; component-tree assertions are not a mounted drag/resize execution.
- Stage/unstage have console-only error handling in this caller and no same-tick guard; commit and AI do have per-worktree guards. Do not invent a universal exactly-once stage guarantee.
- Diagnostics uploads retained original main payload; edited preview file bytes are deliberately ignored by existing assertions.
- Preserve prior corrections: three original Activity TSX cases actually passed in root capsules; legacy terminal surfaces are reachable non-layout fallbacks; Activity source mounting is not Electron rendering; stale leaf parent IDs do not identify this Dispatch.
- Supplemental ID labels retain original meanings: PUI-TERM-003 is quick-command creation/editor/launch and PUI-CONN-004 is Windows/WSL/CLI registration. Prior Windows helper cross-links are evidence links, not authority to rename these IDs; root ratifies linkage.
- Inherited shutdown card's unverified empty/default recovery prose is refined: startup degradation preserves in-memory/disk state and blocks unsafe persistence; defaults only apply when UI never hydrated. This source correction retains corrupt/partial-checkpoint acceptance tests.

The frozen initial and web/navigation reports remain byte-for-byte unchanged. This report supersedes only the explicitly traced caller/source statements; their complete feature requirements, 19 invariant records, 11 journeys, complete source-test maps and rendered obligations survive. The prior 59 concrete factory keys/50 web modules and 37 already bounded callers are reused without another census. For example, proving a remote account route does not imply desktop login, native guest creation, AI generation or diagnostics upload is supported by a browser-local default.

**The thirteen caller routes**

**PUI-SETTINGS-002 — Settings search**

SettingsSidebar.SettingsSearchField -> settings-search-state input/applied queries -> use-settings-navigation-model ranked sections -> SettingsSection active content; renderer-local boundary with already-characterized settings/UI persistence only when controls are subsequently edited.

Validation/identity: 2 KiB UTF-8 query cap checked before trimming or scanning entry getters; trim/lowercase normalization; max-score pane 900/850/800 > entry 700/650/600 > description 500/450/400 > keyword 300/250/200, stable source-order ties.

Loading/projection: Input updates immediately; nonempty applied query waits 150ms. Empty query clears synchronously and cancels timer, without scanning entries.

Error: Oversized query returns zero/no matches rather than launching work. No network request exists in ranking.

Cancel/restore: New input cancels old debounce; clearing cancels pending work. Unsaved Git AI prompt keeps Git in navigation even when search excludes it; active-only content avoids mounting every matching pane.

Observable consequence: Section content requires selected active section and matching entries unless forceVisible; pane-title entry is included identically in nav and content.

Source: [components/settings/SettingsSidebar.tsx:56](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/SettingsSidebar.tsx:56)–94; [store/slices/settings-search-state.ts:9](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/settings-search-state.ts:9)–39; [components/settings/settings-search.ts:56](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/settings-search.ts:56)–162; [components/settings/use-settings-navigation-model.ts:130](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/use-settings-navigation-model.ts:130)–183; [components/settings/SettingsSection.tsx:54](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/SettingsSection.tsx:54)–67.

Existing assertion bodies (read, not run):

- [components/settings/settings-search.test.ts:14](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/settings-search.test.ts:14)–153: Case/empty normalization, four ranking tiers, same-order ties, pane title content match, oversized query refuses throwing getters.
- [store/slices/settings-search-state.test.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/settings-search-state.test.ts:25)–55: 149ms not applied, 150ms applied; clearing removes input/applied query and prevents pending reappearance.

Exact migration obligations:

- Port ranking and debounce assertions unchanged; rendered typing/clear/Escape/focus and selected-result transitions with unsaved Git prompt.
- Exercise every existing pane/control keyword entry, translated text and hidden capability; E2's field-control map remains the completeness denominator for metadata rather than reopening the bounded ranking route.

Named downstream ownership (not recursively re-audited): **E2 settings/control migration** — `components/settings/settings-search-keywords.ts and per-pane *-search.ts data`. Per-control discoverability is retained implementation/test coverage; no new execution path is hidden by this bounded entry-to-filter trace.

**PUI-SHELL-002 — Session shutdown and restore**

App session persistence effect -> session writer/host partitions and beforeunload guard -> createShutdownCheckpointPersist -> api.app.stageBeforeUnloadSync; boot useAppStartupHydration -> UI/catalog/per-host session reads -> hydrate workspace/tab/editor/browser -> terminal reconnect -> persistence-ready gates.

Validation/identity: Capture only when workspace session is eligible; remote upload requires valid revision and host-observation token, with authority rechecked after local write and before publishing results.

Loading/projection: Startup publishes settings/UI before catalog/session/terminal barriers; async catalog and session chains settle before error recovery; session writer unlocks only after successful dependent steps.

Error: Sleeping-agent capture error logs and continues; dirty open files prohibit degrading a failed full snapshot. Allowed quit/restart snapshot-build failure can stage durable-only; first full-stage failure blocks, repeated failure may degrade only when no dirty draft. Stage failure stays visible and retryable.

Cancel/restore: Successful checkpoint guard suppresses duplicate beforeunload; independent abort clears retry state while checkpoint failure preserves retry progression. StrictMode cleanup aborts terminal restoration. Restore failure preserves in-memory/disk data, keeps hydrationSucceeded false and shows sticky no-save/restart toast; only absent UI hydration permits default UI.

Observable consequence: Degraded startup clears pending reconnect maps and opens ready gates if reconnect already began or recovery failed, without serializing corrupt partial state as a new session.

Source: [app-shell/use-app-session-persistence.ts:96](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/use-app-session-persistence.ts:96)–267; [app-shell/shutdown-checkpoint-persist.ts:38](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/shutdown-checkpoint-persist.ts:38)–109; [lib/shutdown-checkpoint-guard.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/shutdown-checkpoint-guard.ts:25)–78; [app-shell/use-app-startup-hydration.ts:69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/use-app-startup-hydration.ts:69)–361; [startup/startup-degraded-recovery.ts:22](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/startup/startup-degraded-recovery.ts:22)–104.

Existing assertion bodies (read, not run):

- [app-shell/shutdown-checkpoint-restart-lifecycle.test.ts:97](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/shutdown-checkpoint-restart-lifecycle.test.ts:97)–165: Both restart and updater retain retry-then-degrade, last stage sessions []; independent abort makes next stage fail again; dirty snapshot cause named and no stage performed.

Exact migration obligations:

- Port checkpoint/guard/restart and startup recovery suites unchanged; execute corrupted/partial host partitions, dirty draft failure, canceled restart, duplicate unload and same-session relaunch.
- Verify packaged multi-host checkpoint durability, frozen host ownership and no-save recovery without overwriting prior data; no baseline execution occurred here.

Named downstream ownership (not recursively re-audited): **E3 persistence/runtime boundary; E5 shutdown/platform** — `api.session host partitions; api.app.stageBeforeUnloadSync and startup service barriers`. Disk atomicity, daemon restoration and platform process control remain complete service/platform migration tests, not untraced renderer entry routes.

**PUI-TERM-001 — Terminal liveness, legacy mount and exit recovery**

TerminalLegacyWorkspaceSurface -> TerminalLegacyTerminalPanes -> TerminalPane -> connectPanePty -> installSessionReconcileDispose / terminal-dead-session-reconcile -> transport.hasPty or local runtime.listSessions; push exits -> installPtyExitHibernate.onExit -> durable leaf binding / exit overlay.

Validation/identity: Legacy is the live non-layout route and returns null when any mounted layout owns the surfaces; pane keys and tab generations isolate restored transports. A flat daemon census is authoritative only for local PTYs; when both timestamps exist the snapshot must postdate binding (missing timestamps retain legacy membership behavior). SSH/runtime PTYs are excluded from this reconciliation.

Loading/projection: Hidden eligible panes remain measurable or parked; Activity publication can retain them at its portal target. Deferred connect and serializer/geometry ownership are initialized before restore/connect work.

Error: Targeted eligible-local liveness reconciles only on strict false, with the same ownership/timestamp guards. null, undefined, rejected hasPty and list-session failures remain unverifiable, never proof of exit. Proven failed local processes preserve output with process-exit/Git Bash capacity overlays.

Cancel/restore: Old transports cannot clear a replacement's leaf binding. Pending shutdown defers exit until committed; rollback leaves retryable binding. Synthetic host-loss exits retire transport but preserve leaf↔PTY identity. Fresh sole/split startup failures have explicit keep-pane guards; normal proven split exits close the pane.

Observable consequence: Overlay exposes Restart and Close; sole newborn failure does not strand the user on Landing. Activity portal mounting is source evidence; only the three previously root-executed Activity TSX cases are actual inherited rendering evidence.

Source: [components/TerminalLegacyWorkspaceSurface.tsx:5](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/TerminalLegacyWorkspaceSurface.tsx:5)–21; [components/TerminalLegacyTerminalPanes.tsx:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/TerminalLegacyTerminalPanes.tsx:20)–117; [components/terminal-pane/pty-connection/connect-pane-pty.ts:175](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/pty-connection/connect-pane-pty.ts:175)–242; [components/terminal-pane/terminal-dead-session-reconcile.ts:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-dead-session-reconcile.ts:20)–125; [components/terminal-pane/pty-connection/session-reconcile-dispose.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/pty-connection/session-reconcile-dispose.ts:1)–160; [components/terminal-pane/pty-connection/pty-exit-hibernate.ts:167](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/pty-connection/pty-exit-hibernate.ts:167)–344; [components/terminal-pane/TerminalProcessExitOverlay.tsx:15](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/TerminalProcessExitOverlay.tsx:15)–61.

Existing assertion bodies (read, not run):

- [components/terminal-pane/pty-connection-session-liveness.test.ts:175](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/pty-connection-session-liveness.test.ts:175)–275, [components/terminal-pane/pty-connection-session-liveness.test.ts:540](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/pty-connection-session-liveness.test.ts:540)–614: Authoritative local missing session and strict false close; true/null keep; stale response cannot close replacement; duplicate exit deduplicated; unverified restore leaves PTY/layout ownership.
- [components/terminal-pane/TerminalProcessExitOverlay.test.tsx:10](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/TerminalProcessExitOverlay.test.tsx:10)–44: 128-console alert; Restart/Close callbacks exactly once; other failure preserves exit code 7.

Exact migration obligations:

- Port complete terminal liveness, reconnect/reattach, restart, hibernation, renderer ownership and exit-overlay suites without weakening assertions; distinguish live/unverifiable/exited across local, SSH, remote and mixed-version hosts.
- Render fresh failure, retry, duplicate/late exit, host loss and recovery in sole/split/hidden/Activity surfaces; verify preserved scrollback, PTY identity and no duplicate startup command. Exercise actual PTY transport and Windows Git Bash limits in authorized fixtures.

Named downstream ownership (not recursively re-audited): **E3 runtime/PTY contract; E5 host and platform migration** — `transport.hasPty / listSessions / deferred connect and daemon replay at the already characterized runtime boundary`. Spawn/stream protocol, daemon/process survival and host-input encoding stay full implementation/execution obligations. This trace does not recursively re-audit their services.

**PUI-TABS-002 — Tab-group split layout and drag**

TabGroupSplitLayout -> SplitNode/ResizeHandle and useTabDragSplit -> commitTabDragDrop -> store drop/reorder/ratio actions -> mirrorWebRuntimeTabMove -> owner-scoped web runtime session tab move.

Validation/identity: Only active worktree enables useful drag activation; one stable sensor has 12px threshold (inactive uses a practically unreachable distance). Drag requires correct type and owning worktree; drop validates edge/target/source/self/insertion positions. Resize clamps to 15–85 percent and ignores a second pointer.

Loading/projection: Pointer movement updates DOM flex during resize, avoiding store churn; cleanup commits final ratio once. Offscreen worktree leaf props are isVisible=false and isFocused=false; retained component identity is not a claim that the offscreen surface is visible.

Error: Invalid/no-op targets restore captured activation and clear drag UI; mirror is fire-and-forget and has no caller rollback/error UI. Do not infer persistence/network success from a local drop.

Cancel/restore: Drag cancel restores activation snapshot and resets browser pass-through/cancel ownership. Pointer cancel/lost-capture/unmount use resize cleanup (commit current bounded ratio, not rollback). Mounted node paths persist ratio through store; actual restart serialization belongs to session gate.

Observable consequence: Edge drop precedes reorder, local store mutation precedes remote mirror only when moved; source active tab is restored where appropriate. Overlay is document-level; auto-scroll disabled.

Source: [components/tab-group/TabGroupSplitLayout.tsx:30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-group/TabGroupSplitLayout.tsx:30)–245; [components/tab-group/TabGroupSplitLayout.tsx:265](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-group/TabGroupSplitLayout.tsx:265)–360; [components/tab-group/useTabDragSplit.ts:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-group/useTabDragSplit.ts:40)–258; [components/tab-group/tab-drag-drop-commit.ts:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-group/tab-drag-drop-commit.ts:20)–179; [components/tab-bar/web-runtime-tab-move-mirror.ts:9](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-bar/web-runtime-tab-move-mirror.ts:9)–22.

Existing assertion bodies (read, not run):

- [components/tab-group/TabGroupSplitLayout.test.ts:111](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-group/TabGroupSplitLayout.test.ts:111)–189: Component-tree/prop assertions with mocked drag hook and leaf panel: offscreen leaf isVisible=false/isFocused=false, active leaf true/true; cleanup root ref forwarded; top/edge/header reservation. This is not a real DOM drag/resize test.

Exact migration obligations:

- Port full split/drag/drop/resize helper and TSX suites; rendered matching-pointer move/up/cancel/lostcapture, unmount commit, 15/85 bounds, cross-group activation restore, overlay/guest capture and inactive-worktree refusal.
- Verify session restore of ratios/order/focus and paired-runtime mirror against the actual owner; document caller behavior when a remote mirror rejects rather than treating local drag success as remote persistence.

Named downstream ownership (not recursively re-audited): **E3 session mirror/persistence and E5 Electron guest input** — `moveWebRuntimeSessionTab plus store dropUnifiedTab / setTabGroupSplitRatio`. Remote application acknowledgement, durable session serialization and native guest pointer capture remain separate gates; local route and cleanup semantics are now explicit.

**PUI-EDITOR-001 — Editor load, formats and save boundary**

Legacy editor or tab-group editor -> EditorPanel -> useEditorPanelContentState / file loader / render model -> readRuntimeFileContent; user save -> useEditorPanelSave -> attemptEditorFileSave -> editor save queue -> writeRuntimeFile.

Validation/identity: Read-only files cannot save; unresolved owner is retryable WORKTREE_OWNER_NOT_READY, never a guessed local owner. Runtime file must be inside owner worktree; typed binary_file alone permits preview fallback. Truncated remote text rejects rather than becoming editable content.

Loading/projection: File and diff requests use per-file generations and pending counts; invalidate keeps last content with stale marker instead of a flash. Reads coalesce by scope/path; force reload breaks prior generation; closed/stale completions cannot replace current view.

Error: Load error produces explicit content error; save catches/toasts and returns false. Failed writes clear self-write stamp. Pending owner migration blocks explicit save with a retry message and silently defers autosave; conflict suspension blocks autosave, while explicit save can proceed.

Cancel/restore: Serialized saves re-read live draft, skip closed/read-only/stale-generation work, and preserve a draft typed during the write. Discard quiescence flushes rich pending changes, cancels timers, advances generation and waits for prior write. Clean successful write updates baseline and only clears unchanged draft.

Observable consequence: Binary/error changes modes disabled; read-only edit uses source viewer. Rich Markdown/CSV/notebook/diagram modes are eligibility-gated, large content falls back to source, and unresolved conflicts exclude rich Markdown. Untitled Save goes to rename.

Source: [components/TerminalLegacyEditorSurface.tsx:10](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/TerminalLegacyEditorSurface.tsx:10)–39; [components/editor/EditorPanel.tsx:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/EditorPanel.tsx:40)–205; [components/editor/useEditorPanelContentState.ts:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useEditorPanelContentState.ts:35)–235; [components/editor/useEditorPanelFileContentLoader.ts:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useEditorPanelFileContentLoader.ts:40)–227; [components/editor/editor-panel-render-model.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-panel-render-model.ts:25)–210; [components/editor/useEditorPanelSave.ts:12](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useEditorPanelSave.ts:12)–39; [components/editor/editor-file-save-attempt.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-file-save-attempt.ts:1)–20; [components/editor/editor-save-queue.ts:58](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-save-queue.ts:58)–165; [runtime/runtime-file-read-client.ts:27](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-file-read-client.ts:27)–77; [runtime/runtime-file-mutation-client.ts:32](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-file-mutation-client.ts:32)–55.

Existing assertion bodies (read, not run):

- [components/editor/diff-viewer-large-diff-save-action.test.ts:5](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/diff-viewer-large-diff-save-action.test.ts:5)–28: Pruned large-diff content must not expose Save; an intentionally empty complete draft must call onSave with empty string.

Exact migration obligations:

- Port all assigned editor suites, including Markdown round trip, rich mode, CSV, notebook, diff, conflict, preview, untitled naming, external mutation, binary and large-file boundaries; the small save-action body is discriminating evidence, not the complete test denominator.
- Execute overlapping read/save/invalidation and owner changes, failed write then retry, autosave vs explicit conflict override, write during typing, quiesce-before-discard and restart with dirty drafts on local/SSH/runtime files.
- Render format/source fallback, loading/error/retry and preserved preview identity; prove file bytes and disk baseline with real authorized temporary workspaces, not a mock of missing file behavior.

Named downstream ownership (not recursively re-audited): **Editor implementation plus E3 filesystem/owner contracts** — `files.read / files.readPreview / files.write; format codecs and owner resolver behind named editor controller`. Full codec round trips, watcher ordering and filesystem atomicity remain required feature tests; this finite route stops at these concrete boundaries rather than claiming every codec body re-audited.

**PUI-SC-001 — Staging, commit, AI message and remote sync**

SourceControl -> SourceControlPanel -> useSourceControlPanelModel -> entry mutations / commit action / AI generation / remote runner -> owner-scoped runtimeGit and store branch actions.

Validation/identity: Commit needs nonempty trimmed message, staged files and no unresolved conflict unless explicit caller options override; target captured with worktree/path/settings/connection. Commit and AI requests have per-worktree in-flight guards; stage/unstage functions do not themselves provide exactly-once click guards.

Loading/projection: Stage/unstage await mutation then refresh; commit sets busy and refreshes only active target. AI records request ID and progress per worktree; remote runner captures operation/recovery identity and increments error sequence.

Error: Stage/unstage failures console-log; commit errors set action error. Remote results distinguish ok/failed/superseded/skipped; latest failure retains kind, raw error, sync-push stage, branch and file snapshot. Plain Push is never silently force-push; explicit force uses lease.

Cancel/restore: AI cancel marks record then sends cancellation; spinner clears only as the request settles. Success fills only empty draft; remount consumes an unhydrated success once. Commit only clears the same submitted draft, preserving in-flight typing. Discard quiesces editor saves before owner-scoped mutation.

Observable consequence: No target/rebase base returns skipped; remote stale failure returns superseded. Remote mutation completion refreshes status/history/compare for implicit active target. Suppressed PR state hides all Create PR action entry points.

Source: [components/right-sidebar/SourceControl.tsx:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/SourceControl.tsx:1)–61; [components/right-sidebar/source-control/panel/use-panel-model.ts:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/panel/use-panel-model.ts:40)–196; [components/right-sidebar/source-control/commit/use-entry-mutations.ts:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/commit/use-entry-mutations.ts:20)–155; [components/right-sidebar/source-control/commit/use-commit-action.ts:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/commit/use-commit-action.ts:35)–165; [components/right-sidebar/source-control/commit/use-commit-message-generation.ts:60](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/commit/use-commit-message-generation.ts:60)–310; [components/right-sidebar/source-control/sync/use-remote-action-runner.ts:85](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/sync/use-remote-action-runner.ts:85)–244.

Existing assertion bodies (read, not run):

- [components/right-sidebar/source-control/review/use-action-model.test.tsx:60](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/review/use-action-model.test.tsx:60)–78: Normal no-PR context exposes Create PR; suppressed state removes header/composer/primary Create PR both loading and settled.

Exact migration obligations:

- Port full stage/unstage/discard/commit/AI generation, action-model and remote-recovery suites; assert empty message, conflicts, repeated click, owner switch, console-only stage failure and failed commit retry without losing draft.
- Verify canceled/late AI result and remount hydration, plain push versus explicit force-with-lease, sync pull-success/push-failure, stale action errors, and discard racing editor save with real isolated Git repositories.
- Retain create-review, recovery/rebase/abort, history, branch/base/remote ownership and all existing source-control features; web AI synthetic failure/no-op cancellation must render honestly, not become a claimed AI capability.

Named downstream ownership (not recursively re-audited): **Source-control implementation and E3 Git/hosted-review service contracts** — `runtimeGit stage/unstage/discard/commit/message methods; pushBranch/pullBranch/syncBranch/rebaseFromBase`. Git command atomicity, conflict recovery and hosted-provider effects remain independently owned service tests, not another recursive renderer audit.

**PUI-SC-002 — Checks panel polling, refresh and provider identity**

ChecksPanel controller chain -> polling/review data/manual refresh -> GitHub fetchPRChecks/fetchPRComments or GitLab details adapter -> owner runtime RPC / desktop gh or gl -> ActiveContent or EmptyContent.

Validation/identity: No active worktree, folder mode or no active review renders EmptyContent. Request identity includes cache key, branch, PR/MR number, repo and head; GitLab selects its own path, never GitHub polling for MR context.

Loading/projection: GH successful unchanged signatures back off 30→60→120 seconds, changed signature resets 30; thrown failures do not themselves advance backoff. Visibility controls polling. GL loading is owned by newest request generation; stale data is rejected.

Error: Current poll failure logs warning and yields empty checks/comments, not a guaranteed distinct inline failure banner. Manual refresh rethrows outer error after recording outcome and resets only its current request; nested checks/comments failures warn and clear corresponding arrays.

Cancel/restore: Manual refresh has immediate ref guard; new branch identity invalidates old PR, refreshed head is passed directly instead of stale closure. Superseded request cannot clear latest loading; eligibility refresh nonce increments after current manual completion.

Observable consequence: GitLab details projects pipeline and discussions; adapter routes environment gitlab.workItemDetails or desktop gl with owner settings. GH/GL projection is distinct; unchanged empty successful result is not provider capability evidence.

Source: [components/right-sidebar/ChecksPanel.tsx:130](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/ChecksPanel.tsx:130)–191; [components/right-sidebar/checks-panel/use-checks-panel-polling.tsx:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/checks-panel/use-checks-panel-polling.tsx:35)–276; [components/right-sidebar/checks-panel/gitlab-review-client.ts:15](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/checks-panel/gitlab-review-client.ts:15)–83; [components/right-sidebar/checks-panel/use-checks-panel-manual-refresh.tsx:65](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/checks-panel/use-checks-panel-manual-refresh.tsx:65)–351.

Existing assertion bodies (read, not run):

- [components/right-sidebar/checks-panel/use-checks-panel-polling.test.tsx:100](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/checks-panel/use-checks-panel-polling.test.tsx:100)–243: Repeated successful empty checks reach 30/60/120; GitLab avoids GH; refreshed MR/head and owner forwarded; stale identity dropped; latest generation owns loading.

Exact migration obligations:

- Port complete checks-panel polling/manual-refresh/comment/AI/review/branch suites and actual provider projection contracts; distinguish thrown error from successful empty poll, hidden/resumed polling and rapid refresh.
- Render no review/folder/loading/empty/failure/changed-head cases and switch GH→GL during outstanding work; verify old result and old finally cannot mutate current panel.
- Retain all check log/detail, rerun, discussion resolution, AI acknowledgement/queue, review creation and branch controls as implementation gates; no backend or rendered tests ran here.

Named downstream ownership (not recursively re-audited): **Checks/review implementation; E3 hosted review/provider services** — `fetchPRChecks / fetchPRComments; gitlab.workItemDetails; named ChecksPanel comment/AI/branch/create hooks`. Provider response payload semantics and mutation outcomes retain their complete contracts. The routing, empty/poll/error and refresh boundary is now characterized.

**PUI-PR-001 — GitHub PR page and separate GitLab MR dialog**

TaskPageContent GH PR -> PullRequestPage surface/useDetails -> owner-scoped detail cache and source adapter -> gh/runtime github; TaskPageGitLabDialog -> GitLabItemDialog state/details/primary actions -> gl with clicked item's repo/sourceContext.

Validation/identity: GH detail key includes repo/path/provider preference/source scope/type/number. Reviewer action trims/deduplicates/excludes selected names, validates total <=15 and owner context, with same-tick submission ref guard. Direct merge requires owner context, no pending merge and presentation.directMergeAvailable; no blanket claim that checks alone gate merging.

Loading/projection: GH warm details paint synchronously; pending request survives close/reopen; generations prevent invalidated cache resurrection. Optimistic comments merge by ID into cached details, without claiming server ordering. Check-detail requests have request token and timeout guards.

Error: GH cold null is unavailable; cached null/error retains stale data, cold error exposes failure and next opening retries. State close/reopen uses optimistic patch and rollback; merge/reviewer failures toast. GL missing selector clears details/loading; null details says Item not found; request rejection sets error.

Cancel/restore: GH item change resets scoped local state; mutations route captured owner. GL details effect discards stale responses; scope reset clears metadata/inline comment/job state. GL top-level comment success only clears matching item's draft; mounted guards suppress effects after unmount. There is no claim all GL mutation completions are fenced against same-mount item switches.

Observable consequence: GL MR close/reopen/merge and MR-versus-issue comment endpoints are concrete; GH and GL are separate surfaces. GL file/review/pipeline features are retained despite stale top-file comment describing some as deferred; imports and state show actual expanded controls.

Source: [components/task-page/Content.tsx:28](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page/Content.tsx:28)–58; [components/pull-request-page/page/surface.tsx:45](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/page/surface.tsx:45)–150; [components/pull-request-page/page/use-details.ts:30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/page/use-details.ts:30)–244; [components/pull-request-page/reviewers/request-actions.ts:50](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/reviewers/request-actions.ts:50)–269; [components/pull-request-page/actions/panel.tsx:55](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/actions/panel.tsx:55)–94; [components/pull-request-page/actions/merge-actions.ts:45](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/actions/merge-actions.ts:45)–272; [components/pull-request-page/checks/details-request.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/checks/details-request.ts:25)–98; [components/pull-request-page/checks/refresh.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/checks/refresh.ts:25)–117; [components/pull-request-page/conversation/reply.ts:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/conversation/reply.ts:20)–77; [components/task-page/gitlab/Dialog.tsx:15](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page/gitlab/Dialog.tsx:15)–29; [components/GitLabItemDialog.tsx:22](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/GitLabItemDialog.tsx:22)–70; [components/gitlab-item-dialog/use-gitlab-item-dialog-effects.ts:7](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/gitlab-item-dialog/use-gitlab-item-dialog-effects.ts:7)–115; [components/gitlab-item-dialog/use-gitlab-primary-actions.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/gitlab-item-dialog/use-gitlab-primary-actions.ts:25)–175.

Existing assertion bodies (read, not run):

- [components/pull-request-page/cache/file-content.test.ts:10](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/cache/file-content.test.ts:10)–71: Pending file read coalesces; exact promise eviction allows retry; old resolution cannot overwrite replacement cache request.

Exact migration obligations:

- Port full PR/MR details/files/conversation/reviewers/merge/checks tests; real source-compatible baseline and unchanged assertion mapping required before candidate implementation.
- Exercise warm/cold/null/reject cache, owner/item change during fetch or mutation, close/reopen, reviewer double click/max15, merge unavailable/confirmation/rollback/auto-merge, check timeout and latest response.
- Keep all GitLab detail editing, files, inline discussion/reviewer/pipeline actions and GitHub diff/log/review conversation features; characterize same-mount stale GL mutation and comment draft typing races explicitly before changing behavior.

Named downstream ownership (not recursively re-audited): **PR/MR implementation and E3 hosted-provider contracts** — `github/gl detail, reviewer, merge, state, comment, check-detail APIs; use-gitlab-details-editing / use-gitlab-review-actions / use-gitlab-pipeline-actions`. These named downstream action families remain full feature obligations and provider authorization/outcome tests; primary selection/load/mutation route is complete without claiming those service bodies re-audited.

**PUI-BROWSER-001 — Browser creation, local guest, remote navigation and stream recovery**

createBrowserTab store action -> BrowserWorkspacePane placement -> native BrowserPagePane / ClientHostedBrowserPagePane / RemoteBrowserPagePane -> navigation and RemoteBrowserStreamLifecycle/PageSession -> native webview or browser.tabCreate/tabShow/navigation/screencast runtime boundary.

Validation/identity: Creation asserts client materialization policy and rejects duplicate page ID; default profile is owner-host scoped. Local state creates workspace/page/order and only changes global active surface for active owner. Remote stream checks browser.screencast.v1 before subscribing; address submission rejects file URLs on remote route while workspace document routing is separate.

Loading/projection: Placement preserves local guest parents and stable environment:page identity for client-hosted adoption. Remote staged goto defers until creation, not a premature tabShow. Streams publish opening/live/retrying/stopped; stopped forces busy false and offers recovery rather than a permanent spinner.

Error: Runtime missing page closes that page instead of recreating it indefinitely. Initial unavailable/permanent open failure stops with actionable notice; dropped stream retries at 500/1000/2000/4000/8000ms, then stops. Transport onError without onClose stops waiting-for-ready and stays actionable. Successful unchanged history reads are deduplicated and tokens redacted.

Cancel/restore: Stored matching host/page handle is adopted by tabShow; stale creation completion best-effort closes its newly allocated page. Operation and stream tokens invalidate old resize/close/response work; teardown unsubscribes, clears retry and refresh timers. Last frame survives retry; ready clears recovered failure. Reopen resets budget; healthy-stream rule controls drop budget reset, not every ready event.

Observable consequence: Local navigation updates model then webview.src; main-frame events ignore Chromium error-page URLs and do not overwrite address typing. Native local notebooks can route to editor after stat/authorization. Runtime input/navigation is actual owner RPC, whereas web native-guest default methods remain unsupported/synthetic as frozen factory report states.

Source: [store/slices/browser/browser-tab-actions.ts:31](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser/browser-tab-actions.ts:31)–155; [components/browser-pane/assemble-chrome/browser-workspace-pane.tsx:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/assemble-chrome/browser-workspace-pane.tsx:35)–198; [components/browser-pane/navigate/navigate-browser-page-url.ts:45](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/navigate/navigate-browser-page-url.ts:45)–144; [components/browser-pane/host-guest/browser-page-webview-navigation-handlers.ts:67](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/browser-page-webview-navigation-handlers.ts:67)–147; [components/browser-pane/stream-remote/remote-browser-page-pane.tsx:136](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.tsx:136)–182; [components/browser-pane/stream-remote/remote-browser-page-pane.tsx:237](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.tsx:237)–261; [components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:40)–258; [components/browser-pane/stream-remote/remote-browser-page-session.ts:42](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-session.ts:42)–148; [components/browser-pane/stream-remote/remote-browser-stream-lifecycle.ts:59](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-stream-lifecycle.ts:59)–373; [components/browser-pane/stream-remote/remote-browser-stream-restart-scheduler.ts:12](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-stream-restart-scheduler.ts:12)–109; [components/browser-pane/stream-remote/remote-browser-screencast-subscription.ts:62](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-screencast-subscription.ts:62)–130.

Existing assertion bodies (read, not run):

- [components/browser-pane/stream-remote/use-remote-browser-page-navigation.test.ts:60](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.test.ts:60)–142: History records navigation but not 20 repeated reads; title-only update; blank omitted and Kagi token redacted.
- [components/browser-pane/stream-remote/remote-browser-stream-lifecycle.test.ts:19](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-stream-lifecycle.test.ts:19)–168, [components/browser-pane/stream-remote/remote-browser-stream-lifecycle.test.ts:334](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-stream-lifecycle.test.ts:334)–371: Reopen parked stream keeps same page with one creation; unmount removes subscription; second retry uses next backoff; unsupported/missing stops; successful ready clears error; transport error without close stays not-busy and offers reconnect even after ready deadline.

Exact migration obligations:

- Port the full browser creation/profile/history/download/navigation/workspace-doc/stream/input suite; current selected assertions do not replace native browser and client-hosted chrome cases.
- Exercise create canceled before response, host switch/adoption, duplicate page, unsupported stream, unreachable initial open, onError-only, exhausted retries, manual reconnect, hidden parking and viewport supersession with actual paired runtime transport.
- Render native/client-hosted/streamed placements, offline notices, new-tab focus, page restore, guest crash recovery and file/document routes; preserve bookmarks/downloads/history/profiles/annotations/clipboard/shortcut behavior and Windows linkage already mapped.

Named downstream ownership (not recursively re-audited): **Browser implementation; E3 runtime browser services; E5 native guest/input** — `browser.* RPC/subscription and Electron webview; client-creation-action-policy; ClientHostedBrowserPagePane`. Frame codec/input sequence, native guest lifecycle, downloads and profile persistence are complete feature/test gates; no service internals or personal browser were exercised.

**PUI-DASHBOARD-001 — Agent dashboard drawer and native popout bridge**

AgentDashboardSidebarEntry -> drawer store toggle or api.dashboard.openPopout; drawer useLiveDashboardSnapshot -> shared snapshot builder; main renderer useDashboardPopoutBridge -> desktop IPC validation/relay -> popout useDashboardSnapshot -> board/map.

Validation/identity: Sidebar chooses drawer versus popout from settings; native IPC admits trusted UI renderer, experimental dashboard enable and board/map view only. Snapshot admission rejects malformed whole payload (keeps prior board) or drops invalid cards.

Loading/projection: Bridge watches relevant store slices only while popout open and uses leading/trailing 250ms throttle. Initial/reopen/request republishes full icons; unchanged icons omitted later and retained on both main cache and popout. Drawer derives directly from store, not IPC.

Error: No open-error catch or in-window error state exists on the sidebar's void open call. Malformed snapshot logs while previous board remains. Web dashboard default no-op open/false open state does not create a native window; drawer's local projection is separate.

Cancel/restore: Closing popout clears main cached snapshot; reopening requests fresh snapshot. Main renderer remount recovers actual getPopoutOpen state. Cleanup unsubscribes and cancels trailing/stale timers. Popout transient host clear watermark rejects older status events and requests topology refresh.

Observable consequence: Status-only patches can update known cards without rebuilding topology; unknown/cleared cards debounce refresh with max wait. Column transitions skip when reduced motion or terminal dialog is open, while data still updates. Reveal/ack/spawn/sleep are forwarded to main renderer owner.

Source: [components/sidebar/AgentDashboardSidebarEntry.tsx:61](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/AgentDashboardSidebarEntry.tsx:61)–94; [components/dashboard/useLiveDashboardSnapshot.ts:13](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard/useLiveDashboardSnapshot.ts:13)–31; [components/dashboard/useLiveDashboardSnapshot.ts:43](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard/useLiveDashboardSnapshot.ts:43)–112; [components/dashboard/useDashboardPopoutBridge.ts:112](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard/useDashboardPopoutBridge.ts:112)–257; [components/dashboard-popout/useDashboardSnapshot.ts:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard-popout/useDashboardSnapshot.ts:40)–174; [src/main/ipc/dashboard-popout.ts:28](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/dashboard-popout.ts:28)–129.

Existing assertion bodies (read, not run):

- [components/dashboard-popout/useDashboardSnapshot.test.tsx:95](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard-popout/useDashboardSnapshot.test.tsx:95)–184: Column change animates; dialog-open still applies but does not animate; omitted icons retained, new map replaces, explicit empty clears; known status changes do not request topology.

Exact migration obligations:

- Port all snapshot builder/host/context/board/map/filter/preview/drawer/popout suites; rendered filters, unseen acknowledgement, keyboard, empty/offline and clipping remain owed.
- Run authorized packaged multi-window open/close/reload, stale cache rejection, snapshot validation and icon retention, create/focus/reveal and setting-disable teardown; verify no renderer test mock is presented as real native popout proof.
- Exercise remote/SSH/folder agent previews, working/waiting/done/stale states, reduced-motion and terminal-dialog transitions with real status feeds and owner identity.

Named downstream ownership (not recursively re-audited): **Dashboard implementation; E3 IPC validation; E5 native windows** — `src/main/window/dashboard-popout-window.ts; buildDashboardSnapshot; revealDashboardAgent / launchDashboardAgent / runSleepWorktree`. Window geometry/display ownership, terminal previews and launch/sleep effects stay their complete platform/feature contracts; finite entry/snapshot/relay route is resolved.

**PUI-ACCOUNTS-001 — Provider accounts, owner scope and recovery**

AccountsPane and status switcher projection -> watchProviderAccounts/fetchProviderAccountsSnapshot -> local Claude/Codex API OR active-runtime accounts.subscribe; action runner -> select/remove provider-account client -> owner RPC/API; Grok section -> status and usage refresh.

Validation/identity: Remote account owner takes precedence over desktop settings; local host/WSL grouping is distinct and unknown remote platform hides unsuitable rows. Account removal captures runtime slot when dialog opens. System default is not inferred merely from a hidden row; config-sync warning is host-local only.

Loading/projection: Local list uses allSettled and publishes healthy provider first, marking failedProviders instead of treating substitute empty roster as authoritative. Remote live stream uses accounts.subscribe rather than a usage-blocked accounts.list; first-snapshot timeout is 15s. One-shot status menus dedupe pending reads by owner-kind-prefixed key.

Error: Partial load preserves prior failed provider state and toasts. Remote no first snapshot/closed/error reports failure. Action runner always resets idle; Claude cancellation is quiet, other mutation errors toast. Grok failure yields signed-out/error state; expiry text points to owning computer and usage refresh.

Cancel/restore: Closing watcher fences late local or remote snapshots and unsubscribes handles that arrive after closure. Local mutations refresh local settings; remote mutations do not overwrite local account fields. Codex changed selection/active reauth/removal marks live sessions for targeted restart; Claude advises restart rather than automatically killing sessions.

Observable consequence: Correction: web Claude/Codex factory empty defaults apply to local API branch only; paired accounts.subscribe/select/remove is implemented via runtime client and can populate real roster. Remote mutations send accountId, not desktop host/WSL parameters. Add/reauth desktop API availability is not inferred from selection capability. Grok, MiniMax and Codex config-sync retain their different web defaults.

Source: [components/settings/AccountsPane.tsx:85](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/AccountsPane.tsx:85)–185; [components/settings/AccountsPane.tsx:190](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/AccountsPane.tsx:190)–285; [components/settings/accounts-pane-account-actions.ts:44](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/accounts-pane-account-actions.ts:44)–211; [runtime/runtime-provider-accounts-client.ts:38](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-provider-accounts-client.ts:38)–302; [components/status-bar/status-bar-codex-accounts.ts:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/status-bar/status-bar-codex-accounts.ts:35)–140; [components/status-bar/status-bar-codex-accounts.ts:178](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/status-bar/status-bar-codex-accounts.ts:178)–186; [components/status-bar/status-bar-claude-accounts.ts:176](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/status-bar/status-bar-claude-accounts.ts:176)–184; [components/settings/GrokAccountsSection.tsx:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/GrokAccountsSection.tsx:20)–151.

Existing assertion bodies (read, not run):

- [runtime/runtime-provider-accounts-client.test.ts:119](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-provider-accounts-client.test.ts:119)–183, [runtime/runtime-provider-accounts-client.test.ts:378](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-provider-accounts-client.test.ts:378)–399, [runtime/runtime-provider-accounts-client.test.ts:402](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-provider-accounts-client.test.ts:402)–466: Local read once and late-close suppression; healthy provider retained; remote close-before-first snapshot rejects; local select includes WSL target, remote select/remove only accountId and zero local mutation calls.
- [components/settings/GrokAccountsSection.test.tsx:59](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/GrokAccountsSection.test.tsx:59)–68: Expired session renders host-scoped recovery without requiring a chat message; no grok login instruction in that expired-state branch.

Exact migration obligations:

- Port complete account pane, status switcher, host/WSL visibility, config-sync, restart notice, usage and managed-account suites; preserve Claude/Codex/Grok/Gemini/OpenCode/MiniMax coverage.
- Exercise owner switch during pending list/mutation, same-email distinct IDs, partial provider failure, late watcher close and remote snapshot timeout; web paired roster versus unpaired synthetic defaults must be distinct.
- Render add/cancel login/reauth/remove confirmations, expired sign-in, credential save rejection, scope return, WSL unknown/unavailable and restart prompts using controlled test accounts; no real account or credential action occurred here.

Named downstream ownership (not recursively re-audited): **Accounts implementation; E2 settings scopes; E3 account service; E5 keychain/WSL** — `accounts.subscribe/select/remove; claudeAccounts/codexAccounts add/reauth; MiniMax credentials/config-sync/usage service`. Provider authentication, credential storage, polling and actual session restart remain service/platform execution gates, without reopening this now-concrete caller route.

**PUI-TASKS-001 — Tasks providers, source identity, lists and detail return**

TaskPage 39-hook controller chain -> source availability/provider state/resume -> GH landing aggregate/store read -> github.listWorkItems or gh; GL per-repo loading -> gl; Linear/Jira list effects -> scoped store clients -> owner linear/jira RPC or local API; detail route preserves clicked sourceContext.

Validation/identity: Repo-backed GH/GL availability combines owner host registry and provider preflight; Linear/Jira use focused execution host plus selected workspace/site identity. Saved preferred provider restores when available unless user manually changed it; invalid GL view/filter repaired. Query cap in clients returns [] before provider work; Linear attribute filters require capability or explicitly reject.

Loading/projection: GH cache/refresh/filter/pagination states are distinct; successful hard refresh alone clears prior confirmed authority. GL allSettled merges selected repos with repo IDs and sorts update time; banner only if errors and zero rows, not partial usable result. Jira/Linear gate effects on restored resume/source/connection and debounce search. Linear issue lists retain scoped cached rows on landing, show blocking loading only on explicit force/cache miss, and fence both success and error by request signature plus nonce; source/filter changes reset pagination, while view/search persistence waits for resume.

Error: GH per-repo errors may serve matching scoped stale cache; full request failure gets tasksError, not misleading per-repo banner. GL not_found repo is ignored; Todos rejection becomes empty. Jira error clears stale issues and carries friendly summary plus separate raw details. Linear project error keeps error state; missing selected project clears selection/resume context.

Cancel/restore: Source change/unmount sets canceled/stale guards, preventing prior response from replacing list. Detail sourceContext is retained with matching selected item/site; close goes back in task-detail history when possible, otherwise clears all four detail target fields. Modal/menu owns Escape; input Escape blurs first; outer Escape closes page.

Observable consequence: GH PR and issue have different detail components; GL dialog uses clicked item's repo. Linear/Jira account readiness is distinct from provider-shaped synthetic empty defaults. Shared store providers remain scoped by owner/source cache, so null/empty web defaults are not evidence of provider connectivity.

Source: [components/task-page/TaskPage.tsx:43](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page/TaskPage.tsx:43)–84; [components/use-task-page-source-availability.ts:38](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-source-availability.ts:38)–148; [components/use-task-page-provider-state.ts:27](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-provider-state.ts:27)–87; [components/use-task-page-detail-routing.ts:30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-detail-routing.ts:30)–183; [components/use-task-page-global-effects.ts:29](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-global-effects.ts:29)–115; [components/use-task-page-github-landing-refresh.ts:15](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-github-landing-refresh.ts:15)–28; [components/task-page-github-landing-refresh-run.tsx:260](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page-github-landing-refresh-run.tsx:260)–398; [store/github/work-item-aggregate-actions.ts:42](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/github/work-item-aggregate-actions.ts:42)–105; [store/github/work-item-fetch-actions.ts:105](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/github/work-item-fetch-actions.ts:105)–155; [store/github/work-item-routing.ts:109](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/github/work-item-routing.ts:109)–192; [components/use-task-page-gitlab-loading.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-gitlab-loading.ts:25)–183; [components/use-task-page-jira-list-effects.ts:39](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-jira-list-effects.ts:39)–154; [components/use-task-page-linear-collection-effects.ts:39](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-linear-collection-effects.ts:39)–184; [runtime/runtime-linear-client.ts:185](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-linear-client.ts:185)–240; [runtime/runtime-jira-client.ts:114](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-jira-client.ts:114)–145; [components/task-page/Content.tsx:28](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page/Content.tsx:28)–75.

Additional issue-list controller source: [components/use-task-page-linear-list-effects.ts:61](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-linear-list-effects.ts:61)–293.

Existing assertion bodies (read, not run):

- [components/task-page-jira-load-state.test.ts:5](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page-jira-load-state.test.ts:5)–65: 403, malformed JQL, network, 503 and non-Error rejections clear stale issues; friendly title stays separate from raw provider detail.

Exact migration obligations:

- Port complete Tasks source-family, resume/cache/search/pagination/authority, provider connection/creation, list/project/board/detail and mutation suites; each of GH/GL/Linear/Jira must have real contract assertions, not a title-only test map.
- Render disconnected/unsupported/partial-result/loading/error/retry/empty, provider hidden then hydrated, query changes, owner changes, manual selection versus saved default, stale detail and Back/Escape behavior.
- Verify JQL error, multi-repo GH/GL mixed success, stale-cache refresh, Linear custom views/attributes/project missing and real scoped create/update/comment workflows; account and provider service tests remain fully required.

Named downstream ownership (not recursively re-audited): **Tasks implementation; E3 provider/source contracts and E2 settings** — `scoped GH/GL/Linear/Jira store clients; use-task-page-* creation/mutation/metadata/board/custom-view helpers`. Every provider's complete feature list is retained; this trace covers list/navigation/controller boundary, not a recursive re-audit of every provider endpoint, server authorization, board codec or creation form.

**PUI-DIAG-001 — Diagnostic preview, consent, cancellation and ticket controls**

PrivacyDiagnosticsSection -> status/bundle/ticket state -> PrivacyDiagnosticBundleControls -> diagnostics collect/open/upload/discard/delete API; desktop IPC holds preview authority and upload consent, web diagnostics rejects/disabled per frozen factory characterization.

Validation/identity: Create disabled unless bundleEnabled; Send UI disabled until previewOpened and while uploading. Renderer sends retained bundleSubmissionId only. Missing bundle/ticket actions return; no claim that a button gate alone secures backend.

Loading/projection: Separate collect/open/upload/discard/copy/delete flags reset in finally only while mounted; status read rejection leaves N/A. Collect makes preview, resets opened/ticket; successful upload clears preview and shows ticket controls.

Error: Action failure toasts and keeps retryable bundle or ticket. Upload canceled result preserves existing bundle/opened state and does not claim sent. Main assertion bodies require main-collected preview, opening it before sending and rechecking retained preview after confirmation.

Cancel/restore: Unmount discards retained preview; collection resolving after unmount discards its new preview. Successful discard clears submission ref immediately. Ticket deletion clears ticket only after success; failed deletion remains retryable. No persistent ticket restore is asserted.

Observable consequence: Preview file is review-only: main upload tests explicitly send retained ORIGINAL payload even if review file was edited. Never describe edited preview bytes as what will upload. Web bundle-disabled keeps Create disabled and unsupported actions cannot count as collection capability.

Source: [components/settings/PrivacyDiagnosticsSection.tsx:30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/PrivacyDiagnosticsSection.tsx:30)–176; [components/settings/PrivacyDiagnosticsSection.tsx:178](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/PrivacyDiagnosticsSection.tsx:178)–259; [components/settings/PrivacyDiagnosticBundleControls.tsx:46](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/PrivacyDiagnosticBundleControls.tsx:46)–139.

Existing assertion bodies (read, not run):

- [src/main/ipc/diagnostics.test.ts:110](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/diagnostics.test.ts:110)–136, [src/main/ipc/diagnostics.test.ts:167](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/diagnostics.test.ts:167)–275: Renderer-minted bundle rejected; retained main payload only; quiet declined consent; recheck after discard during confirmation; edited preview ignored; opening required; discard and 15-minute expiry revoke preview.

Exact migration obligations:

- Port complete renderer consent/mounted cleanup/ticket and main diagnostics authority/redaction/deletion suites; validate readonly original-payload disclosure and exact sent bytes in a controlled local endpoint.
- Render unavailable status, create/open/failure/retry, cancel upload, unmount during collection, discard during confirmation, copy/delete ticket success/failure and expired preview; no real collection/upload/delete executed.
- Preserve full opt-in/retention/redaction/privacy feature gate and packaged file permissions; root allocates trusted controlled diagnostics destination rather than reusing production telemetry.

Named downstream ownership (not recursively re-audited): **Diagnostics implementation; E3 IPC; E5 packaging/privacy** — `src/main/ipc/diagnostics.ts and diagnostic bundle/token/upload/delete services`. Sanitization, secret handling, remote deletion and filesystem permissions require separate service/platform tests; the caller consent/cancel/restore route and discriminating authority assertions are explicit.

**Complete retained feature list**

These are all **50 named IDs**, not a selected sample. Every original state/action/error/recovery obligation, full source-test list and screenshot/journey obligation remains at the exact frozen JSON record below. “This follow-up” means the bounded caller route is now source-characterized, not that the feature passed implementation or rendering. “Prior follow-up” retains the earlier scoped characterization and all caveats. The eight supplemental names retain their initial meanings; web cross-links do not rename them.

| ID | Complete feature family retained | Source route | Frozen full obligations |
| --- | --- | --- | --- |
| PUI-SIDEBAR-001 | Left sidebar workspace/worktree list + nav buttons | Prior follow-up | [/cards/0 ](closure.json#/cards/0) |
| PUI-SETTINGS-000 | Settings nav taxonomy (35 fixed panes + dynamic per-repo + named intents) | Prior follow-up | [/cards/1 ](closure.json#/cards/1) |
| PUI-SETTINGS-002 | Settings search (per-control keyword index, not per-pane) | This follow-up | [/cards/2 ](closure.json#/cards/2) |
| PUI-SHELL-002 | Session persistence & shutdown checkpoint | This follow-up | [/cards/3 ](closure.json#/cards/3) |
| PUI-SIDEBAR-002 | Workspace-space (disk usage) manager | Prior follow-up | [/cards/4 ](closure.json#/cards/4) |
| PUI-TABS-001 | Tab strip: create/close/drag/reorder/split entry menu | Prior follow-up | [/cards/5 ](closure.json#/cards/5) |
| PUI-TERM-001 | Terminal surface / xterm host + liveness contract | This follow-up | [/cards/6 ](closure.json#/cards/6) |
| PUI-TERM-002 | Terminal search overlay | Prior follow-up | [/cards/7 ](closure.json#/cards/7) |
| PUI-TERM-004 | Floating terminal (detach/resize/orchestration dialog) | Prior follow-up | [/cards/8 ](closure.json#/cards/8) |
| PUI-TABS-002 | Split/group layout (drag-to-split, pane focus) | This follow-up | [/cards/9 ](closure.json#/cards/9) |
| PUI-EDITOR-001 | Editor surfaces (source/diff/combined-diff/notebook/image/markdown) | This follow-up | [/cards/10 ](closure.json#/cards/10) |
| PUI-SC-001 | Source control panel (stage/commit/AI-message/sync) | This follow-up | [/cards/11 ](closure.json#/cards/11) |
| PUI-SC-002 | Checks panel (CI status + review comments + conflict summary) | This follow-up | [/cards/12 ](closure.json#/cards/12) |
| PUI-PR-001 | Pull request page (conversation/checks/files/reviewers) | This follow-up | [/cards/13 ](closure.json#/cards/13) |
| PUI-BROWSER-001 | Browser pane tab (URL classify / guest-view / trust boundary) | This follow-up | [/cards/14 ](closure.json#/cards/14) |
| PUI-NATIVECHAT-001 | Native chat portal (per-tab rendering mode, not a page) | Prior follow-up | [/cards/15 ](closure.json#/cards/15) |
| PUI-DASHBOARD-001 | Agent dashboard popout (live buckets, snapshot cache) | This follow-up | [/cards/16 ](closure.json#/cards/16) |
| PUI-AIVAULT-001 | AI Vault session panel (right-sidebar 'vault' tab) | Prior follow-up | [/cards/17 ](closure.json#/cards/17) |
| PUI-ACCOUNTS-001 | Branded per-provider account switchers (Claude/Codex/Grok) | This follow-up | [/cards/18 ](closure.json#/cards/18) |
| PUI-SKILLS-001 | Skills page (cloud install / share / agent setup) | Prior follow-up | [/cards/19 ](closure.json#/cards/19) |
| PUI-ARTIFACTS-001 | Artifacts (create-intent + share-record, resumable publish) | Prior follow-up | [/cards/20 ](closure.json#/cards/20) |
| PUI-TASKS-001 | Task page (Jira/Linear/GitHub/GitLab providers) | This follow-up | [/cards/21 ](closure.json#/cards/21) |
| PUI-AUTOMATIONS-001 | Automations (schedule/trigger, host-fenced dispatch) | Prior follow-up | [/cards/22 ](closure.json#/cards/22) |
| PUI-BOTS-001 | Bots page (creation/character preset/responsibility scheduling) | Prior follow-up | [/cards/23 ](closure.json#/cards/23) |
| PUI-MENTU-001 | Mentu panel & recipe workbench (DAG, retry-fold, evidence restore) | Prior follow-up | [/cards/24 ](closure.json#/cards/24) |
| PUI-MEETINGS-001 | Meetings page (transcript rows, capture availability, Q&A delegation) | Prior follow-up | [/cards/25 ](closure.json#/cards/25) |
| PUI-CONN-003 | Mobile pairing & emulator (QR pair, screen stream, agent setup guide) | Prior follow-up | [/cards/26 ](closure.json#/cards/26) |
| PUI-DIAG-001 | Diagnostics bundle (Settings→Privacy: collect/preview/upload/discard) | This follow-up | [/cards/27 ](closure.json#/cards/27) |
| PUI-ONBOARD-001 | First-run onboarding flow | Prior follow-up | [/cards/28 ](closure.json#/cards/28) |
| PUI-FEATURETIPS-001 | Contextual feature-tip system (startup gate, per-feature dialogs, contextual tours) | Prior follow-up | [/cards/29 ](closure.json#/cards/29) |
| PUI-PLUGINCATALOG-001 | Plugin marketplace catalog, install consent, rollback/remove | Prior follow-up | [/cards/30 ](closure.json#/cards/30) |
| PUI-NOTIF-001 | Native notification delivery, permission probing, mobile fanout | Prior follow-up | [/cards/31 ](closure.json#/cards/31) |
| PUI-WEBMODE-001 | Web-mode preload shim (browser deployment target) | Prior follow-up | [/cards/32 ](closure.json#/cards/32) |
| PUI-PETS-001 | Status-bar pet segment, bundle import, agent-state animation mapping | Prior follow-up | [/cards/33 ](closure.json#/cards/33) |
| PUI-STATS-001 | Stats settings pane and collector | Prior follow-up | [/cards/34 ](closure.json#/cards/34) |
| PUI-SPARSE-001 | Sparse-checkout presets (per-repo Settings sub-pane + worktree-creation-time application) | Prior follow-up | [/cards/35 ](closure.json#/cards/35) |
| PUI-QUICKCMD-001 | Quick commands (Settings definition surface + tab-bar trigger surface) | Prior follow-up | [/cards/36 ](closure.json#/cards/36) |
| PUI-CONN-001 | SSH target management (add/edit form, passphrase, startup reconnect) | Prior follow-up | [/cards/37 ](closure.json#/cards/37) |
| PUI-CONN-002 | Remote Orca servers / runtime environments (pairing, compatibility, connection status) | Prior follow-up | [/cards/38 ](closure.json#/cards/38) |
| PUI-KEYS-001 | Static keybinding catalog (PUI-KEYS-001) + Shortcut settings UI (PUI-KEYS-002) | Prior follow-up | [/cards/39 ](closure.json#/cards/39) |
| PUI-FILEEXP-001 | File explorer (right-sidebar tree, name filter, row context menu) | Prior follow-up | [/cards/40 ](closure.json#/cards/40) |
| PUI-PORTS-001 | Local & SSH port forwarding panel (right-sidebar) + workspace port scanner | Prior follow-up | [/cards/41 ](closure.json#/cards/41) |
| PUI-SHELL-001 | Platform shell chrome | Prior follow-up | [/supplementalNamedSurfaces/0 ](closure.json#/supplementalNamedSurfaces/0) |
| PUI-SHELL-003 | Global shortcut dispatcher | Prior follow-up | [/supplementalNamedSurfaces/1 ](closure.json#/supplementalNamedSurfaces/1) |
| PUI-TERM-003 | Terminal quick-command creation/editor/launch | Prior follow-up | [/supplementalNamedSurfaces/2 ](closure.json#/supplementalNamedSurfaces/2) |
| PUI-SETTINGS-001 | Legacy settings pane-range aggregate | Prior follow-up | [/supplementalNamedSurfaces/3 ](closure.json#/supplementalNamedSurfaces/3) |
| PUI-SETTINGS-003 | Settings deep links | Prior follow-up | [/supplementalNamedSurfaces/4 ](closure.json#/supplementalNamedSurfaces/4) |
| PUI-KEYS-002 | Shortcut editor | Prior follow-up | [/supplementalNamedSurfaces/5 ](closure.json#/supplementalNamedSurfaces/5) |
| PUI-DROGON-001 | Drogon placeholder identity versus implemented pages | Prior follow-up | [/supplementalNamedSurfaces/6 ](closure.json#/supplementalNamedSurfaces/6) |
| PUI-CONN-004 | Windows/WSL settings and CLI registration | Prior follow-up | [/supplementalNamedSurfaces/7 ](closure.json#/supplementalNamedSurfaces/7) |

The JSON also retains all **19 invariant identities and obligations** by frozen record and all **15 prior web integration test obligations**. Full feature content is incorporated from hash-verified `closure.json` records; original non-Drogon caveats remain available there, including explorer virtualization/mutations, quick-command partitioning, host attachment and automation/native-chat action families. This handoff does not convert unreviewed service internals into proven behavior. The named downstream boundaries above assign their implementation/test ownership without recursively expanding the finite source task.

**Execution evidence and next gates**

No source baseline, candidate, renderer, native or provider test ran in this worker task. Read-only file/range/hash/ID checks are audit validation, not product tests. Root’s three original Activity TSX cases **did pass**, and this task re-read all three retained assertion result names/statuses: publication capsule `audit-activity-publication-QWdNFk` **2 passed**; feedback capsule `audit-activity-feedback-uOSGIu` **1 passed**, zero failed/pending. [Root’s review](../../activity-portal-test-review.md) records Node 24.19.0, Vitest 4.1.11, React/React DOM 19.2.8, happy-dom 20.11.8, macOS arm64. No Electron window or terminal was rendered. The old filename containing `react185` is not the executed React version. Root’s infrastructure test counts are separate.

| Retained result | SHA-256 |
| --- | --- |
| `.preflight/parity-baseline/audit-activity-publication-QWdNFk/vitest-results.json` | `efe85671c32de053e9d40847e2399e0924c782b4ed5cfc274bb9076caf43c493` |
| `.preflight/parity-baseline/audit-activity-feedback-uOSGIu/vitest-results.json` | `537d946fb4286ac70defd646d29a07c0f48ab0b47d1f643b38cf4d6e983b832f` |

Root’s next obligations are finite:

1. Independently review these 13 routes, incorporate the narrow source corrections, ratify Settings/supplemental linkage and accept the source audit. This worker changes no central ID or acceptance state.
2. Stage the **17 exact existing assertion files** listed in JSON `futureAcceptanceCommands.targetedAssertionFileSet` in a reviewed isolated source-compatible environment; review configuration/effects and preserve assertion/source bytes. The JSON provides an explicit Vitest argv for that isolated copy only. Do not execute in the frozen reference; setup failure/skips are not behavioral RED.
3. Preserve and port each complete WP/card source suite from frozen `closure.json.testManifest` and full per-card allocation, plus prior web tests. The selected assertion bodies are discriminators, not a replacement suite. Prove actual candidate behavioral RED before implementation.
4. Execute every per-route owed test above, every inherited invariant and all named feature/journey/rendered obligations. Native window/PTY/Windows/WSL/SSH/paired web/provider effects require controlled environments. Only root can transfer to Sol implementation after the whole audit is accepted.

**Scope, omissions and lifecycle**

- Only entry-to-named-boundary semantics for these 13 routes are newly resolved. The complete 59-key factory characterization and 37 other callers are reused, not re-censused.
- Per-format editor codecs, provider endpoint implementations, payload authorization, main-process persistence/daemon/native windows and remote wire execution were not recursively re-audited; exact named owners/boundaries are under each route.
- Initial closure.json cards[].inheritedGapsVerbatim, priorPointerDebtsRetained, remainingObligations and full sourceTestPaths are preserved byte-for-byte by snapshot hash. None is deleted or silently weakened. Root applies the narrow resolutions here to central evidence.
- Untouched non-Drogon semantic obligations (for example explorer virtualization/mutations, quick-command partitioning, host attachment, automation/native chat action families) are not claimed independently solved by these 13 traces; consult frozen per-card records and owning area evidence.
- Root must ratify Settings pane-qualified proposals and supplemental source identities; no central identifier or ledger was edited.
- Source bodies were read, not executed. Selected tests constrain specific behaviors only; the full relevant source suites and packaged/Windows/WSL/SSH/web journeys remain owed.

This task was performed directly with **zero children created and zero owned children pending**. No identity rebind, global setting change, source/product write, install, commit, push, PR or personal UI/account action occurred. Inbox check returned only the historical settled navigation child message. Historical release receipt, reported to root in `msg_cc58e3582b29`: `requestId=26298d3b-52c6-454c-9a19-c4fa7584b299; verdict=retained; reason=external_terminal; processAction=none`. That is a prior-child receipt, not a new release action or current child.

**Frozen inputs**

| Path | SHA-256 |
| --- | --- |
| `docs/migration/audit-closure/e1-ui/report.md` | `cc9c1a224e3d8d33a1cbeb791edcb1e5944450abf3fb65219bc2eed947d91993` |
| `docs/migration/audit-closure/e1-ui/closure.json` | `6773c2fdf108ca05b8deccbf56e10e63be55a1c99d325a67e943eb722bb4175f` |
| `docs/migration/audit-closure/e1-ui/build-reconciliation.py` | `e895d524fb8b8cae13d18491233aaca2bf6cb993327fd0e3230546748cd56edf` |
| `docs/migration/audit-closure/e1-ui/followup-web-navigation.md` | `7f1f632c1ff56a7d703fcfed933ba4aaeccf7e11bb3a7bfe34fc9ba611fab6af` |
| `docs/migration/audit-closure/e1-ui/followup-web-navigation.json` | `4dcc42ecf536d34201090a9958386734eeba36e88d410ad6019fb6f429943c3c` |
| `docs/migration/activity-portal-test-review.md` | `6b91789bd77f2569cf696b65ff61dd8080138077556bee4da72b8ef8d15b9a50` |
| `docs/migration/audit-closure-coordination.md` | `120027755de67a3f2acb20022bbb838192de28b2ebe5eb2b48306c11817871c3` |
| `AGENTS.md` | `8bb79680edb6d280bfcf9315aaa435a6fcf4ef258cc876ea2351dc45ca230148` |

**Cited source and assertion hashes**

All paths are relative to the pinned read-only source root. Every file below matches the pinned revision exactly; ranges distinguish partial reads from full-file hashes. The detailed row-to-claim and assertion mapping is also machine-readable in [followup-caller-boundaries.json](followup-caller-boundaries.json).

| File | Reviewed lines | SHA-256 |
| --- | --- | --- |
| [src/main/ipc/dashboard-popout.ts:28](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/dashboard-popout.ts:28) | 28–129 | `0bfd0a52da2c44d6b1a5ed0ce13de115afe24b1d4942807668d224a4168666b1` |
| [src/main/ipc/diagnostics.test.ts:110](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/diagnostics.test.ts:110) | 110–136, 167–275 | `d8d56a1f82f601e85959181f41b54b53665e7a248d26d3763f51e5b812c3b5b4` |
| [src/renderer/src/app-shell/shutdown-checkpoint-persist.ts:38](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/shutdown-checkpoint-persist.ts:38) | 38–109 | `4516edf3690549c7f3051bad200c4d5dae229cd2c27995831041f5ea8389cb9e` |
| [src/renderer/src/app-shell/shutdown-checkpoint-restart-lifecycle.test.ts:97](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/shutdown-checkpoint-restart-lifecycle.test.ts:97) | 97–165 | `4dc096bd4c6ce625efc4f730e970368a67ee10a3ef4fa9b202f9ceadbba07444` |
| [src/renderer/src/app-shell/use-app-session-persistence.ts:96](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/use-app-session-persistence.ts:96) | 96–267 | `2f29caaf3fba4754b37bdc5fe52b52c1977859cd4dd838b164aaf71bda17c20d` |
| [src/renderer/src/app-shell/use-app-startup-hydration.ts:69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/use-app-startup-hydration.ts:69) | 69–361 | `b7f1795cac6c488a9212915213f9233023c8779c75fcbaa69af278ac9ed1b5ea` |
| [src/renderer/src/components/GitLabItemDialog.tsx:22](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/GitLabItemDialog.tsx:22) | 22–70 | `d7ed03ae797a0e47c51baa1bfcf6b2e48f63e5f520c854d772e9efbf3f4f7717` |
| [src/renderer/src/components/TerminalLegacyEditorSurface.tsx:10](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/TerminalLegacyEditorSurface.tsx:10) | 10–39 | `3c29c8a85a5eec6bdef6ddb4eceef9690015c3ef7c15eb5fe4e60ccee71304ae` |
| [src/renderer/src/components/TerminalLegacyTerminalPanes.tsx:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/TerminalLegacyTerminalPanes.tsx:20) | 20–117 | `dcb8de7a8f14015a4e6d771f21827892ea0df1ad6df28e597481ed85d5a2b953` |
| [src/renderer/src/components/TerminalLegacyWorkspaceSurface.tsx:5](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/TerminalLegacyWorkspaceSurface.tsx:5) | 5–21 | `a6b53d3847eae7b76993968e6a4a296488ce16a882a7427ab9896a4582e05edb` |
| [src/renderer/src/components/browser-pane/assemble-chrome/browser-workspace-pane.tsx:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/assemble-chrome/browser-workspace-pane.tsx:35) | 35–198 | `3f0c4d07556f45abf8c7559118667a0647a49f465f22e52b91e0eb565ac35ec3` |
| [src/renderer/src/components/browser-pane/host-guest/browser-page-webview-navigation-handlers.ts:67](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/browser-page-webview-navigation-handlers.ts:67) | 67–147 | `866eb6479df63ee45d4b35b38db4550e0743fd5683829e373ae2c0a333287550` |
| [src/renderer/src/components/browser-pane/navigate/navigate-browser-page-url.ts:45](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/navigate/navigate-browser-page-url.ts:45) | 45–144 | `709103ed224c070c44fa03ca85fed522ef85480df2980fdf7d95c33b8b17d20c` |
| [src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.tsx:136](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.tsx:136) | 136–182, 237–261 | `966ec4feaab958c497c473af3534f88b01f8e499ef88bd5c57fbf581c5d68c22` |
| [src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-session.ts:42](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-session.ts:42) | 42–148 | `23f466230658cbda449e717ede6e20a5476ece9d1e1d1999d408a5a8ddd8123f` |
| [src/renderer/src/components/browser-pane/stream-remote/remote-browser-screencast-subscription.ts:62](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-screencast-subscription.ts:62) | 62–130 | `4ef04ee8411da370552bd99490af3a797823466964c98220f945944bf78e8989` |
| [src/renderer/src/components/browser-pane/stream-remote/remote-browser-stream-lifecycle.test.ts:19](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-stream-lifecycle.test.ts:19) | 19–168, 334–371 | `147e639564bb00309ac24cea3d06b65cdb2c78dbedae3cffbd90dc36d3de37e6` |
| [src/renderer/src/components/browser-pane/stream-remote/remote-browser-stream-lifecycle.ts:59](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-stream-lifecycle.ts:59) | 59–373 | `58cba73ddcbd0798e2692594415538519886a2334fad079feb2e68d7d1c9b9ac` |
| [src/renderer/src/components/browser-pane/stream-remote/remote-browser-stream-restart-scheduler.ts:12](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-stream-restart-scheduler.ts:12) | 12–109 | `19e6794ef829aeaddf6ef6736e4da004f4dd792fa1acbae607f6a043d22e0131` |
| [src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.test.ts:60](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.test.ts:60) | 60–142 | `93e13fe54c616189374d98b62c45914ccb359efa8c32b34020c314cd315ed77f` |
| [src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:40) | 40–258 | `fb9e73aa4f9d0141ba324596e5dacc52246248d12b8670cb5abd248cdc395580` |
| [src/renderer/src/components/dashboard-popout/useDashboardSnapshot.test.tsx:95](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard-popout/useDashboardSnapshot.test.tsx:95) | 95–184 | `a6e54b3cfebbb66fdf5cb8f023bfd1ded955672b816d2dae87b56e72621f71f5` |
| [src/renderer/src/components/dashboard-popout/useDashboardSnapshot.ts:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard-popout/useDashboardSnapshot.ts:40) | 40–174 | `a4806af2e676a2420dfdf25a837c5477e685a7eadd7ebb76620ea60efa661c40` |
| [src/renderer/src/components/dashboard/useDashboardPopoutBridge.ts:112](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard/useDashboardPopoutBridge.ts:112) | 112–257 | `3e225f985a374b16c60167e8a29c3d62b1dfd48b5349a5e72b0c506bbe630970` |
| [src/renderer/src/components/dashboard/useLiveDashboardSnapshot.ts:13](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard/useLiveDashboardSnapshot.ts:13) | 13–31, 43–112 | `b0e967aad323a7c0e76580d16b82b7e2ae3de86647848096824ecd460ecf5a8a` |
| [src/renderer/src/components/editor/EditorPanel.tsx:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/EditorPanel.tsx:40) | 40–205 | `8d3648f52400f5d28eb8eaebfba030d7667b9a7c7795d4b0b3a30c0468a9c691` |
| [src/renderer/src/components/editor/diff-viewer-large-diff-save-action.test.ts:5](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/diff-viewer-large-diff-save-action.test.ts:5) | 5–28 | `0a9ace7b0596fcc5bbabd025f5818ebb58d5fb453da562835316c0e8fefd1bbc` |
| [src/renderer/src/components/editor/editor-file-save-attempt.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-file-save-attempt.ts:1) | 1–20 | `f0e5e27c3e376a9bc998fe62559c2fcdb6f05b224d970994b8f0c7873750c866` |
| [src/renderer/src/components/editor/editor-panel-render-model.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-panel-render-model.ts:25) | 25–210 | `061a841a9a5c812606443162178f45b5278f094ea625ac8b62ccc466270f9073` |
| [src/renderer/src/components/editor/editor-save-queue.ts:58](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-save-queue.ts:58) | 58–165 | `1ce0b02060f1cf59c60b88411b4f95833a52eb00674d8c430e56577fbe4d95a6` |
| [src/renderer/src/components/editor/useEditorPanelContentState.ts:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useEditorPanelContentState.ts:35) | 35–235 | `c78dacf406f3bd0753e880243313e0329108ced6233bfea990b55364e2890cc0` |
| [src/renderer/src/components/editor/useEditorPanelFileContentLoader.ts:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useEditorPanelFileContentLoader.ts:40) | 40–227 | `5da46287ae89c12099890705c260fba551333bc8bbf2ee242bac7562b61e6667` |
| [src/renderer/src/components/editor/useEditorPanelSave.ts:12](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useEditorPanelSave.ts:12) | 12–39 | `a1eaf509807a04aba02aca91b344ae0873524410cdc0f1609c7e1be702202132` |
| [src/renderer/src/components/gitlab-item-dialog/use-gitlab-item-dialog-effects.ts:7](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/gitlab-item-dialog/use-gitlab-item-dialog-effects.ts:7) | 7–115 | `acff38b67997b3dd31a5c998c78d60d729306f775afc171973ee40c2ac3e789b` |
| [src/renderer/src/components/gitlab-item-dialog/use-gitlab-primary-actions.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/gitlab-item-dialog/use-gitlab-primary-actions.ts:25) | 25–175 | `f4a4d5cd8a2f25382fbe06b3a0a67e840a6204197c008010f7bfb7363bc9e4e2` |
| [src/renderer/src/components/pull-request-page/actions/merge-actions.ts:45](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/actions/merge-actions.ts:45) | 45–272 | `f881e3170db860aadeab7a8823103a778d6b3521eeb93fd7caac1e75c6b192f1` |
| [src/renderer/src/components/pull-request-page/actions/panel.tsx:55](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/actions/panel.tsx:55) | 55–94 | `bd5b24f4a99e8ac2e43ea3f0292e4aeb44e7d4b3bc6087bed7fa46f65bbdd495` |
| [src/renderer/src/components/pull-request-page/cache/file-content.test.ts:10](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/cache/file-content.test.ts:10) | 10–71 | `1cde48dbc90fd97bb8f13e4a279a8dd01eb1013dd3785c2629cad2ad5da0450d` |
| [src/renderer/src/components/pull-request-page/checks/details-request.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/checks/details-request.ts:25) | 25–98 | `b5d564e2c6ce4ee338ac1adc21700f3f5759e7e68264a40044c68f4a27421908` |
| [src/renderer/src/components/pull-request-page/checks/refresh.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/checks/refresh.ts:25) | 25–117 | `1cfade8b39a308f95526850a5347537783a20118a98cee9810fcf95e4970acf1` |
| [src/renderer/src/components/pull-request-page/conversation/reply.ts:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/conversation/reply.ts:20) | 20–77 | `ce7e0c5f87fc45e9904750f2fba3fa06ab158e258972c8b7454a67e5d17bfc17` |
| [src/renderer/src/components/pull-request-page/page/surface.tsx:45](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/page/surface.tsx:45) | 45–150 | `942b811972b21a769accb91c9e3bee96290c0d9f32f3da22734d8ca860f3c264` |
| [src/renderer/src/components/pull-request-page/page/use-details.ts:30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/page/use-details.ts:30) | 30–244 | `58772a30b83b31412e6f3baf36814b1ad0f0c07bbd4917c50185c4fd12c707dd` |
| [src/renderer/src/components/pull-request-page/reviewers/request-actions.ts:50](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/pull-request-page/reviewers/request-actions.ts:50) | 50–269 | `5be0921962a456eb3c9ff22c4c1276a14008601f3c1f8c5232746eb4e3070555` |
| [src/renderer/src/components/right-sidebar/ChecksPanel.tsx:130](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/ChecksPanel.tsx:130) | 130–191 | `541fe2d9c4d2bfa86cb4a5016d82eaaa226c78abfc10275f3ecf1d5c1109e1c6` |
| [src/renderer/src/components/right-sidebar/SourceControl.tsx:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/SourceControl.tsx:1) | 1–61 | `1e843522b6ab1cf2b0965bafd8ddb108b5ae50100afd567da92789d7927d4405` |
| [src/renderer/src/components/right-sidebar/checks-panel/gitlab-review-client.ts:15](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/checks-panel/gitlab-review-client.ts:15) | 15–83 | `d189bb7d999cbf8e9b002adfe30022351365a35b6ba821a324338de5cce95c86` |
| [src/renderer/src/components/right-sidebar/checks-panel/use-checks-panel-manual-refresh.tsx:65](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/checks-panel/use-checks-panel-manual-refresh.tsx:65) | 65–351 | `b5d0dabfb88b2a38ba3705e26ea53966d63aa22a3a61e6309dd4c178f792f4d1` |
| [src/renderer/src/components/right-sidebar/checks-panel/use-checks-panel-polling.test.tsx:100](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/checks-panel/use-checks-panel-polling.test.tsx:100) | 100–243 | `9baaac50f864f4ea0f278aaf274a36a956c68cd8e90182a5a6eba38e5cd7c423` |
| [src/renderer/src/components/right-sidebar/checks-panel/use-checks-panel-polling.tsx:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/checks-panel/use-checks-panel-polling.tsx:35) | 35–276 | `1bb4e9978842ae2f6ae231122c054c84c89a90e5409d08692362904fcfa79611` |
| [src/renderer/src/components/right-sidebar/source-control/commit/use-commit-action.ts:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/commit/use-commit-action.ts:35) | 35–165 | `b1f949e01fe3fa111a75a414a8f6b9f3259da12ba9d93550631a5bab76892fcc` |
| [src/renderer/src/components/right-sidebar/source-control/commit/use-commit-message-generation.ts:60](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/commit/use-commit-message-generation.ts:60) | 60–310 | `f81f841aa08776161805f04fe5d06a7700736b07423cce2511a24a8e092fe801` |
| [src/renderer/src/components/right-sidebar/source-control/commit/use-entry-mutations.ts:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/commit/use-entry-mutations.ts:20) | 20–155 | `20ba98c5a85ddc25de2c890bfa3c11f0af3e59b92d22a5810b6387a9f2e41fd8` |
| [src/renderer/src/components/right-sidebar/source-control/panel/use-panel-model.ts:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/panel/use-panel-model.ts:40) | 40–196 | `bd670eee0870c25772b1c8798ba50fb7b2507e25870cfa45ccbff46da6f7a316` |
| [src/renderer/src/components/right-sidebar/source-control/review/use-action-model.test.tsx:60](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/review/use-action-model.test.tsx:60) | 60–78 | `2519aa269fa4cb2c49776142a68c9cd8902c98d96ab97f7c4d5eb435829490e5` |
| [src/renderer/src/components/right-sidebar/source-control/sync/use-remote-action-runner.ts:85](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/source-control/sync/use-remote-action-runner.ts:85) | 85–244 | `8d10d9f40d8b45c973da6e8a25ada23ac253a1ad5d778963b3fad0e34dd86d57` |
| [src/renderer/src/components/settings/AccountsPane.tsx:85](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/AccountsPane.tsx:85) | 85–185, 190–285 | `2f0872d630fe349ca8d56050b99c9d83aaabcd676310139bbc0d2e12ab2a2176` |
| [src/renderer/src/components/settings/GrokAccountsSection.test.tsx:59](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/GrokAccountsSection.test.tsx:59) | 59–68 | `5ed1ad615f552432d632270b2a01b41e2630b6eb7192a8e10658156ac0d98a1b` |
| [src/renderer/src/components/settings/GrokAccountsSection.tsx:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/GrokAccountsSection.tsx:20) | 20–151 | `1cb69510c79c0c7d6faa20085a93745ca5fad1cc728a85f3e737bb3d93bd094d` |
| [src/renderer/src/components/settings/PrivacyDiagnosticBundleControls.tsx:46](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/PrivacyDiagnosticBundleControls.tsx:46) | 46–139 | `3c1c8890982a7851388ec53ab67b2c7a8b76642ddcab1924440c4f5aa4d93fd7` |
| [src/renderer/src/components/settings/PrivacyDiagnosticsSection.tsx:30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/PrivacyDiagnosticsSection.tsx:30) | 30–176, 178–259 | `4823af959255a993f2118b79d98d7eeb67ef2ce1e91ad6c4131cf50d1a7c577a` |
| [src/renderer/src/components/settings/SettingsSection.tsx:54](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/SettingsSection.tsx:54) | 54–67 | `7b34b08d41aa86fb8b077d3aa61e539fbbfc363ebeed1cb8f9a7788b182bfdd8` |
| [src/renderer/src/components/settings/SettingsSidebar.tsx:56](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/SettingsSidebar.tsx:56) | 56–94 | `814c08cd2e531a3109c8cc2459deb7f7bbcc3eaec8cbbf42981783d5a1972297` |
| [src/renderer/src/components/settings/accounts-pane-account-actions.ts:44](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/accounts-pane-account-actions.ts:44) | 44–211 | `d876084d88b53f3aea7763df440f97834484a72b1bfdb9d4a80450901c9d838c` |
| [src/renderer/src/components/settings/settings-search.test.ts:14](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/settings-search.test.ts:14) | 14–153 | `9954b07a908f3cf1f3c65a2dc67dc43536bea86d37faa73aada3d6b6957b49bb` |
| [src/renderer/src/components/settings/settings-search.ts:56](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/settings-search.ts:56) | 56–162 | `6e69136532e711f8f5d8d22930546e734449d2bba357087a4a4477768b6a8ee5` |
| [src/renderer/src/components/settings/use-settings-navigation-model.ts:130](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/use-settings-navigation-model.ts:130) | 130–183 | `80013c9f5d92695fbe988e032ae4ded404d7326f325c729cdfd2ed3c64880989` |
| [src/renderer/src/components/sidebar/AgentDashboardSidebarEntry.tsx:61](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/AgentDashboardSidebarEntry.tsx:61) | 61–94 | `f6bfe13e3bc3b43e86e5b3846b45aed0b622acc594134cbcf73098ef565a51dc` |
| [src/renderer/src/components/status-bar/status-bar-claude-accounts.ts:176](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/status-bar/status-bar-claude-accounts.ts:176) | 176–184 | `c48bfafb92c8df1a93fc36cb306bc9955c5c6da455491069758d8c950f89fec8` |
| [src/renderer/src/components/status-bar/status-bar-codex-accounts.ts:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/status-bar/status-bar-codex-accounts.ts:35) | 35–140, 178–186 | `a4ba76923dddf145d4b31560977740ad41766d10feb45fdcb91a80bade0efdbd` |
| [src/renderer/src/components/tab-bar/web-runtime-tab-move-mirror.ts:9](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-bar/web-runtime-tab-move-mirror.ts:9) | 9–22 | `de33027b9e52c252186c0e642da568b090c748f4521d628527b69c17546d36f2` |
| [src/renderer/src/components/tab-group/TabGroupSplitLayout.test.ts:111](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-group/TabGroupSplitLayout.test.ts:111) | 111–189 | `56185273053e2d1ce23e605422a3bfdeb57677cb1c20aa885be25d1ee38cccaa` |
| [src/renderer/src/components/tab-group/TabGroupSplitLayout.tsx:30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-group/TabGroupSplitLayout.tsx:30) | 30–245, 265–360 | `cfd69b847d4aba7b75fe627f62ede9f0a3979ac80758cdc66f6fbb6c42be9abd` |
| [src/renderer/src/components/tab-group/tab-drag-drop-commit.ts:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-group/tab-drag-drop-commit.ts:20) | 20–179 | `feeaa0a402abe4ee8254ec2961572c1b3decca548477bf6f07b55d432484c5c9` |
| [src/renderer/src/components/tab-group/useTabDragSplit.ts:40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-group/useTabDragSplit.ts:40) | 40–258 | `ff91a26b9d321538961b6457375698b6fa7a67ac72328ede4bf927e8fe885ea5` |
| [src/renderer/src/components/task-page-github-landing-refresh-run.tsx:260](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page-github-landing-refresh-run.tsx:260) | 260–398 | `04c1aa7c0703e2fbf29cc27f611e045e65cc1514c30c857e00eef2a4545111d5` |
| [src/renderer/src/components/task-page-jira-load-state.test.ts:5](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page-jira-load-state.test.ts:5) | 5–65 | `c36982d3bd1863b127b6353f130fa7813f0d4e95f0f6a8bcdb008e0c889da752` |
| [src/renderer/src/components/task-page/Content.tsx:28](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page/Content.tsx:28) | 28–58, 28–75 | `3cdfc07d981f5ea26dca153ed419ced844375c46d183c93a314a6d0c91e423be` |
| [src/renderer/src/components/task-page/TaskPage.tsx:43](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page/TaskPage.tsx:43) | 43–84 | `fede2e83139c18cf8154310c187824c6b7e11222cfce043470bf1e52d0e7aa54` |
| [src/renderer/src/components/task-page/gitlab/Dialog.tsx:15](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/task-page/gitlab/Dialog.tsx:15) | 15–29 | `af867a5a5498023d4e619b9fc1566207012db69fc69d590a6e7a5ac3b35cf5e0` |
| [src/renderer/src/components/terminal-pane/TerminalProcessExitOverlay.test.tsx:10](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/TerminalProcessExitOverlay.test.tsx:10) | 10–44 | `4b6648faeaf07dae9b2bac30176d35b58abf579e4d01c41e67d5886d5c5a59d2` |
| [src/renderer/src/components/terminal-pane/TerminalProcessExitOverlay.tsx:15](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/TerminalProcessExitOverlay.tsx:15) | 15–61 | `b6a2d2623ee31c314bbe068d6ba22e1632e62f35ff108e6a39f40522eec8a72d` |
| [src/renderer/src/components/terminal-pane/pty-connection-session-liveness.test.ts:175](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/pty-connection-session-liveness.test.ts:175) | 175–275, 540–614 | `7e606947e9dc636da1cc8ebc3c5cc5c5530240e7ece832ff5d6bd678646420a6` |
| [src/renderer/src/components/terminal-pane/pty-connection/connect-pane-pty.ts:175](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/pty-connection/connect-pane-pty.ts:175) | 175–242 | `63d84862cf34684dad4fbbeb493d0e0dea7192afa8847ee9251e308fc4853284` |
| [src/renderer/src/components/terminal-pane/pty-connection/pty-exit-hibernate.ts:167](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/pty-connection/pty-exit-hibernate.ts:167) | 167–344 | `321e2a4c84ba77c66f41c6a84dbc52739300bb3076a9a310b621be0c9a1b0bda` |
| [src/renderer/src/components/terminal-pane/pty-connection/session-reconcile-dispose.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/pty-connection/session-reconcile-dispose.ts:1) | 1–160 | `d2163bd0a9bdb51274b82ae145ad24e149a7504058bfc4ed40dbee5bf1f5bd60` |
| [src/renderer/src/components/terminal-pane/terminal-dead-session-reconcile.ts:20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-dead-session-reconcile.ts:20) | 20–125 | `56e72f7ab9fbdd136f90a421baea9ad4a0f85d70cf52f459ba6bde80005115be` |
| [src/renderer/src/components/use-task-page-detail-routing.ts:30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-detail-routing.ts:30) | 30–183 | `e9663e956ab92d625d244cebb72f946913f01b3a4122cfa83ad2d85bc08365ca` |
| [src/renderer/src/components/use-task-page-github-landing-refresh.ts:15](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-github-landing-refresh.ts:15) | 15–28 | `a5834b4cb96bda0f153d97de79b72b725c79250b70a87ed160bc19fc6fc6e525` |
| [src/renderer/src/components/use-task-page-gitlab-loading.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-gitlab-loading.ts:25) | 25–183 | `4adbfa867ae0af96e96cd4eeb212225bdce70fc3af739cb6091d1e45e7cb8b06` |
| [src/renderer/src/components/use-task-page-global-effects.ts:29](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-global-effects.ts:29) | 29–115 | `e72183f90acd338d001113f2768db5a510e002efee9f49fb8a5721c4c7cdd48d` |
| [src/renderer/src/components/use-task-page-jira-list-effects.ts:39](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-jira-list-effects.ts:39) | 39–154 | `ba94f6c7c425ebc6b4ec9ac683b5063accc08e91e7477730738dd1848c755f2c` |
| [src/renderer/src/components/use-task-page-linear-collection-effects.ts:39](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-linear-collection-effects.ts:39) | 39–184 | `b1a2f09b14ddf2c1a7e49e0d9bfd6a1faf5c27d266b26b75833b433a5ee18492` |
| [src/renderer/src/components/use-task-page-provider-state.ts:27](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-provider-state.ts:27) | 27–87 | `8a38db35d0fc7934e25273e67fd3c8234be25de120adfb050e037767454be598` |
| [src/renderer/src/components/use-task-page-source-availability.ts:38](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-source-availability.ts:38) | 38–148 | `73a9a5eaf62649a54308e443e568c12ceea1c987d39fb1d819e142bc96584d8f` |
| [src/renderer/src/lib/shutdown-checkpoint-guard.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/shutdown-checkpoint-guard.ts:25) | 25–78 | `12731c56e8b1bcd7e9d7c43d5d98cedb8a203a80e57cd5d835743f11fd6023d8` |
| [src/renderer/src/runtime/runtime-file-mutation-client.ts:32](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-file-mutation-client.ts:32) | 32–55 | `bd35bb747589b1fbb35db24afaeeb621a429d2c3268b47525cecef0bea5c0d97` |
| [src/renderer/src/runtime/runtime-file-read-client.ts:27](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-file-read-client.ts:27) | 27–77 | `06a2726eb265e154f5519453b58d585bd6a74876867206c822e9f697661f41c4` |
| [src/renderer/src/runtime/runtime-jira-client.ts:114](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-jira-client.ts:114) | 114–145 | `ed467ce046bf4c70bee4f4897ed332c02ec0dff8f4e2b801b25fe216468d4c53` |
| [src/renderer/src/runtime/runtime-linear-client.ts:185](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-linear-client.ts:185) | 185–240 | `c7702cdbf48e67774fe95059f04b32f5aaf1c3c5d87abe2ae02f8dfa8291fd33` |
| [src/renderer/src/runtime/runtime-provider-accounts-client.test.ts:119](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-provider-accounts-client.test.ts:119) | 119–183, 378–399, 402–466 | `3fef6b08624cab1d6287c747ebfea14d7997ba611982c23e19135e588b4f8506` |
| [src/renderer/src/runtime/runtime-provider-accounts-client.ts:38](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-provider-accounts-client.ts:38) | 38–302 | `35838dca7070872e81726fff2a361a1c015b70608c41ee323bdaf42f235a7754` |
| [src/renderer/src/startup/startup-degraded-recovery.ts:22](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/startup/startup-degraded-recovery.ts:22) | 22–104 | `cae8fd502383494ff9d68f1228111139116f56b33670ec72a91cf510c8a17056` |
| [src/renderer/src/store/github/work-item-aggregate-actions.ts:42](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/github/work-item-aggregate-actions.ts:42) | 42–105 | `10ceba1bfdda75f5063d0bf919a54dd37d16239ebd2aa97389d2f7eee751605c` |
| [src/renderer/src/store/github/work-item-fetch-actions.ts:105](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/github/work-item-fetch-actions.ts:105) | 105–155 | `83ca8d447ceb71f859b49c02581924f7ba734c1a235dbcabf33c065ad9c84348` |
| [src/renderer/src/store/github/work-item-routing.ts:109](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/github/work-item-routing.ts:109) | 109–192 | `090f825e7fcfccc9b0f611e14b2beb6d8d5ac097993764c48f8a91fa37f93338` |
| [src/renderer/src/store/slices/browser/browser-tab-actions.ts:31](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser/browser-tab-actions.ts:31) | 31–155 | `8972fd48f3c10d2e82a3b6d79f3eeeb1fb58d3eb2fad297ffc12452675544109` |
| [src/renderer/src/store/slices/settings-search-state.test.ts:25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/settings-search-state.test.ts:25) | 25–55 | `a251cddf0604d054b2100058fc295f7ec398d71013a019b874049808d444a228` |
| [src/renderer/src/store/slices/settings-search-state.ts:9](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/settings-search-state.ts:9) | 9–39 | `a249a7ad7f55cba111a815a4af9eab50abc3d671637f9feda4d67d682192b722` |
| [src/renderer/src/components/use-task-page-linear-list-effects.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-task-page-linear-list-effects.ts:1) | 1–293 | `4f5993833287a1cdb85b5be3f36361d21fbac809b67405bd2d200ecc9edc3410` |

Artifact checks passed: exact 13 assigned IDs, all 50 named feature records, all 19 invariant identities, 110 valid pinned source/hash/range records, 17 existing assertion-file references and five unchanged snapshot hashes. Product tests executed by this worker: zero.
