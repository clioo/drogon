# E3 consumer and ingestion final source reconciliation

This delivery characterizes the six assigned consumer contracts (13 push identities) and three ingestion input boundaries (25 named methods). It proposes only their immediate source gate for independent root review. It does not accept E3, the full audit, executed tests, or product parity.

Audit remains **10/12 (83.3%, medium-low confidence), delta0**. Next milestone is root acceptance of these nine contracts and the separately assigned DR result partitions. The 24-hour deadline remains at risk because baseline/port, behavioral RED/GREEN, platform fixtures and integrated fidelity remain outstanding. No product or provider tests, Git commands, installs, live runtime changes or source edits ran.

The machine-readable companion [consumer-ingestion-final.json](consumer-ingestion-final.json) contains every exact assigned ID/method, original allocation, structural preload/named types, per-contract results/errors, source/assertion range hashes and inherited BM/R/F/D obligations. The pinned reference is `c97906287bb7a390b25e2025b600d9fb3c25d9c3`; this task checked working bytes, without Git or a new blob comparison. Root’s earlier pinned-source verification remains distinct evidence.

## Fixed identity reconciliation

| Contract | Push IDs and channels | Consumer methods |
|---|---|---|
| PEND-E1-AUTOMATION | E3-PUSH-006: automations:changed<br>E3-PUSH-007: automations:dispatchRequested | emitAutomationsChangedWindowEvent<br>useAutomationDispatchEvents<br>handleAutomationDispatchRequest |
| PEND-E1-NATIVECHAT | E3-PUSH-039: nativeChat:appended | nativeChat.subscribe<br>useNativeChatLiveSession |
| PEND-E1-CREATE | E3-PUSH-065: ui:newBrowserTab<br>E3-PUSH-066: ui:newMarkdownTab<br>E3-PUSH-068: ui:newTerminalTab | openNewBrowserTabInActiveWorkspace<br>createFloatingWorkspaceBrowserTab<br>openNewMarkdownInActiveWorkspace<br>createFloatingWorkspaceMarkdownTab<br>createWebRuntimeSessionTerminal<br>createTab<br>createFloatingWorkspaceTerminalTab |
| PEND-E1-SLEEP | E3-PUSH-077: ui:resumeSleepingAgents<br>E3-PUSH-081: ui:sleepDashboardWorkspace<br>E3-PUSH-082: ui:sleepWorktree | createBackgroundSleepingAgentWakeDispatcher.request<br>wakeSleepingAgentsForWorktreeInBackground<br>runSleepWorktree |
| PEND-E1-SPAWN | E3-PUSH-083: ui:spawnDashboardAgent | launchDashboardAgent |
| PEND-E1-SWITCH | E3-PUSH-085: ui:switchTab<br>E3-PUSH-086: ui:switchTabAcrossAllTypes<br>E3-PUSH-087: ui:switchTerminalTab | handleSwitchTab<br>switchFloatingWorkspaceTab:same-type<br>handleSwitchTabAcrossAllTypes<br>switchFloatingWorkspaceTab:all-types<br>handleSwitchTerminalTab<br>switchFloatingWorkspaceTab:terminal |

The ingestion partition is UIG-CLAUDE9, UIG-CODEX7 and UIG-OPENCODE9. Shared aggregation is explicitly reused under two provider identities. There are no duplicate or omitted assigned IDs. 081 and082 share runSleepWorktree; they remain two wire identities. Same-type/all-types/terminal cycling is distinct from E1’s accepted MRU contract.

## Accepted evidence and qualifications

- **E1-FG-03**: [exact accepted contract](docs/migration/audit-closure/e1-ui/followup-final-source-gaps.json#/contracts/2). MRU/floating geometry is not proof of three index-cycle handlers. Accepted thirteen-route TABS split lifecycle remains authoritative for drag rollback; it is not equivalent to floating resize cancel. CLI install/WSL effects retain E3 remaining-callback and E5 installation contracts. PUI-TERM-003 is quick commands, not Windows registration.
- **E1-FG-05**: [exact accepted contract](docs/migration/audit-closure/e1-ui/followup-final-source-gaps.json#/contracts/4). Owner-fenced file mutation client; files backend result remains DR allocation. runtime-file-mutation-client routes readDir/write/createDir/createFile/rename/copy/delete to files.* RPC with 15-second timeouts and SSH expectations, or explicitly permitted local fs fallback. Authoritative mutation execution/TOCTOU and OS watchers belong to E3 filesystem/host execution feature waves; this reads actual renderer authority, not only a file count. RPC preflight calls status.get with required capability and retains expected pairing revision before write.
- **E1-FG-06**: [exact accepted contract](docs/migration/audit-closure/e1-ui/followup-final-source-gaps.json#/contracts/5). Reuse full accepted body including its limits and owed tests. nativeChat:readSession / subscribe / unsubscribe produce nativeChat:appended snapshot/replacement/appended frames. Default tail window 300; sender+subscription identity and pending cancellation guard watcher installation; setup rejection is caught silently, nonwatching subscription emits Transcript unavailable. Main decoders return typed messages/null; renderer consumes typed frames. PTY writes, structured journal, dictation capture, file upload and watcher IO remain explicit E3/host boundaries with full tests.
- **E1-FG-07**: [exact accepted contract](docs/migration/audit-closure/e1-ui/followup-final-source-gaps.json#/contracts/6). Reuse full accepted body including its limits and owed tests. Primary automation.list/runs/update/delete/runNow use runtime RPC with 15-second timeouts and id: selectors; owner action runner fences writes. External-manager/precheck/dispatch-result/renderer-ready are the ten leaf-listed ipcMain channels. Service ticks at 60 seconds, serializes due evaluation, emits skipped_missed/unavailable/refusal rows, dispatches to renderer/headless and collects final usage once. RetainedRunReconciler retries every two seconds, then marks unresolved ready-surface runs dispatch_failed after two minutes; actual host liveness is a separate mandatory contract.

E1 final JSON retains SHA256 `29ce969643b5eb223fa7352da36a58d170846e40742cf7cb290c8614533b329a`. The full accepted action/state/source/assertion/owed-test records are copied with precise pointers in JSON; titles alone are not used as ownership proof. PUI-SHELL-002, PUI-TERM-001, PUI-TABS-002 and PUI-DASHBOARD-001 caller anchors remain explicit; request authorization does not prove launch, sleep or service outcome.

- **SP09**: [accepted persistence contract](docs/migration/audit-closure/e2-settings/closure.json#/persistenceContracts/8); Invalidate projection cache; no schedule after quit flush. Generation bump,1s debounce/5s max pending window; waitForPendingWrite waits tracked write/view preferences, not future debounce. Scheduling is not durable completion.
- **SP10**: [accepted persistence contract](docs/migration/audit-closure/e2-settings/closure.json#/persistenceContracts/9); Exclude cache, strip retired settings, protected per-slot sentinels without mutating plaintext memory; payload vs stable guard hash differ. Retention commits later, normalize remote partition globals, preserve folder comments; not all settings encrypted.
- **SP11**: [accepted persistence contract](docs/migration/audit-closure/e2-settings/closure.json#/persistenceContracts/10); Serialize pending work; writesFrozen/hash no-op return without IO. Temp write/fsync then generation check/rename; recheck before hash/retention/backup. Sync flush invalidates pending generation; low-level tests do not establish whole controller.
- **SP13**: [accepted persistence contract](docs/migration/audit-closure/e2-settings/closure.json#/persistenceContracts/12); File fsync before rename, directory fsync best-effort by platform; async veto removes temp; Windows retry for sync replacement. Accepted isolated macOS14 cases are inherited evidence, not this task execution or power-loss/Windows/async order proof.

Root’s review advanced during the task from `ec64df0266253286c56d60cc7758fb537be95ce2f3975c5fba7f5197d0aa9403` to `0b2da0ef0681c180a541bc69caed7ebff50e3801232ae6b05a8303d7e24d2a52`. Its current domain/E1 qualifications were read; historical fingerprint remains provenance. Usage enable-before-persist, coalesced scan rather than disable cancellation, swallowed writer failure and unfenced stale UI results survive. Automation grace is not exit evidence. All frozen E3/E1/leaf inputs still match.

## PEND-E1-AUTOMATION

Reuse accepted E1-FG-07 actual editor/service/recovery contract; complete the run-completion watcher complement.

006 emits the existing AutomationsChangedPayload window notification; 007 admits AutomationDispatchRequest through the frozen renderer reuse/background-launch contract. Neither push returns a completion acknowledgment.

Completion observation is {status:'completed'|'dispatch_failed',outputSnapshot?:AutomationRunOutputSnapshot|null,error?:string|null}; finalize re-reads by automationId/runId, skips absent/final rows, preserves current workspace and terminal session/pane/PTY identities, normalizes omitted or null output/error to null before markDispatchResult.

Accepted E1-FG-07 owns owner-qualified create/update/move, reusable creation keys, read-after-ambiguous-delete, 15s RPCs, draft retention and refresh/close on success; copy of its full contract is in reusedContracts.

Service 60s serial due evaluation and skipped_missed/unavailable/refusal outcomes, renderer/headless dispatch and once-only final usage are the accepted contract, not inferred from callback registration.

Watcher Map keyed run.id prevents a second active observation. No current handle means watch does nothing; retained dispatching/dispatched runs enter readiness-gated reconciliation, 2s retry and 2min grace. Before persistence watcher re-reads final state; this is not a cross-process atomic compare-and-set claim.

Observer rejection while not aborted becomes dispatch_failed with user-safe error; persistence rejection is logged, not reported as success or retried here. Missing terminal after grace is stranded/unverifiable, never proof of exit. resolveRunTerminal can throw synchronously outside observation catch.

Partial cross-host automation move and stale UI/save outcomes retain accepted E1-FG-07 qualifications and tests.

Receiver/sender and captured host contracts remain frozen row006/007; renderer-ready is readiness, not terminal liveness. forget aborts one observation; dispose aborts all and disposes reconciliation. Abort does not kill a run; a provider ignoring abort may still settle unless current/final-state checks prevent write.

Source bodies: [src/main/automations/run-completion-watcher.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/automations/run-completion-watcher.ts:1) (through 182).

Original assertion bodies and source ownership are reused from E1-FG-07 and frozen row007; no new direct callback assertion body is claimed for this complement.

Unrun acceptance: CIF-AUTO, plus all inherited row-specific and complete original suites.

## PEND-E1-NATIVECHAT

Reuse E1-FG-06 main decoder/watcher/render contract and characterize the actual live hook, stream merger and incremental assembler.

Exact frame/message/block/lifecycle structures are reused from frozen push039 named schemas and accepted E1-FG-06, not asserted to be runtime-validated. Subscription payload requires matching subscriptionId; returned hook is NativeChatSession {messages,status,sessionId,agent,error?} plus {hasMore,loadingEarlier,loadEarlier,readPhase}.

Snapshots/replacements reset merger/base and append list; pending snapshot sets awaiting and cancels redundant read retry without consuming healthy seed. Error frame sets error without treating it as transcript. Appends merge by id and bound to current tail limit; an empty append retains array reference.

Stream merger replaces equal-source same-id at >= priority; assembler mergeOne replaces only strictly higher priority. Cross-source fallback turn identity is explicit turnId else role+normalized text+nontext digest; same-source repeated text remains distinct. Sort tiers ordinary, streaming, optimistic; null timestamps first within tier, then id. Adjacent image companion/prompt units stay atomic.

Owner/source/session changes rebuild effect and transcript epoch. Snapshot/replacement invalidates pagination epoch; loadEarlier ignores stale session/transport/epoch, preserves loaded transcript on error, and clears loading only for current epoch.

Lifecycle replacement/append/pagination revision controls feed status. Error wins; working overrides loading until a relevant completion/interruption (null timestamps accepted, real-clock 2s skew allowance) or eligible trailing-assistant fallback; working child veto except interruption. This is UI turn status, not process exit.

Reset rebuilds Maps; append fast path only new tail identities, otherwise full resort. Base changes reset incremental assembler; normalized displayed output may differ from raw status-tail source.

Typed frames/messages are trusted by these consumers; malformed absent/null frame, blocks, source or timestamp can throw/coerce, no new runtime schema guard implied. LoadEarlier rejection swallowed; seed errors visible only absent authoritative frame/appends. Same-id equal-priority differences between stream and assembler need a correction/characterization fixture, not a universal replacement claim.

Main sender+subscription and pending watcher cancellation are E1-FG-06. Disposer cancels retry/close stream and fences late callbacks; transport identity change resubscribes to new owner. UI Stop and lifecycle markers do not establish service interruption or SSH exit.

Source bodies: [src/renderer/src/components/native-chat/use-native-chat-live-session.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/native-chat/use-native-chat-live-session.ts:1) (through 381); [src/renderer/src/components/native-chat/native-chat-session-assembler.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/native-chat/native-chat-session-assembler.ts:1) (through 289); [src/renderer/src/components/native-chat/native-chat-incremental-assembler.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/native-chat/native-chat-incremental-assembler.ts:1) (through 116); [src/shared/native-chat-merge.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/native-chat-merge.ts:1) (through 120); [src/renderer/src/components/native-chat/use-native-chat-assembled-messages.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/native-chat/use-native-chat-assembled-messages.ts:1) (through 86); [src/renderer/src/components/native-chat/native-chat-live-status.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/native-chat/native-chat-live-status.ts:1) (through 168); [src/renderer/src/components/native-chat/use-native-chat-transcript-lifecycle.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/native-chat/use-native-chat-transcript-lifecycle.ts:1) (through 54); [src/renderer/src/components/native-chat/native-chat-live-message-preparation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/native-chat/native-chat-live-message-preparation.ts:1) (through 28); [src/shared/native-chat-image-transcript-markers.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/native-chat-image-transcript-markers.ts:1) (through 180).

Read assertion bodies:

- [src/renderer/src/components/native-chat/native-chat-incremental-assembler.test.ts:96](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/native-chat/native-chat-incremental-assembler.test.ts:96) through 199: Every fixture prefix deep-equals full rebuild; new arrays preserve prefix objects; empty append same reference; image companion normalization and distinct same-time pairs. Differential oracle shares merge code and is not independent provider truth.

Unrun acceptance: CIF-NCHAT, plus all inherited row-specific and complete original suites.

## PEND-E1-CREATE

Three separate content-creation push identities; local/floating creation and actual web-host outcome paths, including partial publication.

065 browser: local create returns BrowserWorkspace containing id/worktreeId/pageIds/activePageId, profile/partition/document location and mirrored page fields. Page has id/workspaceId/worktreeId,url,title,isLoading,favicon:null,canGoBack:false,canGoForward:false,loadError:null,createdAt and optional runtime/document metadata. URL trims, empty→about:blank, Kagi token redaction; undefined profile inherits default whereas null is explicit. Workspace state is written before createUnifiedTab, so later throw can leave it present.

066 Markdown: store action resolves void including caught errors; createWithTemplate returns FileInfo or null for cancel. Template absence/no listener means blank document. FileInfo includes mode:'edit',isUntitled:true and optional provenance; template documents set deleteUntouched:false. 100 candidate names untitled then untitled2..100, existence check plus creation collision retry; placeholder title/filename/localdate/time/datetime only, unknown placeholders retained.

068 terminal: local createTab returns UUID tab id, creates runtime/unified/group/layout state, ptyId:null and default/customTitle/color null with sort/createdAt and optional cwd/shell/launch/startup/claim fields. It queues startup; it does not spawn a PTY. createWebRuntimeSessionTerminalResult returns {outcome:{status:'created'}|{status:'failed',message:string},hostTabId?:string}; public createWebRuntimeSessionTerminal returns outcome only, with no tabId. hostTabId is included only when truthy. These are actual return expressions, not a declaration substituted for validated service results.

Remote terminal creates through agent-session compatibility or session.tabs.createTerminal (15s); after body dereference marks hostCreated, records placement/focus and refreshes snapshot. Placement settlement polls 250ms up to 10s but missing tab deadline resolves silently. Catch after hostCreated returns created to avoid duplicate launch; before it returns failed and restores selection. Structured compatibility only falls back on explicit unsupported/legacy-required or failed read-only capability probe, not ambiguous creation.

Remote browser stages known UUID/provisional handle and captured owner before 15s create. Live preparation chooses placement. Optional waitForRegistration defaults false; true omits navigation URL at create then sends goto with warn-only failure. Rehomes/adopts returned page, tolerates failed refresh only if already visible, requires materialization in target group or older-host fallback group. Returns true only on completion; false on definitively failed/cleaned cancellation; throws on unknown outcome or unconfirmed cleanup.

Focused floating workspace routes all three locally: browser runtimeEnvironmentId:null, terminal activate:false then local focus, Markdown explicit directory/context and suppressed worktree fallback. Empty floating Markdown directory no-op.

Normal active worktree/group captured for creation. Desktop remote browser without stream capability intentionally stays local; web session without capability rejects. Terminal active web guard suppresses local fallback even if remote create failed. Local terminal activate defaults by !==false (null activates), metadata strings may trim/throw without runtime guard.

Markdown selects templates under .orca/templates depth8/max100, ignores symlink dirs/.git/node_modules and unknown extensions; picker only one current listener, unresolved pending picker is not canceled on unsubscribe. Store catches failures/toasts; prior pending statement implying all Markdown rejections unhandled is corrected.

Template write failure best-effort deletes newly created file; changed ownership assertion prevents deleting on new host and can leave orphan. Browser local state/unified writes and terminal telemetry are not one rollback transaction; failed later step may leave created state. Durable persistence reuses accepted PUI-SHELL-002 and E2 SP09/SP10/SP11/SP13 contracts; no awaited disk flush from push.

Browser cancellation races are checked after service create and materialization; cleanup must close known remote page, confirm no remaining visible page, and unwind only still-staged owned state. Definitive code list includes browser_error, capability_unsupported, invalid_argument/params, method_not_found, queue_overloaded, selector_ambiguous/not_found, unauthorized; ambiguous old host without identity cannot be called safely canceled.

Terminal malformed remote response can fail before hostCreated marker even when service acted. Group-move response is not unwrapped here. Created-but-unreconciled result is intentionally not launch/visibility proof. Local terminal listener has no outer catch; browser helper catches/toasts; Markdown store catches/toasts.

Captured owner/provenance and pairing/tracking generation fence file/remote actions; actual files.* and agentSession/session.tabs service result semantics stay independently assigned DR owners. This report reads local operation and mirror applicator bodies rather than calling unread local code external. Listener disposal only stops future events, not in-flight creation. Native Electron guest, provider process, filesystem/native driver behavior requires fixture/platform gates.

Source bodies: [src/renderer/src/hooks/ipc-events/content-creation-ipc-bridge.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/content-creation-ipc-bridge.ts:1) (through 133); [src/renderer/src/hooks/ipc-events/tab-lifecycle-ipc-bridge.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/tab-lifecycle-ipc-bridge.ts:1) (through 80); [src/renderer/src/hooks/ipc-events/tab-lifecycle-ipc-bridge.ts:175](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/tab-lifecycle-ipc-bridge.ts:175) (through 213); [src/renderer/src/lib/floating-workspace-tab-creation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-tab-creation.ts:1) (through 91); [src/renderer/src/store/terminals/terminal-tab-creation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/terminals/terminal-tab-creation.ts:1) (through 282); [src/renderer/src/store/terminals/terminal-workspace-routing.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/terminals/terminal-workspace-routing.ts:1) (through 110); [src/renderer/src/store/slices/browser/browser-tab-actions.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser/browser-tab-actions.ts:1) (through 253); [src/renderer/src/store/slices/browser/browser-tab-actions.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser/browser-tab-actions.ts:1) (through 159); [src/renderer/src/store/slices/browser-page-records.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser-page-records.ts:1) (through 150); [src/renderer/src/store/slices/editor/actions/markdown-preview-actions.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/markdown-preview-actions.ts:1) (through 200); [src/renderer/src/lib/create-untitled-markdown.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/create-untitled-markdown.ts:1) (through 183); [src/renderer/src/lib/markdown-document-templates.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/markdown-document-templates.ts:1) (through 233); [src/renderer/src/lib/markdown-template-picker-request.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/markdown-template-picker-request.ts:1) (through 56); [src/renderer/src/lib/client-creation-action-policy.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/client-creation-action-policy.ts:1) (through 116); [src/renderer/src/runtime/web-runtime-terminal-create-operation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/web-runtime-terminal-create-operation.ts:1) (through 297); [src/renderer/src/runtime/web-runtime-terminal-placement-settlement.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/web-runtime-terminal-placement-settlement.ts:1) (through 38); [src/renderer/src/runtime/web-runtime-browser-creation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/web-runtime-browser-creation.ts:1) (through 255); [src/renderer/src/runtime/web-runtime-browser-creation-context.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/web-runtime-browser-creation-context.ts:1) (through 265); [src/renderer/src/runtime/web-runtime-browser-creation-failure.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/web-runtime-browser-creation-failure.ts:1) (through 118); [src/renderer/src/runtime/web-runtime-browser-tab-staging.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/web-runtime-browser-tab-staging.ts:1) (through 184); [src/renderer/src/runtime/web-runtime-terminal-creation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/web-runtime-terminal-creation.ts:1) (through 65).

Read assertion bodies:

- [src/renderer/src/store/slices/editor/actions/markdown-preview-actions.test.ts:35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/markdown-preview-actions.test.ts:35) through 63: Mocked creation: target group, preview:false, focusEditor:true and interaction.
- [src/renderer/src/lib/create-untitled-markdown.test.ts:18](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/create-untitled-markdown.test.ts:18) through 225: Owner preflight, EEXIST next names, 100 exhaustion, SSH same filesystem, template placeholders/pick/read/write; whole file retained.
- [src/renderer/src/lib/floating-workspace-terminal-actions.test.ts:445](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-terminal-actions.test.ts:445) through 574: Terminal local identity/activate:false despite active runtime; browser runtime:null/group; Markdown suppress fallback and cancel.
- [src/renderer/src/store/slices/browser-remote-tab-creation.test.ts:37](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser-remote-tab-creation.test.ts:37) through 187: Web local rejection, missing capability, correct owning runtime request, desktop local fallback, failed remote creation does not create local tab.

Unrun acceptance: CIF-CREATE-LOCAL, CIF-CREATE-REMOTE, CIF-MIRROR, plus all inherited row-specific and complete original suites.

## PEND-E1-SLEEP

081 and 082 explicitly reuse the same sleep implementation; 077 owns readiness-deduped background wake and resume admission.

runSleepWorktree resolves Promise<void>, including per-worktree caught failures. Browser shutdown precedes terminal shutdown {keepIdentifiers:true}, then optional VM suspend; failure skips later steps for that worktree, continues others, aggregates toast and restores failed active workspace. It is partial completion, not atomic sleep.

Remote terminal.sleep result guard requires object, nonnegative integer stopped, string arrays stopped/live, postStopVerified===true, and absent error/remaining fields (present null is not absent). No general count/array consistency proof. Only method_not_found permits legacy fallback: stop, up to8 fresh full/nontruncated terminal.list checks, 250ms intervals, 15s overall/5s requests, connected:true+nonempty pty means live. Invalid/error/contact loss yields unverified, not exited.

Local kill uses allSettled; fulfilled false or undefined counts stopped because only rejection is tested. Stopped tabs clear live bindings/status but retain identifiers, layout, title/history/restart intent and sleeping records. Partial failure restores failed handlers/flags; it cannot restore already stopped processes or closed browsers.

Background dispatcher request dedupes worktree IDs until session-ready. Flush clears/unsubscribes before wake; disposal clears queued requests only. Wake returns count of queued tab launches, not verified starts. Unverifiable owner returns0 and retains sleeping records; stale/passive/deduped records may be removed or display-only according to claim/active pane rules.

Active-sleep intent precedes clearing active workspace; preserve primary nonpinned sidebar scroll through up to12 animation frames, restore failed active and finally clear intent.

Browser cleanup removes page/workspace/state, annotations/certs/focus and handles, adjusts active neighbor/unified tabs and recent close history. destroyPersistentWebview Promise is discarded by cleanup, so awaiting browser shutdown does not await native unregister acknowledgment before PTY stop.

Wake chooses preserved pane/live existing tab/parseable tab/oldest record, clears duplicate records, schedules targeted background mount (whole-worktree fallback if needed). Stable pane claims require matching layout leaf/worktree/provider/session identity; passive completed panes are display only.

Resume plan from captured launchConfig, host shell and provider session options; null plan toasts/no launch. createTab queues startup and claim with activate:false/suppress navigation; sleeping record cleared immediately after tab creation, before later ordering/callback. A later throw can leave queued tab with cleared record.

Browser failure skips PTY; PTY failure skips VM; VM failure follows already stopped PTY. Native unregister rejection is swallowed/discarded downstream; no durable native completion acknowledgment.

Direct SSH ownership helper treats offline/error prehydration as none, allowing resume despite unverified previous owner. This is a characterized source defect; intended behavior must retain unverifiable until authority proves eligible ownership, not silently reproduce local duplicate launch.

Flush clears queue before loop; a thrown wake can lose unvisited IDs. Disposer does not undo launched tabs, native requests, pending mirror or process effects.

Keep duplicate worktree IDs host-qualified, folder-workspace exceptions, Windows shell/WSL routing and SSH live/unverifiable/exited. Accepted PUI-TERM-001 liveness remains authoritative; sleep grace/readiness/absence alone is not exit. Session persistence is separate SP/PUI-SHELL contract, not sleep push acknowledgment.

Source bodies: [src/renderer/src/components/sidebar/sleep-worktree-flow.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/sleep-worktree-flow.ts:1) (through 220); [src/renderer/src/store/terminals/terminal-shutdown.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/terminals/terminal-shutdown.ts:1) (through 172); [src/renderer/src/store/terminals/terminal-shutdown-guards.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/terminals/terminal-shutdown-guards.ts:1) (through 185); [src/renderer/src/store/terminals/terminal-shutdown-state.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/terminals/terminal-shutdown-state.ts:1) (through 194); [src/renderer/src/runtime/remote-worktree-sleep.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/remote-worktree-sleep.ts:1) (through 180); [src/renderer/src/store/slices/browser/browser-close-actions.ts:200](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser/browser-close-actions.ts:200) (through 250); [src/renderer/src/store/slices/browser/browser-close-actions.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser/browser-close-actions.ts:1) (through 200); [src/renderer/src/store/slices/browser-webview-cleanup.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser-webview-cleanup.ts:1) (through 78); [src/renderer/src/components/browser-pane/host-guest/webview-registry.ts:187](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/webview-registry.ts:187) (through 288); [src/renderer/src/lib/wake-sleeping-agents-in-background.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/wake-sleeping-agents-in-background.ts:1) (through 219); [src/renderer/src/lib/resume-sleeping-agent-session.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/resume-sleeping-agent-session.ts:1) (through 272); [src/renderer/src/lib/sleeping-agent-session-launch.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/sleeping-agent-session-launch.ts:1) (through 134); [src/renderer/src/lib/sleeping-agent-pane-ownership.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/sleeping-agent-pane-ownership.ts:1) (through 190); [src/renderer/src/lib/workspace-terminal-host-authority.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/workspace-terminal-host-authority.ts:1) (through 173); [src/renderer/src/components/terminal/background-terminal-worktree-mount.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal/background-terminal-worktree-mount.ts:1) (through 352).

Read assertion bodies:

- [src/renderer/src/components/sidebar/sleep-worktree-flow.test.ts:66](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/sleep-worktree-flow.test.ts:66) through 278: All10 test bodies: browser→terminal→VM order, intent/active ordering, scroll, background no-op, failures skip later steps/restore/toast and continue multiple worktrees; mocked services do not prove native stop.
- [src/renderer/src/lib/wake-sleeping-agents-in-background.test.ts:106](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/wake-sleeping-agents-in-background.test.ts:106) through 226: Readiness dedupe/drain/unsubscribe, wake before mount with suppressed navigation, whole-worktree fallback, canonical duplicate clearing and live existing preference.

Unrun acceptance: CIF-SLEEP, CIF-WAKE, plus all inherited row-specific and complete original suites.

## PEND-E1-SPAWN

Dashboard acceptance is expanded through immediate launch, structured unknown-outcome recovery and remote terminal paths.

launchDashboardAgent returns false for unknown owner-qualified worktree/disabled agent; otherwise activates workspace BEFORE launch and returns launchResult!==null. True means plan/request scheduled, not service outcome.

launchAgentInNewTab returns null or {tabId:string|null,startupPlan,pasteDraftAfterLaunch:boolean,focusAfterMenuClose?,promptDeliveryResult?}. Dashboard empty prompt permits empty startup plan; pending web path returns nonnull result with tabId:null while Promise runs. Local legacy creates queued startup/tab; structured route is local Codex only with exact flags, no custom args/env/cmd/session options, not floating/draft/Windows/WSL/repair-required, capability required.

Structured creation uses stable operation id/fingerprint, expectedFence:null and codex_UUID session identity. Caller reads returned sessionId/fence without a new runtime validator. Worktree pending Map dedupes launches; recover from adopted tab, refreshed snapshot or history tail1 with typeof-number fence, retries SAME intent once. Confirmed refusal abandons outbox and permits fallback once; unresolved outcome retains intent and warns, preventing duplicate legacy launch.

Remote dashboard branch reuses CREATE terminal operation explicitly. It prunes stale local agent tabs before/after remote creation. Empty prompt yields delivered:false even when tab created, so delivery is not launch failure. Caller group move may be partial; malformed service replies and unknown response ownership need fixtures.

Workspace selection can change despite failed launch. Structured publish/refresh can succeed before late failure; recovery tries visibility rather than assumes refusal. Canceled outbox/pending intent is separate from host process cancellation.

Provider startup plan resolves command/expectedProcess/followup and launchConfig; dashboard no prompt has no paste. Captured settings, owner platform/shell and enabled provider govern route. Full provider CLI execution is external fixture debt; no model inference executed.

Definitive refusal permits one fallback; transport ambiguity does not. Remote catch after hostCreated returns created even if mirror fails; exact reuse of CIF-CREATE-REMOTE. Promise failures not caught at every web launch caller can surface after state selection/pruning.

Cancellation marks intent/removes outbox; it does not terminate service session. Wrong owner/pairing and observed contact loss remain unverifiable. Popout authorization PUI-DASHBOARD-001 is reused only for request trust, not outcome; DR agentSession results remain independent.

Source bodies: [src/renderer/src/components/dashboard/launch-dashboard-agent.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard/launch-dashboard-agent.ts:1) (through 23); [src/renderer/src/lib/launch-agent-in-new-tab.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/launch-agent-in-new-tab.ts:1) (through 348); [src/renderer/src/lib/agent-launch-routing.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/agent-launch-routing.ts:1) (through 106); [src/renderer/src/lib/launch-agent-startup-prompt-plan.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/launch-agent-startup-prompt-plan.ts:1) (through 81); [src/shared/tui-agent-startup.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/shared/tui-agent-startup.ts:1) (through 270); [src/renderer/src/lib/launch-agent-web-host-tab.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/launch-agent-web-host-tab.ts:1) (through 146); [src/renderer/src/lib/structured-agent-session-launch.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/structured-agent-session-launch.ts:1) (through 267); [src/renderer/src/lib/structured-agent-session-launch-recovery.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/structured-agent-session-launch-recovery.ts:1) (through 155); [src/renderer/src/lib/launch-structured-codex-session.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/launch-structured-codex-session.ts:1) (through 87); [src/renderer/src/runtime/remote-agent-session-launch.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/remote-agent-session-launch.ts:1) (through 47); [src/renderer/src/runtime/web-runtime-terminal-create-operation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/web-runtime-terminal-create-operation.ts:1) (through 297).

Read assertion bodies:

- [src/renderer/src/components/dashboard/launch-dashboard-agent.test.ts:36](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard/launch-dashboard-agent.test.ts:36) through 45: Owner-qualified folder resolution, setActiveWorktree and mocked launch arguments/true; does not test real launch.

Unrun acceptance: CIF-SPAWN, CIF-CREATE-REMOTE, plus all inherited row-specific and complete original suites.

## PEND-E1-SWITCH

Distinct same-type, across-all-types and terminal-only index cycles; MRU E1-FG-03 is reused only as neighboring accepted evidence.

085 handleSwitchTab:boolean cycles only active type in active group's visible reconciled order; 086 handleSwitchTabAcrossAllTypes:boolean traverses all visible types. Both no-op without active worktree or≤1 eligible tabs, prefer exact unified group tab id over backing entity id, wrap via (index+direction+length)%length; missing current chooses first or last by direction sign.

087 handleSwitchTerminalTab:boolean filters terminals, allows sole terminal focus from editor/browser, and no-ops when sole already active. Worktree-wide fallback only for concrete hydration gaps, not legitimate split-local/editor-only group. It writes active terminal/type but does not call exact unified activateTab unlike same/all helper; duplicate split backing IDs require correction fixture.

activateCyclableTab applies terminal/browser/editor setters plus exact unified activation, simulator setter, agent-session unified activation, recipe focusGroup special case. Floating handlers operate focused floating worktree and local tab focus; browser notifies local page despite active web runtime. All results swallowed by one-way push, not persisted acknowledgment.

Visible group order reconciles stale legacy order with actual membership; existing active entity not interchangeable with unified identity. These three events are not MRU quick-toggle and colon/dot identity is not inferred.

No await for disk persistence or host process effect. Store setters are sequential; thrown later setter may leave partial active fields.

Preload annotation direction:1|-1 has no runtime guard. Same/all undefined/fraction/NaN can yield undefined next and return false; large negative remainder can be negative; zero may reselect current. Terminal-only directly dereferences next.id and can throw for invalid direction. String addition can coerce, so do not silently normalize as safe ±1. Characterization separate from intended strict input rejection.

Normal active worktree and active group vs focused floating ownership remain distinct. Disposer removes listener only; focus writes already performed persist under shared scheduler. No SSH exit claim from tab disappearance.

Source bodies: [src/renderer/src/hooks/ipc-tab-switch.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.ts:1) (through 385); [src/renderer/src/components/terminal/tab-type-cycle.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal/tab-type-cycle.ts:1) (through 122); [src/renderer/src/components/tab-bar/group-tab-order.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-bar/group-tab-order.ts:1) (through 272); [src/renderer/src/components/tab-bar/reconcile-order.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-bar/reconcile-order.ts:1) (through 51); [src/renderer/src/lib/floating-workspace-terminal-actions.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-terminal-actions.ts:1) (through 308).

Read assertion bodies:

- [src/renderer/src/hooks/ipc-tab-switch.test.ts:84](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.test.ts:84) through 422: Terminal forward/wrap/empty/sole/editor jump; hydration vs real split, same-type unified disambiguation, file/browser branch, all-types cross/wrap/sole. Original remaining MRU assertions preserved as whole file but not new coverage of these pushes.
- [src/renderer/src/lib/floating-workspace-terminal-actions.test.ts:585](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-terminal-actions.test.ts:585) through 685: Terminal cycle targets focused float; browser cycle remains local under active web runtime and notifies page.

Unrun acceptance: CIF-SWITCH, plus all inherited row-specific and complete original suites.

## Shared remote snapshot boundary

refresh snapshot Promise<void>; session.tabs.list15s followed by local generation decision, patch and settle. Default errors warn/swallow; errorMode:'throw' rethrows. Imports/capture outside try may reject. Domain result validation is independently assigned, not inferred here.

Captured pairing/connection/tracking fences; retired epoch/out-ranked/duplicate publication rejects apply, some out-ranked observations still settle mirror. Floating unmirrored rejects apply and settlement. Exact replay explicitly allowed.

Base removes pending-close entities and captures exact caller focus (id/leaf/current visibility). Retains other owners, maps provisional handoff, remote prefixes, ready/parked. Browser prep retains staged/restored and unconfirmed client-hosted pages, replaces only same-owner mirrored editors; local files survive.

Unified/group prep preserves client-owned placement/order/layout after first adoption; rekeys provisional handoff, appends new valid rows/dedupes and drops vanished rows, retains reserved empty groups. Host layout applies on initial adoption; older-host materialization may land different group with warning.

Terminal patch clears removed PTY/layout/unread and exact handoff startup/claims; browser patch clears removed handles/certs, adopts owned metadata, preserves client placement certificates. Worktree/group records reconcile membership, and active state changes global focus only for active worktree.

Final patch conditionally writes changed records; store commit precedes subscriber calls, subscriber failures logged without rollback; follow-on status bookkeeping caught. Mirror settlement checks pairing/tracking generation and full authoritative inventory/fresh host probe, never silence as exited.

Immediate snapshot operation and all nine apply stages read; shared terminal/browser row-builder, layout normalization, agent-status and notification details retain original F-PUSH-STATE/domain tests. They are local helpers, not external services or newly accepted whole-domain contracts; no recursive import audit or independent DR result claim.

The exact local helper stop lines are retained as CIF-LOCAL-DOMAIN-LIMIT in JSON. They are not relabeled native/external and no whole-domain acceptance is inferred. Independently assigned backend result groups own the service side of `session.tabs`, `agentSession`, `browser` and `files`; their live partials were not read or aggregated.

## Ingestion result structure and provider differences

Session {sessionId,firstTimestamp,lastTimestamp,primaryModel,hasMixedModels,primaryProjectLabel,hasMixedLocations,primaryWorktreeId,primaryRepoId,eventCount,totalInputTokens,totalCachedInputTokens,totalOutputTokens,totalReasoningOutputTokens,totalTokens,locationBreakdown[],modelBreakdown[],locationModelBreakdown[],providerMetrics}; daily {day,model:null|string,projectKey,projectLabel,repoId:null|string,worktreeId:null|string,eventCount,inputTokens,cachedInputTokens,outputTokens,reasoningOutputTokens,totalTokens,providerMetrics}. Nested location/model/location-model rows carry identifying labels/nullable ownership plus count/token totals and provider metrics.

Mutating fold, no runtime validation; null model maps to unknown sentinel, composite daily key ::. Finalize ranks model/location by totalTokens (Claude differs), Mixed models/Multiple locations labels, primary owner from top location, sessions descending lexical last timestamp; locationModel not explicitly final-sorted. Merge clones provider strategy/new daily row and combines nested metrics, no rollback on error.

Codex hasInferredPricing is OR-folded. OpenCode costUSD nullable addition. Claude separate cache-write fields/rank. Frozen domain store contracts retain schema mismatch full reset enabled:false for OpenCode; summaries include sessions/topModel/topProject.

### UIG-CLAUDE

9 exact named method boundaries; reuse frozen usage store/result/UI channels, without repeating24 factories.

**listClaudeTranscriptFiles** — [src/main/claude-usage/transcript-file-discovery.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/transcript-file-discovery.ts:1).

Promise<string[]> sorted raw-path dedupe of regular .jsonl files recursively under ~/.claude/projects and ~/.claude/transcripts. No symlink following or host authenticity check; module captures local homedir. Each root catch returns [] for that root, potentially losing earlier discoveries in a failed subtree; other root survives.

**readClaudeUsageScanFile** — [src/main/claude-usage/transcript-record-parser.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/transcript-record-parser.ts:1).

{processedFile:{path,mtimeMs,size,lineCount},turns:SourceTurn[]} with stream lines counted including ignored records; assistant usage only. Stat before stream; read UTF8 line by line, fallback session basename, dedupe trimmed messageId:requestId then messageId then uuid; duplicate buckets take maxima while first metadata/time retained. JSON syntax ignored, but JSON null throws outside catch; falsey session/timestamp drop, tokens nullish→0 without finite/numeric/nonnegative validation; malformed trim fields can throw; read/stat rejection rejects, no AbortSignal.

**stripClaudeSourceMetadata** — [src/main/claude-usage/transcript-record-parser.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/transcript-record-parser.ts:1).

Public usage turns omit dedupeKey but retain sessionId,timestamp,model/cwd/gitBranch nullable and input/output/cacheRead/cacheWrite/cacheWrite1h token fields. Pure per-turn projection; not a validator. Malformed counts already present survive; cache1h upper-clamped to cachetotal, not lower-clamped.

**buildWorktreeLookup** — [src/main/claude-usage/worktree-attribution.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/worktree-attribution.ts:1).

Lookup of canonical worktree metadata, exact-path map and deepest-path-first containing candidates; cached via WeakMap. realpath with normalized raw fallback; Windows case normalization; duplicate canonical path last wins. Canonicalization failure does not prove absence or host ownership; input shape annotations only.

**attributeClaudeUsageTurns** — [src/main/claude-usage/worktree-attribution.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/worktree-attribution.ts:1).

Attributed events add local day and projectKey/projectLabel/repoId/worktreeId nullable; exact or deepest boundary-contained path; fallback cwd:last-two-labels or unscoped. Invalid dates dropped; project keys worktree:<key>,cwd:<normalized raw>,unscoped. Source metadata path is attribution, not authenticated authority. Malformed cwd may throw; realpath failure uses normalized raw path; timezone/day is machine local.

**aggregateClaudeUsage** — [src/main/claude-usage/usage-aggregation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/usage-aggregation.ts:1).

Session map plus daily aggregates of input/output/cacheRead/cacheWrite/cacheWrite1h and counts, nested location breakdown. Sessions by ID; lexical first/last timestamps; latest-timestamp cwd/branch but last encountered nonnull model. Daily key day/model??unknown/projectKey joined ::. Raw arithmetic may concatenate strings or accept negatives; delimiter/model sentinel collisions possible, no schema validation or rollback.

**finalizeClaudeSessions** — [src/main/claude-usage/usage-aggregation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/usage-aggregation.ts:1).

Array of sessions sorted lastTimestamp descending; locations sorted input+output descending and top location determines primary repo/worktree. Cache tokens do not contribute to this provider's location rank; no synthetic zero-filled days. Null model/location metadata retained; ordering differs from Codex/OpenCode total-token rank.

**mergeClaudeDailyAggregates** — [src/main/claude-usage/usage-aggregation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/usage-aggregation.ts:1).

Merged daily rows by same composite key, sorted day/project label. Fold numeric buckets/counts, clone new rows. No input validation; aggregation collision/coercion behavior inherited.

**mergeClaudeSessions** — [src/main/claude-usage/usage-aggregation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/usage-aggregation.ts:1).

Merged sessions and nested locations using same per-session metrics and metadata ordering. structuredClone first session then merge, finalize sorts. Clone or malformed nested input may throw; not transactional across caller's state.

Machine-local input discovery and path-based attribution do not authenticate execution host. Discovery/parser/aggregation methods have no service cancellation acknowledgment; scan cancellation/store epoch/refesh/UI behavior is reused from frozen usage contracts. Entire original test allocation retained.

Read assertion bodies:

- [src/main/claude-usage/scanner.test.ts:10](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/scanner.test.ts:10) through 258: All6 cases: token structure/cache TTL and clamp, max-per-message/request dedupe retaining first timestamp, multi-location rank, deepest attribution.
- [src/main/claude-usage/scanner-scan.test.ts:26](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/scanner-scan.test.ts:26) through 166: Exact processed paths/line counts/fallback session/daily labels, unchanged cached projection999 reuse; rest of whole file preserved.
- [src/main/claude-usage/scanner-large-directory.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/scanner-large-directory.test.ts:1) through 66: 125000 mocked directory entries; count/path assertion, not real IO/performance measurement.

Complete original allocation: [src/main/claude-usage/scanner.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/scanner.test.ts:1); [src/main/claude-usage/scanner-scan.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/scanner-scan.test.ts:1); [src/main/claude-usage/scanner-large-directory.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/claude-usage/scanner-large-directory.test.ts:1). No subset or mock is parity evidence. Gate CIF-INGEST-CLAUDE.

### UIG-CODEX

7 exact named method boundaries; reuse frozen usage store/result/UI channels, without repeating24 factories.

**canonicalizeUsageWorktreePaths** — [src/main/usage-worktree-canonicalizer.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/usage-worktree-canonicalizer.ts:1).

Promise of copied worktree metadata with canonical paths sorted descending path length; empty input→[]. Default eight workers call supplied canonicalizePath. Rejection propagates; canonical filesystem path is not remote host authorization.

**createUsageEventAggregation** — [src/main/usage/usage-event-aggregation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/usage/usage-event-aggregation.ts:1).

Factory returns aggregate/finalizeSessions/sortDailyAggregates/mergeSessions/mergeDailyAggregates; shared structure expanded in sharedContracts.USAGE-AGG. Provider supplies metric creation/add/clone/finalization; Codex inferred pricing OR-fold. No event runtime validation; null model sentinel and :: grouping collisions preserved.

**canonicalizePath** — [src/main/codex-usage/codex-session-file-discovery.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/codex-session-file-discovery.ts:1).

Resolved realpath normalized path; fallback normalized input. Host filesystem canonicalization. Catch realpath failures without treating them as confirmed absence.

**getLegacySourceSkipBytesByPath** — [src/main/codex-usage/codex-session-file-discovery.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/codex-session-file-discovery.ts:1).

Map source path→max prefix byte count or selection omission inferred from legacy copy markers. Marker existence gates inspection; unchanged target or matching source prefers target; both diverged retain both and skip original copied prefix. Marker numeric fields are typeof-number, not finite/nonnegative validated. Stat/lstat failures and malformed marker yield fallback; current file bytes not authenticated by marker.

**listCodexSessionFiles** — [src/main/codex-usage/codex-session-file-discovery.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/codex-session-file-discovery.ts:1).

Promise of deduped regular jsonl paths from managed, system and validated on-disk account session roots. Calling managed home helper can mkdirSync recursively; discovery is not intrinsically side-effect-free (audit did not execute it). Physical dedupe dev:ino when nonzero else canonical path; yield every100 entries. Per-root failure can lose partial root discoveries; symlink session directories/untrusted account home omitted; indeterminate account ownership also omitted. CODEX_HOME not used as arbitrary owner override.

**attributeCodexUsageEvent** — [src/main/codex-usage/codex-usage-event-attribution.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/codex-usage-event-attribution.ts:1).

Attributed Codex event with local day, project label/key and repo/worktree nullable. Canonical worktrees longest first, event cwd normalized but not realpathed; exact/contained POSIX/Windows path checks, different drives excluded. Invalid date drops; symlink event path may miss canonical worktree, ..name is allowed but true parent excluded; raw fallback key retains normalized lexical .. segments.

**parseCodexUsageRecord** — [src/main/codex-usage/codex-usage-record-parser.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/codex-usage-record-parser.ts:1).

UsageEvent|null plus mutable session/current cwd/model/previousTotals context. Event contains sessionId,timestamp,model|null,cwd|null,input/cachedInput/output/reasoningOutput/total and inferred-pricing flag plus eventKey. session_meta/turn_context update trimmed context; event_msg token_count info parsed. First total-only suffix establishes baseline, duplicates/stale totals skipped, monotonic total deltas clamp components, last-only arithmetic retained. Event dedupe key excludes session/context. JSON null throws outside JSON parse catch. finite number else0, negative finite accepted. Positive explicit total preferred else input+output; monotonic comparison ignores totalTokens. Cached min(input,cached); zero event dropped before totals update. Stale heuristic 98% or current+2*last threshold; not an authenticated provider invariant.

Machine-local input discovery and path-based attribution do not authenticate execution host. Discovery/parser/aggregation methods have no service cancellation acknowledgment; scan cancellation/store epoch/refesh/UI behavior is reused from frozen usage contracts. Entire original test allocation retained.

Read assertion bodies:

- [src/main/codex-usage/scanner.test.ts:17](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/scanner.test.ts:17) through 323: All7 cases: token baseline/dedupe, unknown model inferred pricing, resumed totals, deepest child, ..name vs parent/different drive.
- [src/main/codex-usage/scanner-paths.test.ts:130](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/scanner-paths.test.ts:130) through 385: Home/account roots, redirected/symlink rejection, hardlink dedupe, managed/both divergence and suffix18tokens/3events; later file tests retained.
- [src/main/codex-usage/scanner-large-directory.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/scanner-large-directory.test.ts:1) through 86: 125000 mocked directory entries; no actual load/performance conclusion.

Complete original allocation: [src/main/codex-usage/scanner.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/scanner.test.ts:1); [src/main/codex-usage/scanner-paths.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/scanner-paths.test.ts:1); [src/main/codex-usage/scanner-large-directory.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/codex-usage/scanner-large-directory.test.ts:1). No subset or mock is parity evidence. Gate CIF-INGEST-CODEX.

### UIG-OPENCODE

9 exact named method boundaries; reuse frozen usage store/result/UI channels, without repeating24 factories.

**Database** — [src/main/sqlite/sync-database.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/sqlite/sync-database.ts:1).

Default alias of SyncDatabase wrapping dynamic node:sqlite DatabaseSync, prepare/all/get/run, exec, pragma, close; options readonly/fileMustExist/timeout. fileMustExist precheck then native open (TOCTOU); statement LRU256, pragma/wildcard not cached, DDL regex clears cache before exec, close clears cache and closes driver. Missing native module/open/query/close errors propagate. pragma simple returns first column first row or undefined. Native WAL/locking behavior requires supported platform/version fixtures, not a universal writeability claim.

**createUsageEventAggregation** — [src/main/usage/usage-event-aggregation.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/usage/usage-event-aggregation.ts:1).

Explicitly identical shared implementation to UIG-CODEX/createUsageEventAggregation; OpenCode metric is nullable costUSD. Null+null remains null; otherwise sum available costs. Shared nested result in USAGE-AGG. Negative/malformed raw events unvalidated by fold; parser restrictions are separate.

**compareOpenCodeClaimPriority** — [src/main/opencode-usage/opencode-database-discovery.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/opencode-database-discovery.ts:1).

Comparator prefers live database rank0 then lexicographic database path. Deterministic owner of whole session across databases, not per-message dedupe. Path claim priority is local scanner policy, not provider/remote ownership proof.

**getProcessedDatabaseInfo** — [src/main/opencode-usage/opencode-database-discovery.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/opencode-database-discovery.ts:1).

{path,mtimeMs,size} from raw filesystem stat. Used before readonly DB open for exact cache comparison. Rejects stat failure; this helper itself is not WSL-gated.

**listOpenCodeDatabases** — [src/main/opencode-usage/opencode-database-discovery.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/opencode-database-discovery.ts:1).

Promise<string[]> rooted trimmed XDG_DATA_HOME or ~/.local/share/opencode, or trimmed OPENCODE_DB; :memory:→[]. Relative override joined under data directory; absolute kept. Windows retains HOME fallback, not LOCALAPPDATA. File-only paths. Filesystem failures normally→[]; typed WSL refusal calls callback; callback throwing propagates. Blank override treated unconfigured.

**parseOpenCodeUsageRow** — [src/main/opencode-usage/opencode-usage-row-parsing.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/opencode-usage-row-parsing.ts:1).

Parsed event|null: sessionId passthrough,timestamp ISO,model/cwd nullable,input/cached/output/reasoning/total, costUSD positive else null. Accept object or JSON object string, reject array/null/invalid JSON. finite numeric else0 (negative finite retained); cached=min(cache.read,input); positive explicit total else input+output+reasoning; sum-of-five<=0 drops. First positive completed/created/rowupdated/rowcreated timestamp, <1e10 seconds→ms; positive out-of-range finite timestamp throws RangeError in toISOString. No sessionId runtime validator. Model provider-qualified nested/direct variants; path.cwd→rowdirectory→worktree.

**selectUsageRows** — [src/main/opencode-usage/opencode-usage-row-queries.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/opencode-usage-row-queries.ts:1).

Raw rows[]; no session table→[]. Any positive materialized session chooses aggregate query for entire database; otherwise session_message assistant variant or legacy message role assistant. Materialized SQL sums four token buckets>0 and synthesizes total=input+output+reasoning/cacheWrite0; optional model/project joins produce NULL. Mixed partially materialized DB can omit sessions only represented in messages. Zero-token filtering is NOT universal to assistant queries; parser drops nonpositive rows. SQL/all failure rejects whole DB scan. Provider schema variants at selected-column boundary require fixture matrix.

**attributeOpenCodeUsageEvent** — [src/main/opencode-usage/opencode-usage-worktree-attribution.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/opencode-usage-worktree-attribution.ts:1).

Attributed event with local day/project identity and nullable repo/worktree using deepest containment. Same path policy as Codex, implementation separately read; preserve cost metric. Invalid timestamp at attribution drops, but earlier parser RangeError is uncaught here; path match is not host authentication.

**buildWorktreesWithCanonicalPaths** — [src/main/opencode-usage/opencode-usage-worktree-attribution.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/opencode-usage-worktree-attribution.ts:1).

Worktree metadata copies with realpath normalized fallback, sorted deepest first. Canonicalization per source body; normalize Windows drive/UNC comparisons. Failure fallback normalized (not unnormalized as one leaf phrase implied).

Machine-local input discovery and path-based attribution do not authenticate execution host. Discovery/parser/aggregation methods have no service cancellation acknowledgment; scan cancellation/store epoch/refesh/UI behavior is reused from frozen usage contracts. Entire original test allocation retained.

Read assertion bodies:

- [src/main/opencode-usage/scanner.test.ts:94](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/scanner.test.ts:94) through 172: Lead re-read exact message/token/cost result and dotdot/parent/cross-drive assertion bodies. Leaf reported all15 cases; wider report attached separately, not claimed lead-re-read.

Complete original allocation: [src/main/opencode-usage/scanner.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/scanner.test.ts:1); [src/main/opencode-usage/scanner-windows-data-directory.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/scanner-windows-data-directory.test.ts:1); [src/main/opencode-usage/scanner-wsl-gate.test.ts:1](/Users/carlos/Documents/Drogon-mentu-session/src/main/opencode-usage/scanner-wsl-gate.test.ts:1). No subset or mock is parity evidence. Gate CIF-INGEST-OPENCODE.

OpenCode scanner integration opens readonly/fileMustExist, records raw stat first, sets query_only inside try/finally close, and claims sessions as whole units. Any DB error aborts that scan without publishing a partial projection; close can also throw. Exact mtime/size plus ownedSessionIds/deferred flags permit cached reuse; live database outranks other paths, lost claims force deferred reparse and lower-priority cached owners reparse when higher-priority input is scanned. Transient error classification is not itself a retry in this call path. Native SQLite/WAL, actual provider schema versions and WSL are fixture gates, not inferred platform behavior.

## Source defects and intended-correction fixtures

- **CIF-SD-TOKEN** (PEND-E1-AUTOMATION): Inherited final push007 leadCorrection governs: dispatchToken reserves new_per_run workspace provenance, not a general completion/delivery dedup gate; markDispatchResult has no token argument and clears tokens after update. Keep source characterization and intended-correction acceptance distinct under CIF-AUTO.
- **CIF-SD-NCHAT** (PEND-E1-NATIVECHAT): Stream id merge >= source priority versus assembler strict >; do not assert equal-priority replay universally updates rendered turn. Keep source characterization and intended-correction acceptance distinct under CIF-NCHAT.
- **CIF-SD-MARKDOWN** (PEND-E1-CREATE): Correct prior pending prose: store catches/toasts creation rejection; terminal listener lacks equivalent outer catch. Pending picker unsubscribe need not resolve. Keep source characterization and intended-correction acceptance distinct under CIF-CREATE-LOCAL.
- **CIF-SD-NATIVE-CLOSE** (PEND-E1-SLEEP): Browser cleanup discards async destroy/unregister completion before terminal shutdown; intended cleanup ordering must be tested separately. Keep source characterization and intended-correction acceptance distinct under CIF-SLEEP.
- **CIF-SD-KILL** (PEND-E1-SLEEP): Fulfilled false/undefined kill treated stopped; preserve source characterization separately from verified-stop correction. Keep source characterization and intended-correction acceptance distinct under CIF-SLEEP.
- **CIF-SD-SSH** (PEND-E1-SLEEP): Direct SSH offline/error prehydration maps authority none, potentially reopening revoked owner; intended correction must retain unverifiable instead of proving exit. Keep source characterization and intended-correction acceptance distinct under CIF-WAKE.
- **CIF-SD-SWITCH** (PEND-E1-SWITCH): Malformed direction may throw/coerce; terminal-only lacks same/all exact unified activation for duplicate backing entities. Keep source characterization and intended-correction acceptance distinct under CIF-SWITCH.
- **CIF-SD-CLAUDE** (UIG-CLAUDE): JSON null throws and token arithmetic not finite/type/nonnegative validated; duplicate max metrics preserve first metadata. Keep source characterization and intended-correction acceptance distinct under CIF-INGEST-CLAUDE.
- **CIF-SD-CODEX** (UIG-CODEX): JSON null, signed token values, weak copy-marker numeric checks, component-vs-total heuristic and realpath alias mismatch remain source behaviors. Keep source characterization and intended-correction acceptance distinct under CIF-INGEST-CODEX.
- **CIF-SD-OPENCODE** (UIG-OPENCODE): Negative finite tokens survive; out-of-range positive timestamp may throw; any positive materialized session selects whole-DB materialized path and can omit message-only sessions. Keep source characterization and intended-correction acceptance distinct under CIF-INGEST-OPENCODE.

Mandatory **PMR-FAF-001** is retained verbatim in JSON: scalar zoomFactor correction, not an object payload; root d1dc550 supersedes S-45-REVIEW. BM recipe evidence is not a replacement for native-chat messages, and source records do not establish formal Commitment Protocol compliance.

## Exact execution obligations

- **CIF-AUTO** (PEND-E1-AUTOMATION): Real renderer dispatch+service watcher: duplicate delivery before terminal completion, single-use workspace token versus completion update, late attach/headless/no-host, both observers racing finalize, persistence rejection, abort ignored, ready grace under lost SSH then reattach. Assert exact row/error/output null fields; unavailable remains unverifiable and never inferred exit.
- **CIF-NCHAT** (PEND-E1-NATIVECHAT): Real preload+hook/decoder fixtures for owner/session switch, append before seed, pending→healthy replacement, stale pagination, dispose during watcher installation, malformed/null frame/blocks, empty/error omission, equal-priority same-id replacement across stream/assembler, image pairs, turn lifecycle null/skew/subagent interruption. Retain provider decoder matrix and all E1-FG-06 obligations.
- **CIF-CREATE-LOCAL** (PEND-E1-CREATE): Local/floating browser/Markdown/terminal: unset/null/false activation and profile, empty/malformed paths, correct group/owner, created state followed by telemetry/unified setter rejection, disk write failure after file create and owner flip before cleanup, picker unsubscribe pending, EEXIST100 exhaustion, async listener rejection. Assert actual file contents/tab state and later persistence/restart, not mocked creation return.
- **CIF-CREATE-REMOTE** (PEND-E1-CREATE, PEND-E1-SPAWN): Host-version matrix exact session.tabs/agentSession/browser result envelopes; malformed response after real create, group move refusal, timeout after host accepted, unknown outcome vs definitive refusal, no local fallback on remote failure, created-but-unreconciled 10s deadline, duplicate stable operation retry. Browser stage/create/close cancellation at each await, wrong pairing, failed cleanup/visible page, old host unknown identity, wait-registration navigation error; verify no duplicate provider launch.
- **CIF-MIRROR** (PEND-E1-CREATE, PEND-E1-SPAWN): Apply actual snapshots with owner/pairing/retired/tracking epoch fences, caller focus intent, older-host group fallback, browser staged/restored/client-hosted retention, removed resources, exact handoff, inactive workspace focus, throwing subscriber after commit, full empty versus unavailable snapshot. Assert records/layout/state/durable restoration against owning domain fixtures, not request admission.
- **CIF-SLEEP** (PEND-E1-SLEEP): Real mocked-boundary integration for browser native unregister failure/delay before PTY stop (source characterization + intended awaited cleanup), fulfilled false/undefined PTY kill (source characterization + intended verified stop), partial multi-worktree browser/PTY/VM failure, retained identifiers/disk restart. Remote exact result shape/null/count checks and legacy full/nontruncated fresh terminal lists; disconnect/mixed-version remains unverifiable.
- **CIF-WAKE** (PEND-E1-SLEEP): Readiness queue dedupe/dispose/throw midway; matching provider/session/leaf claims, passive display, active recovery, record cleared after queued tab then ordering failure, cold mount/group restore. Direct SSH offline/error prehydration must be characterized separately from intended correction retaining unverifiable; duplicate owner/folder/Windows/WSL fixtures must prevent wrong-host launch.
- **CIF-SPAWN** (PEND-E1-SPAWN): Actual dashboard→launch→service outcome, disabled/unknown owner, setActive before refusal, nonnull tabId:null pending response, structured fence wrong type/nonfinite, same-intent retry once, adopted tab/history recovery, unknown retained without fallback, cancellation after service accepted. Assert state/outbox/tab/process identity and partial selection, not mocked boolean.
- **CIF-SWITCH** (PEND-E1-SWITCH): Real IPC/store cycles for all three channels, exact split duplicate backing ids, hydration versus real split, floating browser local under active runtime, delayed durable state. Exercise omitted/null/string/zero/fraction/NaN/infinite/large negative direction: source throw/no-op/coercion separate from intended strict±1 validation. Terminal-only unified identity correction must preserve selected split.
- **CIF-INGEST-CLAUDE** (UIG-CLAUDE): Full original3 files plus real temp JSONL fixture pipeline/store: JSON null/malformed trim fields, negative/string/overflow token arithmetic, duplicate first metadata/max buckets, partial subtree failure, symlink/case/Windows/SSH attribution, local DST day, model/order/delimiter collisions, cancel/disable during scan and publication. Characterize bad records separately from intended bounded validation/skip policy.
- **CIF-INGEST-CODEX** (UIG-CODEX): Full original3 files plus marker/body ownership and suffix fixtures: managed-home mkdir failure, account indeterminate versus untrusted, hardlink/realpath alias, both divergent copies/max prefix, malformed negative/nonfinite marker fields, JSON null, signed tokens, total versus component delta divergence/stale heuristics, context dedupe, canonical event symlink mismatch; retain exact inferred-pricing and publication/lifecycle tests.
- **CIF-INGEST-OPENCODE** (UIG-OPENCODE): Full original3 files plus supported native node:sqlite/platform DB fixtures: materialized/message/typeless/legacy and partial materialization, zero and negative tokens, out-of-range positive timestamp RangeError, malformed model/session/cost, WSL refusal callback throw, raw stat failure, readonly WAL/locking/query/close error, .all failure→no partial projection, cache exactness and whole-session reclaim priority/deferred reparse. No actual provider account database or inference.

All 47 inherited BM/R/F/D acceptance records, 70 whole-file queue entries, 33 original test queue entries and 46 allocation pointers are preserved as exact JSON values. Their counts are retention checks, not audit progress. Source baseline and unchanged assertion port must precede feature work; compile/setup failure is not behavioral RED, a skip is not PASS, and mocked missing product behavior cannot prove parity. Real Electron/native, filesystem/SQLite, SSH live/unverifiable/exited, folder, Windows/WSL, mixed-version, disposal and recovery fixtures remain required.

## Residual disposition and finite recommendation

| Exact residual ID | Kind | Disposition |
|---|---|---|
| PEND-E1-AUTOMATION/NATIVECHAT/CREATE/SLEEP/SPAWN/SWITCH | assigned-source | six immediate consumer contracts characterized,13 exact IDs; proposed root closure only |
| UIG-CLAUDE/CODEX/OPENCODE | assigned-source | 25 named local input methods characterized; source-understood does not prove provider/native fixtures |
| S-CONSUMER-DOWNSTREAM | inherited-source | Prior7 plus this13 cover fixed20 ID consumer complement; no rescan or acceptance of all other consumers |
| S-FACTORIES | inherited-source | Frozen24 provider factory channels reused; these3 UIG additions characterize their named input gaps without recensus |
| S-RPC-RESULTS | outside-assignment-source | 47 exact DR groups independently assigned by e3-result-audit-partition.json; no partial aggregation or claim of result closure |
| S-REMOTE-LIFECYCLE | characterized-source-defect | Duplicate admission race precheck before await retained; F-RPC-ROUTE/HOST concurrent intended-correction fixtures remain |
| S-LEGACY | genuine-unknown-provenance | export:requestPdf push033 zero-argument receiver and ui:closeSessionTab push054 receiver preserved; producers unknown; no history search or removal |
| S-45-REVIEW | superseded-source-review | Root d1dc550 supersedes pending45 review; mandatory PMR-FAF-001 scalar zoomFactor correction and R-WINDOW retained |
| CIF-LOCAL-DOMAIN-LIMIT | outside-assignment-source-limit | Shared mirror row-builder/layout/agent-status internals not independently re-enumerated; immediate orchestration/apply-stage bodies documented in MIRROR, inherited F-PUSH-STATE/domain allocation retained. Local source, not relabeled external. |
| CIF-EXTERNAL | source-understood-external-fixture | Node filesystem/SQLite versions/locking, Electron webContents/native guest/PTY/VM, provider records/CLI processes, runtime backend results require owner fixtures; no personal runtime or inference tested. |

Recommend accepting the assigned immediate source characterization only after root completeness review and independent source samples. S-RPC-RESULTS is outside this task; the47 DR groups are neither duplicated nor implicitly accepted. S-LEGACY’s two receiver contracts and unknown producers remain explicit. Named local mirror helper internals remain at their owning domain boundary; native/provider effects remain external fixture gates. None is converted to a successful test or silently removed.

## Leaf lifecycle and independent review

One approved UIG-OPENCODE leaf ran under task `task_df6099832449`, dispatch `ctx_5042f615e1cf`, depth2, using `opencode --model opencode-go/muse-spark-1.3-contributor --auto` on retained terminal `term_517b3e95-5910-4621-8141-29b5a38f4517`. Requested command/TUI evidence is recorded; effectiveModel was null, so no model self-authentication claim is made. Leaf had no descendants and wrote only [opencode.md](consumer-ingestion-leaf/opencode.md) and [opencode.json](consumer-ingestion-leaf/opencode.json).

Lead independently checked all26 leaf source hashes, read the six immediate modules plus scanner/shared aggregation and sampled actual assertions. The leaf’s19 reported assertions in3 files remain labeled leaf evidence; lead does not claim to have reread every one. Lead corrections: negative finite tokens survive, out-of-range positive timestamps can throw, positive SQL filtering is only universal for materialized totals, refusal callbacks can throw, stat helper is ungated, normalized path fallback and native WAL fixture limits govern.

Leaf worker_done `msg_172700834440` settled before parent completion. Official release receipt **33cf534f-be59-4acb-97e6-e2a14b966133** returned `retained / external_terminal / processAction:none / archive:null`: release complete, external terminal preserved, no active owned child. Launch/dispatch receipt IDs and exact artifact SHA256s are in JSON.

## Verification record

195 new/reused E1 file/range observations matched current bytes;127 are this lead’s source/test observations.17 selected assertion spans carry their own hashes, separate from whole-file hashes and retained complete suites. All26 leaf whole-file fingerprints matched. Frozen domain/E1/leaf files matched; the root-owned review document advanced and was reread. Artifact ID/inherited-record validation is recorded in JSON. No Git comparison, application test or live execution occurred.
