# E2-O03 — static shortcut action reconciliation

Candidate disposition: **ready for root review**, with the external Monaco replace behavior question and surface limitations retained explicitly. This reconciles all **88/88 accepted IDs** through selected handlers and direct effect bodies; it does not claim runtime parity or independently accept E2. O01/O02 and the prior candidate files are unchanged.

Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Exact full-file and cited-range SHA-256 hashes are in [followup-shortcut-actions.json](followup-shortcut-actions.json), together with inherited definitions, routing families, test assertion bodies and an executable future source-test file list. No product/source modules, tests, Git, native app, keyboard, clipboard, microphone or filesystem effects were executed.

56/88 rows have at least one reviewed assertion-body association. The remaining rows explicitly have none associated; this is not an absence-of-tests census. Associations distinguish pure matchers, mocked dispatch/API calls and store mutations. None is an execution receipt.

## Findings requiring preservation

- Hovered-workspace delete retains host/instance and lineage confirmation; it does not simply delete the active workspace. Up/down workspace cycling excludes folder rows; numbered jumps use a different projection.
- Close all is the catalog’s “Close all editor tabs”: clean unpinned editors close, dirty editors queue confirmation. Pane close, browser guest close and floating close have different identity and confirmation paths.
- Streamed browser find is unavailable; hard reload sends ordinary browser.reload; element grab is unsupported. Dashboard preview terminals consume pane operations without performing them.
- Editor replace has a traced rich Markdown consumer; Monaco library default/override behavior remains an explicit external-library question. Open Markdown keyboard dispatch is established in floating workspace, not the main exhaustive keyboard route.
- Pane close currently proceeds on a non-live probe verdict and on probe rejection. That includes unverifiable; it is a source defect candidate against the rewrite liveness rule, not proof of process exit.
- Explorer undo/redo pops before await and loses the popped entry on failure. Deletion preserves captured owner generations, saves dirty files, supports partial batch results, and distinguishes local Trash, WSL permanent deletion and remote deletion.
- Input-source switching deliberately preserves native default behavior while blocking terminal delivery. Platform/layout/agent/plugin resolution remains dynamic under SK01–SK16.

## Completeness and remaining work

The denominator is the accepted static88 catalog; no M1–M7 recensus. Every row has a definition anchor, selected routing, action-specific effect references, eligibility, event behavior, parameters/state changes, failure/no-op variants and exact remaining acceptance outcomes. Source references cover cited bodies, not all transitive service/OS internals. The JSON explicitly separates supported, unsupported, source-defect and unknown-library branches.

Original baseline, faithful test port, candidate behavioral RED and real integrated acceptance remain outstanding. Before using the generated Vitest command, root must authorize a disposable baseline checkout and review harness side effects. No assertion may be weakened or mocked missing product behavior counted as parity. Accepted audit progress stays approximately60% on the7/12-group baseline (medium-low confidence), change0; next milestone is root’s source acceptance. The flexible24-hour deadline remains at risk from unexecuted platform/runtime gates; no supported product completion ETA is claimed.

Initial depth1 denied children; root subsequently authorized a depth2 leaf after the lifecycle smoke. No redundant child was launched because review was in reconciliation; there are no children to settle. Current Task `task_a8ec40535eb1`, Dispatch `ctx_79157abd58d2`.

## Per-action reconciliation

### worktree.quickOpen

**Eligibility:** IPC receiver requires activeView terminal and activeWorktreeId.

**Event:** Native/guest consume before receiver; absent target remains consumed.

**Effect:** openModal('quick-open'); opens picker, does not open a file until subsequent selection.

**Branches:** Other views or no active workspace: no modal. Guest missing receiver follows explicit forwarding gate.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:8-8](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:8). **Effect bodies:** [src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:1-50](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:1).

**Shared routing:** native, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **native-global** (pure resolver; no renderer effect): Resolved action objects name openSettings, toggleWorktreePalette, openQuickOpen and zero-based numbered workspace/tab targets, including non-Mac modifiers. [src/shared/window-shortcut-policy.test.ts:43-107](/Users/carlos/Documents/Drogon-mentu-session/src/shared/window-shortcut-policy.test.ts:43)

**Remaining acceptance:** Assert modal and no file mutation for eligible workspace, no-op without workspace/other views, native guest focus and customized/unbound chords.

### app.settings

**Eligibility:** Native/guest resolved openSettings; renderer listener has no active-workspace requirement.

**Event:** Native prevent; receiver no keyboard event.

**Effect:** Clear settings search, set activeView=settings and retain previous navigation state when first entering.

**Branches:** Already in Settings does not overwrite prior view; this is transient navigation, not a settings persistence operation.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:16-16](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:16). **Effect bodies:** [src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts:15-35](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts:15); [src/renderer/src/store/slices/ui/ui-slice-settings-actions.ts:1-45](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/ui/ui-slice-settings-actions.ts:1).

**Shared routing:** native, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **native-global** (pure resolver; no renderer effect): Resolved action objects name openSettings, toggleWorktreePalette, openQuickOpen and zero-based numbered workspace/tab targets, including non-Mac modifiers. [src/shared/window-shortcut-policy.test.ts:43-107](/Users/carlos/Documents/Drogon-mentu-session/src/shared/window-shortcut-policy.test.ts:43)
- **settings-open** (store mutation): Opening Settings clears search and sets activeView to settings. [src/renderer/src/store/slices/ui-page-navigation.test.ts:313-323](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/ui-page-navigation.test.ts:313)

**Remaining acceptance:** Assert repeat open preserves return target, clears search and does not write settings; guest/native/custom/unbound routes.

### app.forceReload

**Eligibility:** Native forceReload allowlist after global native eligibility.

**Event:** Native consumes; no renderer action callback.

**Effect:** Call optional onBeforeReload({ignoreCache:true,webContentsId}), then webContents.reloadIgnoringCache().

**Branches:** No catch in dispatcher; a thrown pre-reload callback prevents the following reload; underlying Electron destroyed-window/error behavior is execution debt.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:25-25](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:25). **Effect bodies:** [src/main/window/main-window-shortcut-actions.ts:19-23](/Users/carlos/Documents/Drogon-mentu-session/src/main/window/main-window-shortcut-actions.ts:19).

**Shared routing:** native; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** With reviewed mocks assert callback ordering/exact window identity and reloadIgnoringCache once; then isolated Electron reload preserves expected restored state and never touches live user sessions.

### worktree.palette

**Eligibility:** Renderer IPC listener available independently of active workspace.

**Event:** Native/guest consumes; no local keyboard event in receiver.

**Effect:** activeModal worktree-palette -> closeModal(); otherwise openModal('worktree-palette').

**Branches:** Toggles modal only; numbered workspace keys inside palette route to its row-index event instead of switching main workspace.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:34-34](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:34). **Effect bodies:** [src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts:160-173](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts:160).

**Shared routing:** native, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **native-global** (pure resolver; no renderer effect): Resolved action objects name openSettings, toggleWorktreePalette, openQuickOpen and zero-based numbered workspace/tab targets, including non-Mac modifiers. [src/shared/window-shortcut-policy.test.ts:43-107](/Users/carlos/Documents/Drogon-mentu-session/src/shared/window-shortcut-policy.test.ts:43)

**Remaining acceptance:** Assert open/close and modal row-index routing in eligible/empty workspace, plus native/platform overrides.

### worktree.navigateUp

**Eligibility:** No active modal; noneditable target (terminal helper is permitted); mounted worktree-list handler.

**Event:** Match prevents default even empty list; no repeat guard in this listener.

**Effect:** Mark direct-scroll intent, cycle up through actual item rows with wrap, activateAndRevealWorktree(id, executionHostId), scroll virtual row align:auto.

**Branches:** Folder rows are excluded by getCyclableWorktrees despite broad caller comment; absent active selects directional endpoint; empty list no activation.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:46-46](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:46). **Effect bodies:** [src/renderer/src/components/sidebar/worktree-list/navigation/use-keyboard.ts:90-169](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-list/navigation/use-keyboard.ts:90); [src/renderer/src/components/sidebar/worktree-keyboard-cycle.ts:1-59](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-keyboard-cycle.ts:1).

**Shared routing:** Action-specific listener above; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **workspace-cycle** (pure cycle helper): Both directions wrap, missing active selects directional endpoint, empty list returns null. [src/renderer/src/components/sidebar/worktree-keyboard-cycle.test.ts:14-55](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-keyboard-cycle.test.ts:14); [src/renderer/src/components/sidebar/worktree-keyboard-cycle.test.ts:115-134](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-keyboard-cycle.test.ts:115)

**Remaining acceptance:** Assert real host-qualified activation and virtual scrolling up, repeat behavior, empty list, modal/editable guard and exclusion of folder rows.

### worktree.navigateDown

**Eligibility:** No active modal; noneditable target (terminal helper is permitted); mounted worktree-list handler.

**Event:** Match prevents default even empty list; no repeat guard in this listener.

**Effect:** Mark direct-scroll intent, cycle down through actual item rows with wrap, activateAndRevealWorktree(id, executionHostId), scroll virtual row align:auto.

**Branches:** Folder rows are excluded by getCyclableWorktrees despite broad caller comment; absent active selects directional endpoint; empty list no activation.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:54-54](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:54). **Effect bodies:** [src/renderer/src/components/sidebar/worktree-list/navigation/use-keyboard.ts:90-169](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-list/navigation/use-keyboard.ts:90); [src/renderer/src/components/sidebar/worktree-keyboard-cycle.ts:1-59](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-keyboard-cycle.ts:1).

**Shared routing:** Action-specific listener above; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **workspace-cycle** (pure cycle helper): Both directions wrap, missing active selects directional endpoint, empty list returns null. [src/renderer/src/components/sidebar/worktree-keyboard-cycle.test.ts:14-55](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-keyboard-cycle.test.ts:14); [src/renderer/src/components/sidebar/worktree-keyboard-cycle.test.ts:115-134](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-keyboard-cycle.test.ts:115)

**Remaining acceptance:** Assert real host-qualified activation and virtual scrolling down, repeat behavior, empty list, modal/editable guard and exclusion of folder rows.

### workspace.create

**Eligibility:** Available without existing repo; already-open new-workspace-composer is guard.

**Event:** Native/guest consume before modal helper.

**Effect:** Open new-workspace-composer with telemetrySource:'shortcut'; only active Tasks Linear issue supplies linkedWorkItem/prefilledName.

**Branches:** Does not create disk/worktree immediately; stale issue outside Tasks omitted; open composer remains untouched.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:62-62](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:62). **Effect bodies:** [src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:30-65](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:30); [src/renderer/src/hooks/ipc-events/new-workspace-command.ts:1-36](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/new-workspace-command.ts:1).

**Shared routing:** native, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **workspace-create** (helper and mocked modal): Modal callback receives shortcut telemetry and active Tasks Linear issue only; already-open composer emits no modal call. [src/renderer/src/hooks/useIpcEvents-new-workspace-shortcut.test.ts:1-92](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/useIpcEvents-new-workspace-shortcut.test.ts:1)

**Remaining acceptance:** Assert exact modal data and no filesystem call, empty-repo and existing composer branches; exercise later creation as separate journey.

### workspace.rename

**Eligibility:** Active main workspace chrome, not floating; reveal requires known unarchived target.

**Event:** Successful global claim prevents default.

**Effect:** Open left sidebar, dispatch active-workspace reveal with beginRename; clear filters if needed, scroll/retry boundedly, setRenamingWorktreeId({id,rowKey}) after row mounts.

**Branches:** Missing/archived row, failed bounded mount or no active workspace cannot enter rename. No title persistence until later user commit.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:70-70](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:70). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:188-198](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:188); [src/renderer/src/lib/scroll-to-current-workspace-status.ts:1-34](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/scroll-to-current-workspace-status.ts:1); [src/renderer/src/components/sidebar/worktree-list/navigation/use-reveal-requests.ts:80-140](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-list/navigation/use-reveal-requests.ts:80); [src/renderer/src/components/sidebar/worktree-list/navigation/use-pending-reveal.ts:100-155](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-list/navigation/use-pending-reveal.ts:100).

**Shared routing:** global; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert host-specific row reveal, filters, bounded mount failure and editing state without changing name; then separate commit/cancel persistence tests.

### workspace.delete

**Eligibility:** Hovered sidebar option, modal-free/noneditable, not floating. Git must match host+instance, not main/deleting; folder must have parsed host ownership.

**Event:** Global consumes only eligible claim; native/guest already consumes regardless receiver eligibility.

**Effect:** Folder invokes deleteFolderWorkspace(id,{executionHostId}) with pending dedupe and clears active only if same target survives; Git enters runWorktreeDelete with expected instance/host. Clear deletion state; disconnected/ghost SSH opens forget dialog; otherwise lineage-aware confirmation or skip-confirm direct deletion.

**Branches:** Stale identity toasts; child lineage always prevents skip-confirm; folder failure retains active; pending folder clears in finally. This action targets hovered workspace, not necessarily active.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:84-84](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:84). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:200-214](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:200); [src/renderer/src/components/sidebar/hovered-workspace-delete.ts:1-133](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/hovered-workspace-delete.ts:1); [src/renderer/src/components/sidebar/delete-worktree-flow.ts:35-118](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/delete-worktree-flow.ts:35).

**Shared routing:** native, guest, global; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **workspace-delete** (DOM targeting with deletion mocks): Hovered Git target forwards execution host and expected instance; folder delete forwards host, clears active only after success, and suppresses duplicate pending requests. [src/renderer/src/components/sidebar/hovered-workspace-delete.test.ts:154-223](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/hovered-workspace-delete.test.ts:154)
- **guest-delete** (native event/router mocks): Delete chord sends renderer delete request and prevents default. [src/main/browser/browser-guest-shortcut-forwarding.test.ts:631-650](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.test.ts:631)

**Remaining acceptance:** Assert hover versus active identity, folder false/reject/repeat, Git stale/main/lineage/SSH branches, user confirmation/cancel and authorized disposable filesystem outcomes.

### workspace.openBoard

**Eligibility:** Settings view excluded; otherwise renderer main shell receiver.

**Event:** Global successful claim prevents; native/guest consume before Settings no-op.

**Effect:** Open left sidebar and dispatch board toggle event; panel toggles open state, records opening interaction; closing clears related drag/menu state.

**Branches:** No workspace creation or board persistence from chord itself; missing listener leaves request without visible panel.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:103-103](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:103). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:216-226](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:216); [src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:45-85](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:45); [src/renderer/src/components/sidebar/useWorkspaceBoardPanel.ts:46-97](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/useWorkspaceBoardPanel.ts:46); [src/renderer/src/components/sidebar/useWorkspaceBoardPanel.ts:160-165](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/useWorkspaceBoardPanel.ts:160).

**Shared routing:** native, guest, global; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert toggle state and cleanup on second press, Settings no-op, sidebar open, guest route and no direct creation.

### dashboard.toggle

**Eligibility:** Requires experimentalAgentDashboard===true and activeView not settings.

**Event:** Native/guest consumes even disabled receiver branch.

**Effect:** Popout mode invokes api.dashboard.openPopout; drawer mode flips drawer open and opens left sidebar only when opening.

**Branches:** Disabled/Settings no-op; popout fire-and-forget call has no local catch in bridge; closing drawer does not close sidebar.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:123-123](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:123). **Effect bodies:** [src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:60-105](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:60); [src/renderer/src/hooks/ipc-events/agent-dashboard-command.ts:1-30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/agent-dashboard-command.ts:1).

**Shared routing:** native, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **dashboard** (helper and mocked callbacks): Disabled/settings cases do nothing; popout calls callback; opening drawer also opens left sidebar; closing changes drawer only. [src/renderer/src/hooks/useIpcEvents-agent-dashboard-shortcut.test.ts:1-76](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/useIpcEvents-agent-dashboard-shortcut.test.ts:1)

**Remaining acceptance:** Assert enabled/disabled, both modes, second toggle and API failure handling; isolated popout window actual creation remains unexecuted.

### workspace.selectByIndex

**Eligibility:** Resolved digit family -> zero-based index. Palette modal takes precedence; otherwise terminal view required.

**Event:** Native repeat/index consumption follows resolver; missing index target can still be consumed.

**Effect:** If palette open emitCmdJRowIndexJump(index); else select visibleWorkspaceJumpTargets[index] and activateAndRevealWorkspace(id,{executionHostId}).

**Branches:** Out-of-range and nonterminal no-op. Target list differs from up/down item-only cycling; default modifiers are platform-specific and customizable.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:145-145](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:145). **Effect bodies:** [src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:81-103](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:81).

**Shared routing:** native, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **native-global** (pure resolver; no renderer effect): Resolved action objects name openSettings, toggleWorktreePalette, openQuickOpen and zero-based numbered workspace/tab targets, including non-Mac modifiers. [src/shared/window-shortcut-policy.test.ts:43-107](/Users/carlos/Documents/Drogon-mentu-session/src/shared/window-shortcut-policy.test.ts:43)

**Remaining acceptance:** Assert each 1-9 zero-based mapping, same-ID hosts, palette delegation, target projection including folders and out-of-range no activation.

### voice.dictation

**Eligibility:** Enabled voice plus selected STT model. Toggle uses native IPC; hold owns renderer keydown/keyup because native prevention suppresses release.

**Event:** Hold matches prevent+stop; retains accepted chord release identity, stops on relevant modifier/primary release or blur/hidden; no generic repeat guard. Toggle native repeats do not repeatedly start.

**Effect:** Toggle starts from idle or stops listening/starting, ignores stopping. Start captures insertion target/session, sets starting, buffers microphone audio then speech.startDictation(modelId,undefined,sessionId), flushes, sets listening. Stop during startup marks stopping/preserves buffered data; normal stop waits session stopped then resets transcript/state.

**Branches:** Missing model/disabled yields shortcut; stale run stops/discards; capture loss stops; device fallback notices once; start error cleans up then idle; canceled error avoids error toast. Speech engine/transcript-insertion subsystem is downstream of this action contract.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:165-165](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:165). **Effect bodies:** [src/renderer/src/components/dictation/DictationController.tsx:56-312](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dictation/DictationController.tsx:56); [src/renderer/src/components/dictation/use-hold-dictation-gesture.ts:105-202](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dictation/use-hold-dictation-gesture.ts:105).

**Shared routing:** native, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **dictation-hold** (hook with start/stop mocks; not microphone): Relevant modifier/primary release invokes stop and clears held flag; unrelated release keeps held; physical/logical and Linux release cases. [src/renderer/src/components/dictation/use-hold-dictation-gesture.test.tsx:109-228](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dictation/use-hold-dictation-gesture.test.tsx:109)

**Remaining acceptance:** Assert start/stop races, stale sessions, mic denied/lost/fallback, blur target cancellation and hold releases with actual permitted disposable audio fixture; preserve no model/disabled no-capture behavior.

### view.tasks

**Eligibility:** Not Settings and at least one Git repository.

**Event:** Global claims eligible; native/guest consumes before no-repo check.

**Effect:** openTaskPage records interaction/navigation history, sets Tasks state and previous view; source-dependent GitHub query prefetch or Linear list/query prefetch.

**Branches:** No repo/Settings no-op; query prefetch is not issue creation or external mutation. Task API failures are downstream query state, not shortcut success.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:173-173](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:173). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:228-236](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:228); [src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:71-79](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:71); [src/renderer/src/store/slices/ui/ui-slice-task-actions.ts:1-190](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/ui/ui-slice-task-actions.ts:1).

**Shared routing:** native, guest, global; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert source-specific navigation/prefetch parameters, previous-view restoration, zero-repo/Settings no-op and no issue mutation.

### sidebar.left.toggle

**Eligibility:** Global guards or native/guest receiving path.

**Event:** Global claim prevents; native IPC already consumed.

**Effect:** toggleSidebar inverts sidebarOpen.

**Branches:** No selection or workspace creation; native route may reach from focus that global editable guard would reject.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:181-181](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:181). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:150-163](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:150); [src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts:145-158](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts:145); [src/renderer/src/store/slices/ui/ui-slice-agent-actions.ts:40-55](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/ui/ui-slice-agent-actions.ts:40).

**Shared routing:** native, guest, global; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert twice restores state and context/platform ownership; separate layout persistence hook from direct mutation.

### sidebar.right.toggle

**Eligibility:** Global requires !creationLayoutActive and allowed view; native receiver checks allowed view.

**Event:** Global returns false when blocked; native may consume blocked receiver.

**Effect:** Invert rightSidebarOpen, keep current selected right tab.

**Branches:** Creation-layout/global gate differs from IPC view-only check.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:189-189](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:189). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:238-243](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:238); [src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts:150-162](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts:150); [src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:35-44](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:35).

**Shared routing:** native, guest, global; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert gate difference, twice restores openness and selected tab preserved; no hidden navigation mutation.

### sidebar.explorer.toggle

**Eligibility:** Right sidebar reveal allowed and not creation layout.

**Event:** Successful global claim prevents.

**Effect:** showRightSidebarFiles sets open=true, tab='explorer', explorerView='files', increments route request and stores per-workspace files view.

**Branches:** Despite toggle suffix it shows files rather than closing an already-open files sidebar; no workspace still updates navigation.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:197-197](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:197). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:245-250](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:245); [src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:44-77](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:44).

**Shared routing:** global; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert repeated action keeps open, switches search->files, route counter/per-workspace update and disallowed-view no-op.

### sidebar.search.toggle

**Eligibility:** Reveal allowed; selected explorer folder/include glob or selected text takes precedence before generic editable guard; terminal listener handles its selected text.

**Event:** Eligible selected-text/folder or plain claim prevents; no repeat at global route.

**Effect:** Show explorer/search open, route/per-workspace view update; trim optional query/include; seed results/owner/loading/collapse state and seed request when query or include+existing query, otherwise increment focus request.

**Branches:** No active workspace still opens navigation; no selection means show/focus existing search, not necessarily clear query or close sidebar.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:205-205](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:205). **Effect bodies:** [src/renderer/src/app-shell/use-global-keybindings.ts:138-162](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/use-global-keybindings.ts:138); [src/renderer/src/app-shell/app-command-handlers.ts:252-257](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:252); [src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:78-129](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:78); [src/renderer/src/components/terminal-pane/terminal-keyboard-event-handlers.ts:90-175](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-event-handlers.ts:90).

**Shared routing:** global, terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert selected folder include glob versus selected text, editable selection exception, terminal ownership, seeding vs focus-only and repeated show semantics.

### sidebar.sourceControl.toggle

**Eligibility:** Right-sidebar reveal allowed; source-control additionally yields while terminal search root exists.

**Event:** Successful claim prevents; blocked handler returns false.

**Effect:** Set rightSidebarTab='source-control' and rightSidebarOpen=true; set-tab increments route request.

**Branches:** Show/select semantics, not close-on-second-press. Source-control search conflict is DOM-presence based, not a metadata conflict group.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:213-213](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:213). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:259-269](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:259); [src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:35-62](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:35).

**Shared routing:** global; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert source-control selected/open/route counter on repeat invocation and gate failures; verify terminal-search conflict for source control.

### sidebar.checks.toggle

**Eligibility:** Right-sidebar reveal allowed and not creation layout.

**Event:** Successful claim prevents; blocked handler returns false.

**Effect:** Set rightSidebarTab='checks' and rightSidebarOpen=true; set-tab increments route request.

**Branches:** Second press keeps selected panel open; missing workspace may render empty content.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:221-221](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:221). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:259-269](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:259); [src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:35-62](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:35).

**Shared routing:** global; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert checks selected/open/route counter on repeat invocation and gate failures; verify terminal-search conflict for source control.

### sidebar.ports.toggle

**Eligibility:** Right-sidebar reveal allowed and not creation layout.

**Event:** Successful claim prevents; blocked handler returns false.

**Effect:** Set rightSidebarTab='ports' and rightSidebarOpen=true; set-tab increments route request.

**Branches:** Second press keeps selected panel open; missing workspace may render empty content.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:229-229](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:229). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:259-269](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:259); [src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:35-62](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/right-sidebar-state.ts:35).

**Shared routing:** global; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert ports selected/open/route counter on repeat invocation and gate failures; verify terminal-search conflict for source control.

### sidebar.sleepingWorkspaces.toggle

**Eligibility:** Ordinary global ownership/eligibility.

**Event:** Claim prevents.

**Effect:** Invert showSleepingWorkspaces; opening also opens left sidebar.

**Branches:** Hiding sleeping rows does not close sidebar or wake/sleep any workspace.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:241-241](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:241). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:152-163](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:152).

**Shared routing:** global; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert state flip and sidebar only-open behavior with no runtime wake/sleep calls.

### sidebar.focusWorktreeList

**Eligibility:** Mounted list handler; no active modal or ignored editable target.

**Event:** Match always prevents even absent ref; no repeat guard.

**Effect:** scrollRef.current?.focus().

**Branches:** Missing element is consumed no-op; does not open closed sidebar or change active workspace directly.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:260-260](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:260). **Effect bodies:** [src/renderer/src/components/sidebar/worktree-list/navigation/use-keyboard.ts:90-140](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/sidebar/worktree-list/navigation/use-keyboard.ts:90).

**Shared routing:** Action-specific listener above; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert focused element, missing ref consumed no-op, repeat, modal/editable target and sidebar-hidden behavior.

### floatingTerminal.toggle

**Eligibility:** Listener honors floatingTerminalEnabled===true; hydration controls restoration.

**Event:** Native/guest consume; renderer custom toggle event has no KeyboardEvent.

**Effect:** Toggle open through setOpenWithFocus; opening captures prior focused element, closing schedules restoration if connected; persist open when feature enabled.

**Branches:** Disabled event no-op; removed prior element not focused; hidden nonempty panel can remain mounted.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:269-269](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:269). **Effect bodies:** [src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts:173-185](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/settings-sidebar-ipc-bridge.ts:173); [src/renderer/src/app-shell/use-floating-workspace-panel.ts:1-145](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/use-floating-workspace-panel.ts:1).

**Shared routing:** native, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert enabled/disabled, hydration persisted open, focus restoration/removal and no main/remote workspace ownership bleed.

### floatingWorkspace.maximize

**Eligibility:** Closed: global branch only if feature enabled; open: owned floating chrome/context rules.

**Event:** Global closed branch prevents; open-panel consuming handler prevents/stops by listener type.

**Effect:** Closed opens with maximize intent. Open toggles maximized state, saves previous bounds, applies max bounds; next restores source-aware prior bounds; persists maximize state.

**Branches:** Closed disabled no-op; normal global branch does not re-maximize open panel; platform custom chords remain valid even where default unassigned.

**Definition:** [src/shared/keybindings/definitions-core-1.ts:278-278](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-1.ts:278). **Effect bodies:** [src/renderer/src/app-shell/use-floating-workspace-panel.ts:1-145](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/use-floating-workspace-panel.ts:1); [src/renderer/src/components/floating-terminal/use-floating-terminal-panel-maximize.ts:1-116](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-panel-maximize.ts:1).

**Shared routing:** global, floating; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **floating-max** (rendered component with mocks): Custom maximize chord changes rendered bounds to maximum. [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:697-719](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:697); [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:744-767](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:744)

**Remaining acceptance:** Assert closed-open intent, open maximize/restore bounds, disabled/no ownership, viewport changes and persistence.

### floatingWorkspace.minimize

**Eligibility:** Open owned floating panel only.

**Event:** Matched panel handler consumes; nonrepeat.

**Effect:** onOpenChange(false) hides panel, preserves tabs and maximize state; parent restores previous focus and persists openness.

**Branches:** No closed-panel handler/effect; minimize does not close terminals or unmaximize.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:6-6](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:6). **Effect bodies:** [src/renderer/src/components/floating-terminal/use-floating-terminal-panel-shortcuts.ts:130-255](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-panel-shortcuts.ts:130); [src/renderer/src/app-shell/use-floating-workspace-panel.ts:30-115](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/use-floating-workspace-panel.ts:30).

**Shared routing:** floating; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **floating-min** (rendered component with mocks): Minimize calls onOpenChange(false). [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:721-742](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:721)

**Remaining acceptance:** Assert hidden panel preserves tabs/maximized bounds, focus restore and reopen after persisted state.

### zoom.in

**Eligibility:** Native effective zoom binding; renderer resolves focused terminal, editor or UI. Guest page-specific zoom and PDF DOM listener are separate routes.

**Event:** Native/guest consumes including zoom repeat; PDF listener prevents matching DOM event; no claim that PDF wins native capture.

**Effect:** Direction 'in': focused terminal adjusts per-pane font by +/-1 bounded8..32 or resets to configured global font and removes override; fit and transient per-pane feedback (no settings/layout persistence in this hook). Editor/UI route updates zoom state and api.ui.set persistence. Local browser page uses webview zoom level, remembers pane/default, shows feedback. PDF reset sets page-width, not100%. Guest zoom is explicitly ui:zoomBrowserPage to active local page; generic main-window terminal:zoom while browser chrome is focused resolves UI. Terminal font override here is transient map/options, not a settings or layout write.

**Branches:** No/destroyed webview returns null; terminal needs manager/active-pane ownership; browser/simulator resolve UI in generic bridge. Actual OS/native/PDF event ordering remains execution acceptance.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:29-29](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:29). **Effect bodies:** [src/renderer/src/hooks/ipc-events/zoom-ipc-bridge.ts:1-48](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/zoom-ipc-bridge.ts:1); [src/renderer/src/hooks/resolve-zoom-target.ts:1-58](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/resolve-zoom-target.ts:1); [src/renderer/src/components/terminal-pane/useTerminalFontZoom.ts:1-71](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/useTerminalFontZoom.ts:1); [src/renderer/src/components/browser-pane/host-guest/browser-page-zoom.ts:1-118](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/browser-page-zoom.ts:1); [src/renderer/src/components/editor/PdfViewer.tsx:312-355](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/PdfViewer.tsx:312); [src/main/browser/browser-guest-shortcut-forwarding.ts:49-56](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.ts:49); [src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:137-159](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:137).

**Shared routing:** native, guest, browser; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **guest-zoom** (native event/router mocks): Guest zoom in/out/reset including repeated keydown sends direction and prevents default. [src/main/browser/browser-guest-shortcut-forwarding.test.ts:512-547](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.test.ts:512)

**Remaining acceptance:** Assert in independently on terminal/editor/UI/local guest/PDF with clamp/reset semantics, persistence scopes, focused sibling isolation, unbound native keys and no default zoom leakage.

### zoom.out

**Eligibility:** Native effective zoom binding; renderer resolves focused terminal, editor or UI. Guest page-specific zoom and PDF DOM listener are separate routes.

**Event:** Native/guest consumes including zoom repeat; PDF listener prevents matching DOM event; no claim that PDF wins native capture.

**Effect:** Direction 'out': focused terminal adjusts per-pane font by +/-1 bounded8..32 or resets to configured global font and removes override; fit and transient per-pane feedback (no settings/layout persistence in this hook). Editor/UI route updates zoom state and api.ui.set persistence. Local browser page uses webview zoom level, remembers pane/default, shows feedback. PDF reset sets page-width, not100%. Guest zoom is explicitly ui:zoomBrowserPage to active local page; generic main-window terminal:zoom while browser chrome is focused resolves UI. Terminal font override here is transient map/options, not a settings or layout write.

**Branches:** No/destroyed webview returns null; terminal needs manager/active-pane ownership; browser/simulator resolve UI in generic bridge. Actual OS/native/PDF event ordering remains execution acceptance.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:37-37](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:37). **Effect bodies:** [src/renderer/src/hooks/ipc-events/zoom-ipc-bridge.ts:1-48](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/zoom-ipc-bridge.ts:1); [src/renderer/src/hooks/resolve-zoom-target.ts:1-58](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/resolve-zoom-target.ts:1); [src/renderer/src/components/terminal-pane/useTerminalFontZoom.ts:1-71](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/useTerminalFontZoom.ts:1); [src/renderer/src/components/browser-pane/host-guest/browser-page-zoom.ts:1-118](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/browser-page-zoom.ts:1); [src/renderer/src/components/editor/PdfViewer.tsx:312-355](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/PdfViewer.tsx:312); [src/main/browser/browser-guest-shortcut-forwarding.ts:49-56](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.ts:49); [src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:137-159](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:137).

**Shared routing:** native, guest, browser; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **guest-zoom** (native event/router mocks): Guest zoom in/out/reset including repeated keydown sends direction and prevents default. [src/main/browser/browser-guest-shortcut-forwarding.test.ts:512-547](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.test.ts:512)

**Remaining acceptance:** Assert out independently on terminal/editor/UI/local guest/PDF with clamp/reset semantics, persistence scopes, focused sibling isolation, unbound native keys and no default zoom leakage.

### zoom.reset

**Eligibility:** Native effective zoom binding; renderer resolves focused terminal, editor or UI. Guest page-specific zoom and PDF DOM listener are separate routes.

**Event:** Native/guest consumes including zoom repeat; PDF listener prevents matching DOM event; no claim that PDF wins native capture.

**Effect:** Direction 'reset': focused terminal adjusts per-pane font by +/-1 bounded8..32 or resets to configured global font and removes override; fit and transient per-pane feedback (no settings/layout persistence in this hook). Editor/UI route updates zoom state and api.ui.set persistence. Local browser page uses webview zoom level, remembers pane/default, shows feedback. PDF reset sets page-width, not100%. Guest zoom is explicitly ui:zoomBrowserPage to active local page; generic main-window terminal:zoom while browser chrome is focused resolves UI. Terminal font override here is transient map/options, not a settings or layout write.

**Branches:** No/destroyed webview returns null; terminal needs manager/active-pane ownership; browser/simulator resolve UI in generic bridge. Actual OS/native/PDF event ordering remains execution acceptance.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:45-45](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:45). **Effect bodies:** [src/renderer/src/hooks/ipc-events/zoom-ipc-bridge.ts:1-48](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/zoom-ipc-bridge.ts:1); [src/renderer/src/hooks/resolve-zoom-target.ts:1-58](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/resolve-zoom-target.ts:1); [src/renderer/src/components/terminal-pane/useTerminalFontZoom.ts:1-71](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/useTerminalFontZoom.ts:1); [src/renderer/src/components/browser-pane/host-guest/browser-page-zoom.ts:1-118](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/browser-page-zoom.ts:1); [src/renderer/src/components/editor/PdfViewer.tsx:312-355](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/PdfViewer.tsx:312); [src/main/browser/browser-guest-shortcut-forwarding.ts:49-56](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.ts:49); [src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:137-159](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:137).

**Shared routing:** native, guest, browser; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **guest-zoom** (native event/router mocks): Guest zoom in/out/reset including repeated keydown sends direction and prevents default. [src/main/browser/browser-guest-shortcut-forwarding.test.ts:512-547](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.test.ts:512)

**Remaining acceptance:** Assert reset independently on terminal/editor/UI/local guest/PDF with clamp/reset semantics, persistence scopes, focused sibling isolation, unbound native keys and no default zoom leakage.

### worktree.history.back

**Eligibility:** Global allowed-view/noncreation gate; IPC explicitly requires terminal view.

**Event:** Successful global claim prevents even when history empty; native/guest can consume without receiver/history.

**Effect:** Invoke goBackWorktree() through history; search next valid history entry, activate host-qualified workspace, update index under navigation guard without recording another history entry.

**Branches:** Endpoint/empty/dead-only history no change; failed activation preserves index; receiver view gate narrower than generic allowed-view.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:53-53](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:53). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:130-149](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:130); [src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:115-128](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:115); [src/renderer/src/store/slices/worktree-nav-history.ts:1-315](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/worktree-nav-history.ts:1).

**Shared routing:** native, guest, global; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **workspace-history** (store with mocked activation): Back/forward update index without growing history; failed activation preserves index; dead entry is skipped. [src/renderer/src/store/slices/worktree-nav-history.test.ts:127-176](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/worktree-nav-history.test.ts:127)

**Remaining acceptance:** Assert real back host/folder activation, dead entries, failed activation, endpoint and nonterminal route differences.

### worktree.history.forward

**Eligibility:** Global allowed-view/noncreation gate; IPC explicitly requires terminal view.

**Event:** Successful global claim prevents even when history empty; native/guest can consume without receiver/history.

**Effect:** Invoke goForwardWorktree() through history; search next valid history entry, activate host-qualified workspace, update index under navigation guard without recording another history entry.

**Branches:** Endpoint/empty/dead-only history no change; failed activation preserves index; receiver view gate narrower than generic allowed-view.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:62-62](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:62). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:130-149](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:130); [src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:115-128](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:115); [src/renderer/src/store/slices/worktree-nav-history.ts:1-315](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/worktree-nav-history.ts:1).

**Shared routing:** native, guest, global; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **workspace-history** (store with mocked activation): Back/forward update index without growing history; failed activation preserves index; dead entry is skipped. [src/renderer/src/store/slices/worktree-nav-history.test.ts:127-176](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/worktree-nav-history.test.ts:127)

**Remaining acceptance:** Assert real forward host/folder activation, dead entries, failed activation, endpoint and nonterminal route differences.

### tab.newTerminal

**Eligibility:** Active main workspace and resolved group/runtime route; floating uses fixed scratch workspace independent of selected remote runtime.

**Event:** Nonrepeat consumes; native guest forwarding may consume before missing main target.

**Effect:** Main group path creates host terminal or store terminal; local fallback createTab then terminal type/order/focus. Floating createTab(floatingId,group,shellOverride,{activate:false}) then activate and focus.

**Branches:** Unresolved Git owner/no group or unavailable web fallback yields; host creation outcome prevents accidental local fallback; creation errors routed by surrounding caller.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:71-71](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:71). **Effect bodies:** [src/renderer/src/components/use-terminal-create-actions.ts:35-135](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-create-actions.ts:35); [src/renderer/src/store/terminals/terminal-active-workspace-creation.ts:1-69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/terminals/terminal-active-workspace-creation.ts:1); [src/renderer/src/hooks/ipc-events/tab-lifecycle-ipc-bridge.ts:25-85](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/tab-lifecycle-ipc-bridge.ts:25); [src/renderer/src/lib/floating-workspace-tab-creation.ts:24-38](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-tab-creation.ts:24); [src/renderer/src/components/floating-terminal/use-floating-terminal-create-actions.ts:25-75](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-create-actions.ts:25).

**Shared routing:** workspace, floating, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **floating-create** (rendered component with service/store mocks): New terminal creates floating/group tab with activate:false then activates it; open Markdown invokes picker; both prevent default. [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:181-233](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:181)
- **floating-double-tap** (rendered component with mocks): First tap unclaimed; completed double tap prevents/stops and creates exactly one floating terminal. [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:235-307](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:235)

**Remaining acceptance:** Assert local/SSH/paired runtime and floating ownership, group/order/focus, no local fallback on unavailable owner, failure and double tap.

### tab.newAgent

**Eligibility:** Effective static shortcut chooses enabled detected preferred/default agent for active connection; requires active workspace/group. Dynamic agent IDs are separate candidates.

**Event:** Nonrepeat workspace match consumes; no eligible agent shows toast.

**Effect:** launchAgentInNewTab(agent,worktreeId,groupId,launchSource:shortcut) resolves execution-host platform, startup plan/command/env. Remote launches host agent; structured Codex route has definitive-refusal legacy fallback; local creates terminal with startup plan, sets terminal type and persists tab order.

**Branches:** No startup plan returns null; no CLI/eligible agent toast; no exhaustive static model catalog inference. Guest forwarding switch has no newAgent case. Actual subprocess readiness/prompt delivery belongs downstream launch contract.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:79-79](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:79). **Effect bodies:** [src/renderer/src/components/terminal-agent-tab-shortcut.ts:1-42](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-agent-tab-shortcut.ts:1); [src/renderer/src/components/use-terminal-create-actions.ts:89-115](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-create-actions.ts:89); [src/renderer/src/lib/launch-agent-in-new-tab.ts:91-347](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/launch-agent-in-new-tab.ts:91).

**Shared routing:** workspace; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert static preferred/fallback/disabled/remote-detected agent selection, null/toast, structured definitive refusal vs unsafe fallback and exact owner/group/host platform; launch only in isolated reviewed harness.

### tab.newBrowser

**Eligibility:** Active group/workspace and client managed-browser policy; floating explicitly local scratch owner.

**Event:** Nonrepeat consumes before policy check in workspace handler; guest forwards new-browser.

**Effect:** Open browser using configured default URL, focusAddressBar true and target group; runtime creates host browser with client group identity; local creates browser workspace/tab. Floating sets browserRuntimeEnvironmentId:null.

**Branches:** Disabled/unavailable policy, no group, missing runtime environment or failed host creation cannot fall back silently to local; creation catch shows toast.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:92-92](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:92). **Effect bodies:** [src/renderer/src/components/use-terminal-create-actions.ts:130-164](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-create-actions.ts:130); [src/renderer/src/store/slices/browser/browser-tab-actions.ts:160-211](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser/browser-tab-actions.ts:160); [src/renderer/src/hooks/ipc-events/content-creation-ipc-bridge.ts:1-78](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/content-creation-ipc-bridge.ts:1); [src/renderer/src/lib/floating-workspace-tab-creation.ts:40-59](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-tab-creation.ts:40); [src/renderer/src/components/floating-terminal/use-floating-terminal-create-actions.ts:68-91](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-create-actions.ts:68).

**Shared routing:** workspace, floating, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert owner/group/defaultURL/address focus, policy-disabled consumed no-op/error, runtime failure no local fallback and floating local isolation.

### tab.newSimulator

**Eligibility:** Setting mobileEmulatorEnabled required; guest dispatch additionally Darwin. Main client creation policy; active workspace/group; floating match consumed but does not create.

**Event:** Workspace nonrepeat consumes only feature-enabled match then policy/floating guards; IPC skips active runtime.

**Effect:** openMobileEmulatorTab({placement:'rightSplit',targetGroupId}); reuse existing tab, cancel pending shutdown, ensure unified tab and launch request; call emulator.attach({worktree,focus:false}), publish info or failed state.

**Branches:** Disabled returns null; missing group throws; user closed during attach triggers shutdown guard; attach error toasts and marks failed tab then returns its ID; pending launch released finally.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:100-100](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:100). **Effect bodies:** [src/renderer/src/components/terminal-workspace-keydown.ts:110-175](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:110); [src/renderer/src/hooks/ipc-events/content-creation-ipc-bridge.ts:112-133](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/content-creation-ipc-bridge.ts:112); [src/renderer/src/lib/open-mobile-emulator-tab.ts:1-132](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/open-mobile-emulator-tab.ts:1); [src/renderer/src/components/use-terminal-create-actions.ts:117-128](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-create-actions.ts:117).

**Shared routing:** workspace, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert actual eligibility difference Darwin guest/main custom bindings, duplicate launch reuse, rightsplit, runtime/floating no-op, attach error and close-during-start cancellation.

### tab.newMarkdown

**Eligibility:** Active owner/group in main; floating requires configured/API scratch markdown directory.

**Event:** Nonrepeat workspace/floating consume; native guest forwards.

**Effect:** Capture file-operation provenance; template picker creates untitled Markdown then openFile(preview:false,targetGroupId); floating suppresses active-runtime fallback and uses local scratch directory.

**Branches:** Canceled template/no directory -> no file/tab; stale owner generation or creation/open error -> toast; no group main no-op.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:113-113](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:113). **Effect bodies:** [src/renderer/src/components/use-terminal-create-actions.ts:214-225](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-create-actions.ts:214); [src/renderer/src/store/slices/editor/actions/markdown-preview-actions.ts:20-82](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/markdown-preview-actions.ts:20); [src/renderer/src/hooks/ipc-events/content-creation-ipc-bridge.ts:73-114](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/content-creation-ipc-bridge.ts:73); [src/renderer/src/lib/floating-workspace-tab-creation.ts:61-91](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-tab-creation.ts:61); [src/renderer/src/components/floating-terminal/use-floating-terminal-create-actions.ts:93-117](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-create-actions.ts:93).

**Shared routing:** workspace, floating, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert template cancel, current host/generation at creation, exact directory/group and local floating isolation; verify created bytes in disposable fixture only.

### tab.openMarkdown

**Eligibility:** Open floating panel owned shortcut context; root/group selected there.

**Event:** Nonrepeat panel match consumes.

**Effect:** Invoke pickFloatingMarkdownDocument; selected document opens in floating workspace target group through openMarkdownDocumentInFloatingWorkspace.

**Branches:** Canceled picker/no document no-op; errors toast. Main terminal-workspace exhaustive handler and native guest switch do not select this action; normal tab-bar shortcut label/menu action is not proof of a main keyboard route.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:121-121](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:121). **Effect bodies:** [src/renderer/src/components/floating-terminal/use-floating-terminal-panel-shortcuts.ts:35-180](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-panel-shortcuts.ts:35); [src/renderer/src/components/floating-terminal/use-floating-terminal-create-actions.ts:100-144](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-create-actions.ts:100).

**Shared routing:** floating; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **floating-create** (rendered component with service/store mocks): New terminal creates floating/group tab with activate:false then activates it; open Markdown invokes picker; both prevent default. [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:181-233](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:181)

**Remaining acceptance:** Assert floating picker cancel/open/error and group identity; demonstrate/decide unsupported main keyboard binding explicitly, without counting menu label as behavior.

### tab.close

**Eligibility:** Terminal input yields to L3 close-pane alias; floating owns its visible item; standard chrome inspects active type; browser guest source page owner is authoritative.

**Event:** Nonrepeat consumes; empty floating close consumes and hides panel. Main terminal/simulator chrome branches can consume without an editor/browser effect.

**Effect:** Editor routes close request/dirty queue; browser closes source owner after pin guard and remote/local close plan, selects replacement before destroying guest. Floating terminal uses closeTerminalTab, other types guarded by pin and dirty editor queue. L3 closes pane or sole-pane tab. Editor queue deduplicates open IDs, skips missing, closes now-clean entries, activates dirty target and opens save dialog. Subsequent Save dispatches save-and-close and waits up to10s; timeout reopens dialog. Discard quiesces autosave best-effort, clears dirty and closes; Cancel clears pending queue.

**Branches:** Unknown explicit guest page never falls back to ambient active browser; pinned/dirty confirmation can cancel; floating empty does not destroy tabs. Pane process verdict !=live currently closes, including unverifiable (recorded source defect candidate).

**Definition:** [src/shared/keybindings/definitions-core-2.ts:129-129](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:129). **Effect bodies:** [src/renderer/src/components/terminal-workspace-keydown.ts:175-229](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:175); [src/renderer/src/components/use-terminal-close-actions.ts:1-120](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-close-actions.ts:1); [src/renderer/src/hooks/ipc-events/tab-lifecycle-ipc-bridge.ts:75-165](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/tab-lifecycle-ipc-bridge.ts:75); [src/renderer/src/components/floating-terminal/use-floating-terminal-close-actions.ts:78-133](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-close-actions.ts:78); [src/renderer/src/components/terminal-pane/use-terminal-pane-close-actions.ts:45-225](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/use-terminal-pane-close-actions.ts:45); [src/renderer/src/components/use-terminal-editor-close-queue.ts:45-125](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-editor-close-queue.ts:45); [src/renderer/src/components/use-terminal-editor-close-dialog-actions.ts:30-123](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-editor-close-dialog-actions.ts:30).

**Shared routing:** workspace, floating, guest, terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **floating-empty-close** (rendered component with mocks): Closing empty floating panel hides it and does not close a terminal tab. [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:769-790](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:769)

**Remaining acceptance:** Assert each selected surface/type, dirty/pinned cancel, exact source page owner, remote plan and no wrong tab close; isolate process-liveness policy discrepancy for root decision.

### tab.closeAll

**Eligibility:** Main active workspace shortcut path; catalog title is Close all editor tabs. Floating helper exists for its menu but generic panel shortcut map does not establish this keyboard route.

**Event:** Workspace nonrepeat consumes before helper.

**Effect:** Filter unpinned editor files in active workspace; close clean immediately and queue dirty file close requests. Editor queue deduplicates open IDs, skips missing, closes now-clean entries, activates dirty target and opens save dialog. Subsequent Save dispatches save-and-close and waits up to10s; timeout reopens dialog. Discard quiesces autosave best-effort, clears dirty and closes; Cancel clears pending queue.

**Branches:** Does not close terminal/browser tabs. No active workspace -> no-op; dirty close requires later confirmation; floating helper availability alone is not keyboard coverage.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:137-137](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:137). **Effect bodies:** [src/renderer/src/components/terminal-workspace-keydown.ts:196-201](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:196); [src/renderer/src/components/use-terminal-bulk-close-actions.ts:120-152](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-bulk-close-actions.ts:120); [src/renderer/src/components/floating-terminal/use-floating-terminal-close-actions.ts:199-217](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-close-actions.ts:199); [src/renderer/src/components/use-terminal-editor-close-queue.ts:45-125](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-editor-close-queue.ts:45); [src/renderer/src/components/use-terminal-editor-close-dialog-actions.ts:30-123](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/use-terminal-editor-close-dialog-actions.ts:30).

**Shared routing:** workspace; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert mixed terminal/browser/editor set, pinned exclusion, dirty confirm/cancel and empty workspace; determine floating keyboard ownership without inferring from helper.

### tab.rename

**Eligibility:** Main workspace chrome, active terminal tab only, not floating; floating active terminal tab selected by its own handler.

**Event:** Global/panel successful claim prevents; panel missing active tab leaves rename unclaimed.

**Effect:** Dispatch requestTerminalTabRename(tabId); mounted matching sortable tab captures current customTitle/title, enters editing, RAF focus/select. Later commit trims blank to null with once guard; cancel exits without mutation.

**Branches:** Chord itself does not persist title; missing/nonterminal main tab or absent mounted recipient no visible effect.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:145-145](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:145). **Effect bodies:** [src/renderer/src/app-shell/app-command-handlers.ts:174-186](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/app-command-handlers.ts:174); [src/renderer/src/components/floating-terminal/use-floating-terminal-panel-shortcuts.ts:115-230](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-panel-shortcuts.ts:115); [src/renderer/src/components/tab-bar/use-sortable-tab-rename.ts:1-94](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-bar/use-sortable-tab-rename.ts:1).

**Shared routing:** global, floating; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **floating-cycle-rename** (rendered component with mocks): Next-all selects tab-2 and focuses it; rename dispatches tab-1 event without mutating custom title. [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:372-452](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:372)
- **floating-noop** (rendered component with mocks): Out-of-range index is consumed with no activation; absent active tab emits no rename event. [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:579-624](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:579)

**Remaining acceptance:** Assert event target identity, editor focus/select, no immediate customTitle write and commit/cancel exactly once.

### tab.reopenClosed

**Eligibility:** Active workspace; nonrepeat action; source cross-kind recently-closed sequence.

**Event:** Workspace consumes then invokes reopen callback; rejection handled by surrounding creation-error path.

**Effect:** Pop newest kind, skip drained snapshots; local terminal creates fresh ID/PTy-null with cwd/shell/title/color/order; browser rebuilds workspace/pages preserving profile/partition/order and selected index; editor opens snapshot file/group/reopen ID and restores position.

**Branches:** Explicit remote runtime terminal reopen returns false leaving terminal snapshot; cross-kind kind marker already shifted. Empty stack false; cannot resurrect original running PTY.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:159-159](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:159). **Effect bodies:** [src/renderer/src/components/terminal-workspace-keydown.ts:75-116](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:75); [src/renderer/src/store/slices/recently-closed-tabs.ts:122-203](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/recently-closed-tabs.ts:122); [src/renderer/src/store/slices/browser/browser-tab-focus-actions.ts:1-95](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/browser/browser-tab-focus-actions.ts:1); [src/renderer/src/store/slices/editor/actions/recently-closed-editor-tabs.ts:1-38](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/recently-closed-editor-tabs.ts:1).

**Shared routing:** workspace; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **reopen** (store mutation with mocks): Local reopen creates fresh terminal identity with null PTY and preserved cwd/shell/title/color; remote terminal refusal leaves snapshot. [src/renderer/src/store/slices/recently-closed-tabs.test.ts:180-240](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/recently-closed-tabs.test.ts:180); [src/renderer/src/store/slices/recently-closed-tabs.test.ts:365-420](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/recently-closed-tabs.test.ts:365)

**Remaining acceptance:** Assert alternating kind order, drained markers, duplicate call, browser duplicate URLs and active index, remote terminal refusal and file reopen failure.

### tab.nextSameType

**Eligibility:** Active workspace/group with eligible visible candidates; floating focus dispatches floating helper.

**Event:** Nonrepeat workspace consumes prevent+stop+stopImmediate before helper; native guest can consume even no target.

**Effect:** Cycle forward through same candidates. Same/all prefer exact active unified identity and visible group order, activate selected content type/entity/split; terminal-only uses terminal group order with bounded hydration fallback and updates active terminal/type. Floating mirrors visible-group selection and terminal/browser focus notification.

**Branches:** Zero/single eligible, missing active or no candidate returns false as helper defines; missing active terminal chooses directional endpoint. Terminal fallback does not steal from legitimate single-terminal/editor-only split. Forward tests are not evidence of backward direction.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:167-167](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:167). **Effect bodies:** [src/renderer/src/hooks/ipc-tab-switch.ts:1-385](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.ts:1); [src/renderer/src/lib/floating-workspace-terminal-actions.ts:70-280](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-terminal-actions.ts:70); [src/renderer/src/components/terminal-workspace-keydown.ts:217-267](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:217).

**Shared routing:** workspace, floating, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **same-cycle** (store fixture and activation mocks): Forward same-type selects exact split/unified terminal/editor/browser identity; single type returns false. [src/renderer/src/hooks/ipc-tab-switch.test.ts:285-359](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.test.ts:285)

**Remaining acceptance:** Assert forward independently across mixed/same types, split duplicate entities, wrap, absent current, OOB/empty, remote owner and floating; verify no fallback across legitimate split boundary.

### tab.previousSameType

**Eligibility:** Active workspace/group with eligible visible candidates; floating focus dispatches floating helper.

**Event:** Nonrepeat workspace consumes prevent+stop+stopImmediate before helper; native guest can consume even no target.

**Effect:** Cycle backward through same candidates. Same/all prefer exact active unified identity and visible group order, activate selected content type/entity/split; terminal-only uses terminal group order with bounded hydration fallback and updates active terminal/type. Floating mirrors visible-group selection and terminal/browser focus notification.

**Branches:** Zero/single eligible, missing active or no candidate returns false as helper defines; missing active terminal chooses directional endpoint. Terminal fallback does not steal from legitimate single-terminal/editor-only split. Forward tests are not evidence of backward direction.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:176-176](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:176). **Effect bodies:** [src/renderer/src/hooks/ipc-tab-switch.ts:1-385](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.ts:1); [src/renderer/src/lib/floating-workspace-terminal-actions.ts:70-280](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-terminal-actions.ts:70); [src/renderer/src/components/terminal-workspace-keydown.ts:217-267](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:217).

**Shared routing:** workspace, floating, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert backward independently across mixed/same types, split duplicate entities, wrap, absent current, OOB/empty, remote owner and floating; verify no fallback across legitimate split boundary.

### tab.nextAllTypes

**Eligibility:** Active workspace/group with eligible visible candidates; floating focus dispatches floating helper.

**Event:** Nonrepeat workspace consumes prevent+stop+stopImmediate before helper; native guest can consume even no target.

**Effect:** Cycle forward through all candidates. Same/all prefer exact active unified identity and visible group order, activate selected content type/entity/split; terminal-only uses terminal group order with bounded hydration fallback and updates active terminal/type. Floating mirrors visible-group selection and terminal/browser focus notification.

**Branches:** Zero/single eligible, missing active or no candidate returns false as helper defines; missing active terminal chooses directional endpoint. Terminal fallback does not steal from legitimate single-terminal/editor-only split. Forward tests are not evidence of backward direction.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:184-184](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:184). **Effect bodies:** [src/renderer/src/hooks/ipc-tab-switch.ts:1-385](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.ts:1); [src/renderer/src/lib/floating-workspace-terminal-actions.ts:70-280](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-terminal-actions.ts:70); [src/renderer/src/components/terminal-workspace-keydown.ts:217-267](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:217).

**Shared routing:** workspace, floating, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **all-cycle** (store fixture and activation mocks): Forward all-types selects editor after terminal and wraps browser to terminal; singleton returns false. [src/renderer/src/hooks/ipc-tab-switch.test.ts:381-429](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.test.ts:381)
- **floating-cycle-rename** (rendered component with mocks): Next-all selects tab-2 and focuses it; rename dispatches tab-1 event without mutating custom title. [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:372-452](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:372)

**Remaining acceptance:** Assert forward independently across mixed/same types, split duplicate entities, wrap, absent current, OOB/empty, remote owner and floating; verify no fallback across legitimate split boundary.

### tab.previousAllTypes

**Eligibility:** Active workspace/group with eligible visible candidates; floating focus dispatches floating helper.

**Event:** Nonrepeat workspace consumes prevent+stop+stopImmediate before helper; native guest can consume even no target.

**Effect:** Cycle backward through all candidates. Same/all prefer exact active unified identity and visible group order, activate selected content type/entity/split; terminal-only uses terminal group order with bounded hydration fallback and updates active terminal/type. Floating mirrors visible-group selection and terminal/browser focus notification.

**Branches:** Zero/single eligible, missing active or no candidate returns false as helper defines; missing active terminal chooses directional endpoint. Terminal fallback does not steal from legitimate single-terminal/editor-only split. Forward tests are not evidence of backward direction.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:192-192](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:192). **Effect bodies:** [src/renderer/src/hooks/ipc-tab-switch.ts:1-385](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.ts:1); [src/renderer/src/lib/floating-workspace-terminal-actions.ts:70-280](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-terminal-actions.ts:70); [src/renderer/src/components/terminal-workspace-keydown.ts:217-267](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:217).

**Shared routing:** workspace, floating, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert backward independently across mixed/same types, split duplicate entities, wrap, absent current, OOB/empty, remote owner and floating; verify no fallback across legitimate split boundary.

### tab.previousRecent

**Eligibility:** Held Ctrl+Tab family goes to RecentTabSwitcher, requiring terminal view/active workspace; customized nonheld action uses immediate MRU helper.

**Event:** Held keydown consumes and opens/advances; repeats can advance. Modifier keyup commits and consumes before terminal; Escape/blur cancels. Nonheld path nonrepeat prevent+stopImmediate. Electron guest held keydown specifically sends ctrlTabKeyDown without preventDefault to preserve keyup; guest commit-release prevents then sends ctrlTabKeyUp. DOM listener consumption is a different layer.

**Effect:** Held switcher derives order from ctrlTabOrderMode and visible group, tracks selected index until modifier release then activates exact candidate. Immediate path sanitizes MRU against visible tabs and activates preceding candidate.

**Branches:** No prior visible candidate -> false; stale/dead identities excluded. Do not flatten held release protocol into one immediate action.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:200-200](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:200). **Effect bodies:** [src/renderer/src/components/terminal-workspace-keydown.ts:202-216](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:202); [src/renderer/src/hooks/ipc-tab-switch.ts:340-385](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.ts:340); [src/renderer/src/components/tab-bar/RecentTabSwitcher.tsx:1-194](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-bar/RecentTabSwitcher.tsx:1); [src/main/browser/browser-guest-shortcut-forwarding.ts:70-90](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.ts:70).

**Shared routing:** workspace, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **recent-cycle** (store fixture and activation mocks): MRU switch activates prior browser unified identity; no previous candidate returns false. [src/renderer/src/hooks/ipc-tab-switch.test.ts:430-475](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.test.ts:430)
- **held-recent** (DOM and mocked activation): DOM and IPC opening commit selected tab on Control release before terminal keyup receives event; listbox disappears. [src/renderer/src/components/tab-bar/RecentTabSwitcher.test.tsx:166-216](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-bar/RecentTabSwitcher.test.tsx:166); [src/renderer/src/components/tab-bar/RecentTabSwitcher.test.tsx:147-151](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-bar/RecentTabSwitcher.test.tsx:147)

**Remaining acceptance:** Assert held/repeat/release ordering, cancel/blur, custom immediate binding, MRU versus index mode and split-scoped exact activation.

### tab.nextTerminal

**Eligibility:** Active workspace/group with eligible visible candidates; floating focus dispatches floating helper.

**Event:** Nonrepeat workspace consumes prevent+stop+stopImmediate before helper; native guest can consume even no target.

**Effect:** Cycle forward through terminal candidates. Same/all prefer exact active unified identity and visible group order, activate selected content type/entity/split; terminal-only uses terminal group order with bounded hydration fallback and updates active terminal/type. Floating mirrors visible-group selection and terminal/browser focus notification.

**Branches:** Zero/single eligible, missing active or no candidate returns false as helper defines; missing active terminal chooses directional endpoint. Terminal fallback does not steal from legitimate single-terminal/editor-only split. Forward tests are not evidence of backward direction.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:209-209](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:209). **Effect bodies:** [src/renderer/src/hooks/ipc-tab-switch.ts:1-385](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.ts:1); [src/renderer/src/lib/floating-workspace-terminal-actions.ts:70-280](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-terminal-actions.ts:70); [src/renderer/src/components/terminal-workspace-keydown.ts:217-267](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:217).

**Shared routing:** workspace, floating, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **terminal-cycle** (store fixture and activation mocks): Forward terminal cycle skips editor and wraps final terminal to first. [src/renderer/src/hooks/ipc-tab-switch.test.ts:84-118](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.test.ts:84)

**Remaining acceptance:** Assert forward independently across mixed/same types, split duplicate entities, wrap, absent current, OOB/empty, remote owner and floating; verify no fallback across legitimate split boundary.

### tab.previousTerminal

**Eligibility:** Active workspace/group with eligible visible candidates; floating focus dispatches floating helper.

**Event:** Nonrepeat workspace consumes prevent+stop+stopImmediate before helper; native guest can consume even no target.

**Effect:** Cycle backward through terminal candidates. Same/all prefer exact active unified identity and visible group order, activate selected content type/entity/split; terminal-only uses terminal group order with bounded hydration fallback and updates active terminal/type. Floating mirrors visible-group selection and terminal/browser focus notification.

**Branches:** Zero/single eligible, missing active or no candidate returns false as helper defines; missing active terminal chooses directional endpoint. Terminal fallback does not steal from legitimate single-terminal/editor-only split. Forward tests are not evidence of backward direction.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:218-218](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:218). **Effect bodies:** [src/renderer/src/hooks/ipc-tab-switch.ts:1-385](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-tab-switch.ts:1); [src/renderer/src/lib/floating-workspace-terminal-actions.ts:70-280](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/floating-workspace-terminal-actions.ts:70); [src/renderer/src/components/terminal-workspace-keydown.ts:217-267](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.ts:217).

**Shared routing:** workspace, floating, guest; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert backward independently across mixed/same types, split duplicate entities, wrap, absent current, OOB/empty, remote owner and floating; verify no fallback across legitimate split boundary.

### tab.selectByIndex

**Eligibility:** Zero-based digit family; terminal view/active workspace; palette modal suppresses main tab selection. Floating index uses its own visible group.

**Event:** Native/index repeat consumption per resolver; floating consumes OOB. Terminal-first may leave chord unclaimed.

**Effect:** Resolve active/fallback group, dedupe valid tabOrder and append missing tabs; focus group and activate unified target; synchronize terminal/browser host activation and active entity/type, simulator tab or editor file.

**Branches:** Negative/OOB/empty group no activation; no arbitrary nth terminal-only assumption; palette index belongs to palette workspace path.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:227-227](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:227). **Effect bodies:** [src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:103-130](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:103); [src/renderer/src/lib/tab-number-shortcuts.ts:1-105](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/tab-number-shortcuts.ts:1); [src/renderer/src/components/floating-terminal/use-floating-terminal-panel-shortcuts.ts:90-218](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/use-floating-terminal-panel-shortcuts.ts:90).

**Shared routing:** native, guest, floating; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **native-global** (pure resolver; no renderer effect): Resolved action objects name openSettings, toggleWorktreePalette, openQuickOpen and zero-based numbered workspace/tab targets, including non-Mac modifiers. [src/shared/window-shortcut-policy.test.ts:43-107](/Users/carlos/Documents/Drogon-mentu-session/src/shared/window-shortcut-policy.test.ts:43)
- **floating-noop** (rendered component with mocks): Out-of-range index is consumed with no activation; absent active tab emits no rename event. [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:579-624](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:579)
- **floating-policy** (rendered component with mocks): Terminal-first numbered tab chords on Darwin/Linux remain unclaimed. [src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:626-695](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/floating-terminal/FloatingTerminalPanel.shortcuts.test.tsx:626)

**Remaining acceptance:** Assert1-9 mixed type ordering, deduped stale IDs, same entity in split, host IDs, palette and OOB/terminal-first branches.

### tab.openQuickCommandsMenu

**Eligibility:** Mounted focused group/tab-bar hook, active terminal view, recorder/context/terminal-policy guards.

**Event:** DOM nonrepeat consumes prevent+stopImmediate; double taps reset on blur; IPC custom event toggles without another chord check.

**Effect:** onOpenChange(!menuOpen) toggles quick-command menu.

**Branches:** No command execution or agent launch until later menu selection; unfocused groups must not duplicate toggle.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:241-241](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:241). **Effect bodies:** [src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:20-40](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/hooks/ipc-events/workspace-shortcut-ipc-bridge.ts:20); [src/renderer/src/components/tab-bar/tab-bar-quick-commands-shortcut.ts:1-150](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-bar/tab-bar-quick-commands-shortcut.ts:1).

**Shared routing:** native, guest, workspace; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **native-quick-menu** (pure resolver): Custom quick-menu binding resolves under orca-first but is null under terminal-first. [src/shared/window-shortcut-policy.test.ts:109-137](/Users/carlos/Documents/Drogon-mentu-session/src/shared/window-shortcut-policy.test.ts:109)
- **guest-menu** (native event/router mocks): Custom quick-command menu chord sends expected IPC and prevents default. [src/main/browser/browser-guest-shortcut-forwarding.test.ts:608-629](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.test.ts:608)
- **quick-menu** (hook/callback mocks): Matching chord toggles menu true then false and prevents/stops immediately; repeats/nonmatches do not toggle. [src/renderer/src/components/tab-bar/TabBarQuickCommandsMenu.keyboard.test.ts:212-291](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/tab-bar/TabBarQuickCommandsMenu.keyboard.test.ts:212)

**Remaining acceptance:** Assert focused group only, repeat/doubletap, recorder, IPC and DOM no double dispatch, and no command execution from opening.

### browser.find

**Eligibility:** Active local chrome scope and owned page/workspace target; find allowed in address input. Guest IPC carries owner identity.

**Event:** Local prevent+stop opens find; streamed remote consumes prevent+stopImmediate and does not forward text; repeated notice idempotent with timer refresh.

**Effect:** Local setFindOpen(true), closes when deactivated; query execution is later UI action. Remote displays unavailable notice for4seconds.

**Branches:** Inactive/foreign pane yields. Streamed browser has no implemented find behavior; notice is real unsupported branch.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:251-251](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:251). **Effect bodies:** [src/renderer/src/components/browser-pane/assemble-chrome/use-browser-page-find-shortcuts.ts:1-68](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/assemble-chrome/use-browser-page-find-shortcuts.ts:1); [src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-chrome-chords.ts:1-117](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-chrome-chords.ts:1).

**Shared routing:** guest, browser; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **guest-find** (native event/router mocks): Find IPC carries page and registered workspace, or undefined workspace when absent. [src/main/browser/browser-guest-shortcut-forwarding.test.ts:573-606](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.test.ts:573)
- **remote-find** (rendered remote pane with RPC mocks): Find displays unavailable notice and sends neither RPC nor remote keyboard input. [src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.chrome-chords.test.tsx:224-237](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.chrome-chords.test.tsx:224)

**Remaining acceptance:** Assert local find UI focus/query workflow and deactivation, guest page identity; remote unavailable notice and zero RPC/input calls.

### browser.back

**Eligibility:** Active local page or active remote page; local history listener lacks reload-style editable guard.

**Event:** Local/remote capture prevents+stops; no explicit repeat guard in history listener; guest native consumes then IPC.

**Effect:** Local optional webview.goBack(). Remote runRemoteNavigation(browser.back) resolves target, ignores staged page, obtains current page token, marks busy/loading, calls RPC with worktree/page and30s timeout, applies sanitized URL/title/history on current completion.

**Branches:** Missing webview/runtime/page/token/staged/obsolete operation no effect; remote missing-page error closes missing page; other current error sets notice/loadError, clears busy finally. No local canGoBack/Forward guard in listener.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:259-259](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:259). **Effect bodies:** [src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:30-100](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:30); [src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:106-250](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:106).

**Shared routing:** guest, browser; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **guest-history** (native event/router mocks): Guest back/forward sends corresponding renderer navigation IPC and prevents default. [src/main/browser/browser-guest-shortcut-forwarding.test.ts:548-571](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.test.ts:548)

**Remaining acceptance:** Assert back separately at history endpoint, missing/destroyed guest, editable focus, repeat, staged/remote-token race and missing-page/error handling.

### browser.forward

**Eligibility:** Active local page or active remote page; local history listener lacks reload-style editable guard.

**Event:** Local/remote capture prevents+stops; no explicit repeat guard in history listener; guest native consumes then IPC.

**Effect:** Local optional webview.goForward(). Remote runRemoteNavigation(browser.forward) resolves target, ignores staged page, obtains current page token, marks busy/loading, calls RPC with worktree/page and30s timeout, applies sanitized URL/title/history on current completion.

**Branches:** Missing webview/runtime/page/token/staged/obsolete operation no effect; remote missing-page error closes missing page; other current error sets notice/loadError, clears busy finally. No local canGoBack/Forward guard in listener.

**Definition:** [src/shared/keybindings/definitions-core-2.ts:271-271](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-2.ts:271). **Effect bodies:** [src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:30-100](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:30); [src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:106-250](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:106).

**Shared routing:** guest, browser; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **guest-history** (native event/router mocks): Guest back/forward sends corresponding renderer navigation IPC and prevents default. [src/main/browser/browser-guest-shortcut-forwarding.test.ts:548-571](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-shortcut-forwarding.test.ts:548)

**Remaining acceptance:** Assert forward separately at history endpoint, missing/destroyed guest, editable focus, repeat, staged/remote-token race and missing-page/error handling.

### browser.reload

**Eligibility:** Active local/remote page; DOM editable target yields; hard match tested before soft.

**Event:** Matched DOM prevents+stops; no universal no-repeat guarantee; guest forwarded IPC has page ownership.

**Effect:** Local ignoreCache=false: probe guest ID then call reload(); update load tracking/loading or recover missing guest. Remote both variants invoke browser.reload with worktree/page, no ignore-cache parameter.

**Branches:** Guest missing -> recovery; attached but not ready -> no reload and reset tracking; remote staged/missing/stale target no-op; remote failures notice/loadError or close missing page.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:6-6](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:6). **Effect bodies:** [src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:65-137](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:65); [src/renderer/src/components/browser-pane/navigate/use-browser-page-reload-actions.ts:35-80](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/navigate/use-browser-page-reload-actions.ts:35); [src/renderer/src/components/browser-pane/navigate/browser-reload-action.ts:44-69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/navigate/browser-reload-action.ts:44); [src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-chrome-chords.ts:30-117](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-chrome-chords.ts:30); [src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:106-175](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:106).

**Shared routing:** guest, browser; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **remote-reload** (rendered remote pane with RPC mocks): Soft and hard chords both call browser.reload, avoid guest key forwarding, and yield in editable address bar. [src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.chrome-chords.test.tsx:179-222](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.chrome-chords.test.tsx:179)

**Remaining acceptance:** Assert exact local reload method and recovery/not-ready race; verify remote soft equivalence explicitly, editable yielding, repeated chord and current-token error handling.

### browser.hardReload

**Eligibility:** Active local/remote page; DOM editable target yields; hard match tested before soft.

**Event:** Matched DOM prevents+stops; no universal no-repeat guarantee; guest forwarded IPC has page ownership.

**Effect:** Local ignoreCache=true: probe guest ID then call reloadIgnoringCache(); update load tracking/loading or recover missing guest. Remote both variants invoke browser.reload with worktree/page, no ignore-cache parameter.

**Branches:** Guest missing -> recovery; attached but not ready -> no reload and reset tracking; remote staged/missing/stale target no-op; remote failures notice/loadError or close missing page.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:14-14](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:14). **Effect bodies:** [src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:65-137](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/use-browser-page-webview-shortcuts.ts:65); [src/renderer/src/components/browser-pane/navigate/use-browser-page-reload-actions.ts:35-80](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/navigate/use-browser-page-reload-actions.ts:35); [src/renderer/src/components/browser-pane/navigate/browser-reload-action.ts:44-69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/navigate/browser-reload-action.ts:44); [src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-chrome-chords.ts:30-117](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-chrome-chords.ts:30); [src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:106-175](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/use-remote-browser-page-navigation.ts:106).

**Shared routing:** guest, browser; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **remote-reload** (rendered remote pane with RPC mocks): Soft and hard chords both call browser.reload, avoid guest key forwarding, and yield in editable address bar. [src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.chrome-chords.test.tsx:179-222](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.chrome-chords.test.tsx:179)

**Remaining acceptance:** Assert exact local reload method and recovery/not-ready race; verify remote soft equivalence explicitly, editable yielding, repeated chord and current-token error handling.

### browser.focusAddressBar

**Eligibility:** Active chrome scope, event target owned by page/workspace; explicit IPC checks active page.

**Event:** DOM prevent+stopImmediate avoids sibling pane focus; IPC no keyboard event.

**Effect:** Blur guest, focus input and select full value by default (optional selection restore path exists); return actual focus success.

**Branches:** Missing input returns false; inactive/foreign pane yields; asynchronous focus ownership must not steal from another pane.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:22-22](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:22). **Effect bodies:** [src/renderer/src/components/browser-pane/assemble-chrome/use-browser-page-chrome-focus.ts:57-88](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/assemble-chrome/use-browser-page-chrome-focus.ts:57); [src/renderer/src/components/browser-pane/assemble-chrome/use-browser-page-chrome-focus.ts:140-200](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/assemble-chrome/use-browser-page-chrome-focus.ts:140).

**Shared routing:** guest, browser; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **address-focus** (DOM component with guest mocks): IPC and Mac/Linux chords focus address input and select its full value; inactive pane does not steal focus. [src/renderer/src/components/browser-pane/assemble-chrome/use-browser-page-chrome-focus.test.tsx:329-384](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/assemble-chrome/use-browser-page-chrome-focus.test.tsx:329); [src/renderer/src/components/browser-pane/assemble-chrome/use-browser-page-chrome-focus.test.tsx:77-82](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/assemble-chrome/use-browser-page-chrome-focus.test.tsx:77)

**Remaining acceptance:** Assert exact focused element and selection0..length on all platforms, missing input, sibling pages and remote chrome sharing.

### browser.grabElement

**Eligibility:** Local active page DOM, noneditable and not markup; native guest first asynchronously rejects editable element or live text selection. Guest-forwarded path uses matching page ID.

**Event:** DOM match prevents; native async probe prevents only accepted intent; failure yields. No repeat guard in local handler.

**Effect:** startGrabIntent('copy') records feature, sets intent, clears pending copy annotation; idle/error or same intent toggles picker, different active intent only changes intent.

**Branches:** No immediate clipboard write: later element pick performs copy. Async probe failure/no renderer is no-op. Streamed browser does not implement element grab (markup is separate).

**Definition:** [src/shared/keybindings/definitions-core-3.ts:30-30](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:30). **Effect bodies:** [src/renderer/src/components/browser-pane/host-guest/use-browser-page-keyboard-shortcuts.ts:55-118](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/host-guest/use-browser-page-keyboard-shortcuts.ts:55); [src/main/browser/browser-guest-grab-shortcuts.ts:1-84](/Users/carlos/Documents/Drogon-mentu-session/src/main/browser/browser-guest-grab-shortcuts.ts:1); [src/renderer/src/components/browser-pane/annotate/use-browser-page-grab-annotations.ts:195-250](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/annotate/use-browser-page-grab-annotations.ts:195); [src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.tsx:306-339](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/browser-pane/stream-remote/remote-browser-page-pane.tsx:306).

**Shared routing:** guest, browser; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert actual picker state/intent transitions, text selection/editable/markup precedence, async stale/destroyed guest and no premature clipboard; explicitly test streamed unsupported route.

### editor.find

**Eligibility:** Mounted Monaco container, rich editor root, Markdown preview root, or PDF listener. Root containment varies; PDF listener has no explicit active-focus guard in cited body.

**Event:** Monaco find capture prevents+stops; repeat consumes without rerun. Rich/preview prevent+stop own-root match; PDF prevents+stops.

**Effect:** Monaco getAction(actions.find)?.run(); rich/preview set search open and focus/select input; PDF setFindOpen(true).

**Branches:** Missing Monaco action optional no-op; hidden/unowned rich/preview root yields; this opens search UI, does not replace text. PDF/native event ordering remains execution debt.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:38-38](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:38). **Effect bodies:** [src/renderer/src/components/editor/monaco-editor-input-bindings.ts:57-61](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/monaco-editor-input-bindings.ts:57); [src/renderer/src/components/editor/editor-shortcuts.ts:35-95](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-shortcuts.ts:35); [src/renderer/src/components/editor/useRichMarkdownSearch.ts:91-125](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useRichMarkdownSearch.ts:91); [src/renderer/src/components/editor/useRichMarkdownSearch.ts:300-345](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useRichMarkdownSearch.ts:300); [src/renderer/src/components/editor/use-markdown-preview-viewport.ts:230-275](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/use-markdown-preview-viewport.ts:230); [src/renderer/src/components/editor/PdfViewer.tsx:312-335](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/PdfViewer.tsx:312); [src/renderer/src/components/editor/editor-shortcuts.ts:130-139](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-shortcuts.ts:130); [src/renderer/src/components/editor/rich-markdown-key-handler.ts:95-106](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/rich-markdown-key-handler.ts:95).

**Shared routing:** editor; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **find-editor** (DOM listener and mocked callback): Platform/layout find consumes event and prevents downstream delivery; repeat consumes without a second callback. [src/renderer/src/components/editor/editor-shortcuts.test.ts:74-130](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-shortcuts.test.ts:74); [src/renderer/src/components/editor/editor-shortcuts.test.ts:186-204](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-shortcuts.test.ts:186)

**Remaining acceptance:** Assert each renderer variant search UI and focused sibling ownership, custom/unbound binding, repeat and Monaco action absence.

### editor.replace

**Eligibility:** Explicit registry consumer is rich Markdown search listener with editor-root containment.

**Event:** Matching rich editor chord prevents+stops; listener has no explicit repeat guard.

**Effect:** openReplace sets replaceMode=true and searchOpen=true or focuses/selects existing search input; no document replacement occurs until later UI command.

**Branches:** Read-only Markdown preview only installs find; Monaco binding installer explicitly installs save/find/review, not registry replace. Monaco library native replace keys may still exist but user override behavior is not established by this source; classify library branch unknown, not mapped by a label.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:46-46](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:46). **Effect bodies:** [src/renderer/src/components/editor/markdown-preview-search.ts:13-30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/markdown-preview-search.ts:13); [src/renderer/src/components/editor/useRichMarkdownSearch.ts:91-125](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useRichMarkdownSearch.ts:91); [src/renderer/src/components/editor/useRichMarkdownSearch.ts:300-345](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useRichMarkdownSearch.ts:300); [src/renderer/src/components/editor/monaco-editor-input-bindings.ts:36-90](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/monaco-editor-input-bindings.ts:36).

**Shared routing:** editor; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert rich replace UI mode/focus and no immediate text mutation; independently establish Monaco custom/unbound replace behavior and readonly preview policy.

### editor.save

**Eligibility:** Monaco/rich/notebook scoped save; fallback only noneditable/nonMonaco main/floating active editor target. Save target may resolve preview back to source.

**Event:** Monaco/notebook nonrepeat preventDefault+stopPropagation; workspace fallback nonrepeat only preventDefault (plus capture notification), no propagation stop. Rich save prevents default and returns true to ProseMirror with no repeat guard in helper.

**Effect:** Monaco live value; rich flush debounce and source-style serialization then onContentChange/onSave; notebook flush cell drafts. Panel untitled requests rename; normal save serializes per-file writes, checks owner/generation/readOnly, writes latest draft, reconciles newer draft dirty state and saved baseline/event.

**Branches:** Missing target/no draft/clean inactive fallback no-op; pending owner migration user-save errors; stale generation/readOnly suppress write; write failure clears self-write stamp and toast/false at attempt wrapper.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:59-59](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:59). **Effect bodies:** [src/renderer/src/components/editor/monaco-editor-input-bindings.ts:57-61](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/monaco-editor-input-bindings.ts:57); [src/renderer/src/components/editor/rich-markdown-save-shortcut.ts:1-31](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/rich-markdown-save-shortcut.ts:1); [src/renderer/src/components/editor/IpynbViewer.tsx:94-109](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/IpynbViewer.tsx:94); [src/renderer/src/components/terminal-workspace-editor-shortcuts.ts:1-48](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-editor-shortcuts.ts:1); [src/renderer/src/components/editor/useEditorCmdSaveRequest.ts:1-56](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useEditorCmdSaveRequest.ts:1); [src/renderer/src/components/editor/useEditorPanelSave.ts:1-39](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useEditorPanelSave.ts:1); [src/renderer/src/components/editor/editor-file-save-attempt.ts:1-20](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-file-save-attempt.ts:1); [src/renderer/src/components/editor/editor-save-queue.ts:60-150](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-save-queue.ts:60); [src/renderer/src/components/editor/rich-markdown-key-handler.ts:105-116](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/rich-markdown-key-handler.ts:105).

**Shared routing:** editor, workspace; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **save-fallback** (mocked event dispatch; not disk save): Save fallback emits exact normal/floating editor file ID; Tasks view emits no save event. [src/renderer/src/components/terminal-workspace-keydown.test.ts:75-104](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-keydown.test.ts:75)

**Remaining acceptance:** Assert actual latest bytes for all editor kinds, untitled rename/cancel, readonly/stale owner, concurrent newer draft, serialized failed prior save, and no local fallback to wrong owner.

### editor.markdownPreview

**Eligibility:** Markdown language/edit eligibility, valid file/path/worktree/mode, event inside panel and not already prevented.

**Event:** Matched preview chord prevents+stops; eligibility excludes diff despite intermediate diff-source calculation.

**Effect:** openMarkdownPreview derives markdown-preview::sourceFileId; reuse/update existing preview or append readonly markdown-preview file and workspace editor item, preserving source/runtime/group identity.

**Branches:** Not a toggle back to source; unsupported language/mode or missing provenance no-op.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:67-67](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:67). **Effect bodies:** [src/renderer/src/components/editor/useMarkdownPreviewShortcut.ts:1-92](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useMarkdownPreviewShortcut.ts:1); [src/renderer/src/store/slices/editor/actions/markdown-preview-actions.ts:84-200](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/editor/actions/markdown-preview-actions.ts:84).

**Shared routing:** editor; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **preview-eligible** (pure eligibility; no tab creation): Markdown edit is eligible; diff/unstaged variant is not. [src/renderer/src/components/editor/markdown-preview-controls.test.ts:69-83](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/markdown-preview-controls.test.ts:69)

**Remaining acceptance:** Assert opens dedicated preview/reuses ID, active group/runtime ownership, no duplicate or source mutation, nonMarkdown/diff yield.

### editor.toggleWordWrap

**Eligibility:** Nonrepeat, active editor type and activeFileId; inspects active file mode rather than focused pane.

**Event:** Matched workspace fallback prevents after selected editor target.

**Effect:** Diff -> updateSettings({diffWordWrap: !(current===true)}); otherwise updateSettings({editorWordWrap: !(current!==false)}). Different default booleans preserved.

**Branches:** Missing target no-op; fire-and-forget persistence has no local catch; actual currently focused sibling may differ from active store entity.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:75-75](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:75). **Effect bodies:** [src/renderer/src/components/terminal-workspace-editor-shortcuts.ts:45-67](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-workspace-editor-shortcuts.ts:45).

**Shared routing:** workspace; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert both undefined defaults, normal/diff branch and active-vs-focused split, persistence failure and renderer option consumption; retain O01/O02 unchanged.

### editor.copyContext

**Eligibility:** Mounted editor/model and live nonempty selection for actual copy.

**Event:** DOM capture match prevents+stops even empty selection; no repeat guard.

**Effect:** Format selected code with relative path/language context, await api.ui.writeClipboardText, then hide hint/store selection key/show copied feedback.

**Branches:** Empty selection/model -> false after consuming chord; async clipboard rejection is not caught in this handler; no copy-on-selection implied.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:84-84](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:84). **Effect bodies:** [src/renderer/src/components/editor/setup-contextual-copy.ts:155-220](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/setup-contextual-copy.ts:155); [src/renderer/src/components/editor/setup-contextual-copy.ts:252-335](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/setup-contextual-copy.ts:252); [src/renderer/src/components/editor/useContextualCopySetup.tsx:10-30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/useContextualCopySetup.tsx:10).

**Shared routing:** editor; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert exact formatter payload, empty consumed no-op, changing selection and clipboard failure without success feedback; current search-hit tests are not clipboard-action proof.

### editor.previousChange

**Eligibility:** Mounted Monaco diff-navigation shortcut listener.

**Event:** Prevent+stop matching chord; repeat consumed with no goToDiff; next matcher evaluated first.

**Effect:** editor.goToDiff('previous').

**Branches:** Disposed listener no effect; underlying Monaco diff availability/endpoint behavior belongs library runtime, not a fabricated cursor update.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:93-93](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:93). **Effect bodies:** [src/renderer/src/components/editor/editor-shortcuts.ts:54-80](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-shortcuts.ts:54); [src/renderer/src/components/editor/diff-navigation-context.tsx:50-80](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/diff-navigation-context.tsx:50).

**Shared routing:** editor; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **diff-nav** (mocked Monaco API): F7/Shift-F7 call goToDiff(next/previous); repeats consumed without navigation; custom binding and disposal checked. [src/renderer/src/components/editor/editor-shortcuts.test.ts:346-398](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-shortcuts.test.ts:346)

**Remaining acceptance:** Assert exact previous, customized/unbound keys, repeat and disposed listener, then real Monaco changed-hunk navigation/endpoints.

### editor.nextChange

**Eligibility:** Mounted Monaco diff-navigation shortcut listener.

**Event:** Prevent+stop matching chord; repeat consumed with no goToDiff; next matcher evaluated first.

**Effect:** editor.goToDiff('next').

**Branches:** Disposed listener no effect; underlying Monaco diff availability/endpoint behavior belongs library runtime, not a fabricated cursor update.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:102-102](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:102). **Effect bodies:** [src/renderer/src/components/editor/editor-shortcuts.ts:54-80](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-shortcuts.ts:54); [src/renderer/src/components/editor/diff-navigation-context.tsx:50-80](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/diff-navigation-context.tsx:50).

**Shared routing:** editor; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **diff-nav** (mocked Monaco API): F7/Shift-F7 call goToDiff(next/previous); repeats consumed without navigation; custom binding and disposal checked. [src/renderer/src/components/editor/editor-shortcuts.test.ts:346-398](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-shortcuts.test.ts:346)

**Remaining acceptance:** Assert exact next, customized/unbound keys, repeat and disposed listener, then real Monaco changed-hunk navigation/endpoints.

### editor.addReviewNote

**Eligibility:** Annotation prop/selection gate, not global markdownReviewToolsEnabled. Monaco reads current selection; rich uses live selection; preview requires root ownership and valid source block selection.

**Event:** Nonrepeat open consumes only true callback; mounted open-draft guard consumes repeats and preserves draft. Preview stale draft clears and repeat cannot open fresh.

**Effect:** Open existing selection annotation composer/popover with live range, set immediate ref then state to prevent same-tick duplicate draft; clear transient target where needed.

**Branches:** Invalid/collapsed/outside selection or disabled prop yields; existing valid draft is retained. No note persisted or sent by chord. Root owns O01 annotation-prop discrepancy review; unchanged here.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:111-111](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:111). **Effect bodies:** [src/renderer/src/components/editor/editor-shortcuts.ts:70-139](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-shortcuts.ts:70); [src/renderer/src/components/editor/monaco-editor-input-bindings.ts:62-88](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/monaco-editor-input-bindings.ts:62); [src/renderer/src/components/editor/rich-markdown-annotation-shortcut.ts:1-30](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/rich-markdown-annotation-shortcut.ts:1); [src/renderer/src/components/editor/markdown-preview-annotation-shortcut.ts:1-121](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/markdown-preview-annotation-shortcut.ts:1); [src/renderer/src/components/editor/use-markdown-preview-viewport.ts:256-282](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/use-markdown-preview-viewport.ts:256); [src/renderer/src/components/editor/rich-markdown-key-handler.ts:105-116](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/rich-markdown-key-handler.ts:105).

**Shared routing:** editor; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **review-editor** (DOM listener and mocked callback): True open callback consumes; false leaves chord unclaimed; repeat does not reopen; mounted draft guard consumes repeat. [src/renderer/src/components/editor/editor-shortcuts.test.ts:207-316](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/editor/editor-shortcuts.test.ts:207)

**Remaining acceptance:** Assert each Monaco/rich/preview selection range, prop-disabled, stale draft, repeat and same-tick event, and no persisted comment until submit.

### sourceControl.sendReviewNotes

**Eligibility:** Allowed reveal view and active workspace with at least one unsent comment (!sentAt).

**Event:** Only true menu-request helper consumes and notifies terminal capture.

**Effect:** Set right sidebar source-control/open and publish workspace-qualified send-menu request with incremented nonce and issuedAt.

**Branches:** Does not send notes/messages; absent active workspace or all sent returns false. Consumer must match workspace before clearing request.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:120-120](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:120). **Effect bodies:** [src/renderer/src/app-shell/use-global-keybindings.ts:248-254](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/app-shell/use-global-keybindings.ts:248); [src/renderer/src/store/slices/ui/ui-slice-agent-actions.ts:81-120](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/ui/ui-slice-agent-actions.ts:81).

**Shared routing:** global; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **review-menu** (store mutation with callback mocks): Unsent comments open source control and create nonce/issuedAt request; sent-only or missing workspace returns false; consume is workspace-qualified. [src/renderer/src/store/slices/ui-agent-send-target.test.ts:641-685](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/store/slices/ui-agent-send-target.test.ts:641)

**Remaining acceptance:** Assert exactly one menu request per eligible action, nonce monotonic, no auto-send and no stale workspace consumption.

### fileExplorer.undo

**Eligibility:** Explorer focus and corresponding history stack nonempty.

**Event:** Prevent when eligible; no stop or repeat guard; redo wins if both effective chords match.

**Effect:** Pop past operation, await its undo closure, push onto opposite stack only after success. Closures retain original owner guard/path/content and refresh parent; delete undo restores captured nonbinary bytes, redo deletes same path. Other recorded producers: rename reverses/replays executeOpenEditorPathMove(oldPath,newPath) and parent refresh; drag move reverses/replays source/destination and refreshes both directories; create-folder undo deletes recursively and redo creates directory; create-file undo deletes and redo creates empty file. Each asserts captured operation owner before the mutation.

**Branches:** Empty returns false. Rejection pops without restoring either stack and toasts at listener; no serialization lock in this stack module. History memory-only max50 on commit; new operation clears future; not OS Trash restore.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:140-140](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:140). **Effect bodies:** [src/renderer/src/components/right-sidebar/useFileExplorerKeys.ts:155-180](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileExplorerKeys.ts:155); [src/renderer/src/components/right-sidebar/fileExplorerUndoRedo.ts:1-56](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/fileExplorerUndoRedo.ts:1); [src/renderer/src/components/right-sidebar/useFileDeletion.ts:139-193](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileDeletion.ts:139); [src/renderer/src/lib/rename-file.ts:72-108](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/rename-file.ts:72); [src/renderer/src/components/right-sidebar/useFileExplorerMoveDrop.ts:56-100](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileExplorerMoveDrop.ts:56); [src/renderer/src/components/right-sidebar/useFileExplorerInlineInput.ts:130-209](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileExplorerInlineInput.ts:130).

**Shared routing:** explorer; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert undo success/failure stack membership, repeated overlapping calls,50-entry cap, owner-generation change and exact file bytes/path with disposable fixtures. Cover every producer (delete, rename, drag move, new file, new directory), not just one closure mock; created-file redo does not restore subsequent edited content.

### fileExplorer.redo

**Eligibility:** Explorer focus and corresponding history stack nonempty.

**Event:** Prevent when eligible; no stop or repeat guard; redo wins if both effective chords match.

**Effect:** Pop future operation, await its redo closure, push onto opposite stack only after success. Closures retain original owner guard/path/content and refresh parent; delete undo restores captured nonbinary bytes, redo deletes same path. Other recorded producers: rename reverses/replays executeOpenEditorPathMove(oldPath,newPath) and parent refresh; drag move reverses/replays source/destination and refreshes both directories; create-folder undo deletes recursively and redo creates directory; create-file undo deletes and redo creates empty file. Each asserts captured operation owner before the mutation.

**Branches:** Empty returns false. Rejection pops without restoring either stack and toasts at listener; no serialization lock in this stack module. History memory-only max50 on commit; new operation clears future; not OS Trash restore.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:148-148](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:148). **Effect bodies:** [src/renderer/src/components/right-sidebar/useFileExplorerKeys.ts:155-180](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileExplorerKeys.ts:155); [src/renderer/src/components/right-sidebar/fileExplorerUndoRedo.ts:1-56](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/fileExplorerUndoRedo.ts:1); [src/renderer/src/components/right-sidebar/useFileDeletion.ts:139-193](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileDeletion.ts:139); [src/renderer/src/lib/rename-file.ts:72-108](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/rename-file.ts:72); [src/renderer/src/components/right-sidebar/useFileExplorerMoveDrop.ts:56-100](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileExplorerMoveDrop.ts:56); [src/renderer/src/components/right-sidebar/useFileExplorerInlineInput.ts:130-209](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileExplorerInlineInput.ts:130).

**Shared routing:** explorer; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert redo success/failure stack membership, repeated overlapping calls,50-entry cap, owner-generation change and exact file bytes/path with disposable fixtures. Cover every producer (delete, rename, drag move, new file, new directory), not just one closure mock; created-file redo does not restore subsequent edited content.

### fileExplorer.copyPath

**Eligibility:** Explorer focus; prefer projected selected rows, else focused/selected node; requires at least one.

**Event:** Eligible branch prevents; relative branch wins if both match; no stop or repeat guard.

**Effect:** formatFileExplorerPathsForClipboard(nodes,absolute) then api.ui.writeClipboardText; newline ordering follows projected supplied rows.

**Branches:** No rows leaves event unclaimed; clipboard promise not awaited/caught here. Absolute and relative paths retain source owner/path semantics.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:160-160](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:160). **Effect bodies:** [src/renderer/src/components/right-sidebar/useFileExplorerKeys.ts:244-288](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileExplorerKeys.ts:244); [src/renderer/src/components/right-sidebar/file-explorer-selection.ts:1-176](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/file-explorer-selection.ts:1).

**Shared routing:** explorer; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **paths** (pure formatter; no clipboard or shortcut dispatch): Absolute and relative clipboard formatter returns newline-separated paths in supplied order. [src/renderer/src/components/right-sidebar/file-explorer-selection.test.ts:72-85](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/file-explorer-selection.test.ts:72)

**Remaining acceptance:** Assert absolute multi-selection order, focused fallback and empty no-op; actual disposable clipboard call/rejection and platform overrides.

### fileExplorer.copyRelativePath

**Eligibility:** Explorer focus; prefer projected selected rows, else focused/selected node; requires at least one.

**Event:** Eligible branch prevents; relative branch wins if both match; no stop or repeat guard.

**Effect:** formatFileExplorerPathsForClipboard(nodes,relative) then api.ui.writeClipboardText; newline ordering follows projected supplied rows.

**Branches:** No rows leaves event unclaimed; clipboard promise not awaited/caught here. Absolute and relative paths retain source owner/path semantics.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:172-172](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:172). **Effect bodies:** [src/renderer/src/components/right-sidebar/useFileExplorerKeys.ts:244-288](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileExplorerKeys.ts:244); [src/renderer/src/components/right-sidebar/file-explorer-selection.ts:1-176](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/file-explorer-selection.ts:1).

**Shared routing:** explorer; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **paths** (pure formatter; no clipboard or shortcut dispatch): Absolute and relative clipboard formatter returns newline-separated paths in supplied order. [src/renderer/src/components/right-sidebar/file-explorer-selection.test.ts:72-85](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/file-explorer-selection.test.ts:72)

**Remaining acceptance:** Assert relative multi-selection order, focused fallback and empty no-op; actual disposable clipboard call/rejection and platform overrides.

### fileExplorer.delete

**Eligibility:** Explorer focus and focused/selected node; multiple projected selection chosen only if >1. Per-path pending suppression; captured operation owner/generation.

**Event:** Prevents before request; repeats can request but per-path pending guard dedupes.

**Effect:** Single/batch root deletion: remote confirmation, dirty editor save then autosave quiesce, assert owner current, snapshot readable nonbinary file bytes, deleteRuntimePath(local fs IPC or files.delete RPC), record undo after success, close files, prune expanded dirs, refresh parent and clear only successfully deleted selection.

**Branches:** Cancel/save failure/stale owner abort; unresolved owner fails closed. Remote/unreadable/directory may lack undo. Main local delete preserves symlink, tries permanent WSL UNC deletion then OS Trash (ENOENT idempotent); SSH delegates permanent provider delete. Partial batch retains failed selection and errors toast.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:180-180](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:180). **Effect bodies:** [src/renderer/src/components/right-sidebar/useFileExplorerKeys.ts:219-240](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileExplorerKeys.ts:219); [src/renderer/src/components/right-sidebar/useFileDeletion.ts:61-343](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/right-sidebar/useFileDeletion.ts:61); [src/renderer/src/runtime/runtime-file-mutation-client.ts:144-171](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/runtime/runtime-file-mutation-client.ts:144); [src/main/ipc/filesystem/filesystem-write-handlers.ts:45-90](/Users/carlos/Documents/Drogon-mentu-session/src/main/ipc/filesystem/filesystem-write-handlers.ts:45).

**Shared routing:** explorer; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert local Trash/WSL/SSH/runtime distinctions, owner replacement during confirm/save, duplicate repeat, dirty-save rejection, partial batch/root dedup, symlink and only-success undo snapshot. Run only authorized disposable files.

### settings.search

**Eligibility:** Mounted Settings effects, unprevented matching event and present search input.

**Event:** Document bubble listener prevents default only when input exists; no stop or repeat guard.

**Effect:** input.focus(); input.select().

**Branches:** Missing input/already prevented event leaves chord alone; does not change query, navigate result or persist settings.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:193-193](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:193). **Effect bodies:** [src/renderer/src/components/settings/use-settings-page-effects.ts:138-157](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/settings/use-settings-page-effects.ts:138).

**Shared routing:** Action-specific listener above; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert focus/full selection, missing ref, already-prevented and repeat behavior with custom/unbound chords; no search-query mutation.

### terminal.copySelection

**Eligibility:** Active/first pane with selection; preview terminal has explicit native control-C fallback.

**Event:** Normal nonrepeat selected copy prevents+stopImmediate; empty leaves event unclaimed. Preview consumes selected repeats without repeated copy; non-Mac bare Ctrl+C empty passes to shell.

**Effect:** Write exact terminal selection to clipboard; default helper preserves selection; optional clear only after successful write.

**Branches:** Clipboard error swallowed by dispatch catch, selection retained. No selection no write; preview custom no-selection copy can be swallowed while bare native interrupt passes.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:201-201](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:201). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:78-94](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:78); [src/renderer/src/components/terminal-pane/terminal-selection-copy.ts:1-25](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-selection-copy.ts:1); [src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts:90-175](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts:90).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **terminal-copy** (clipboard mock; concrete helper body): Exact selected text written; empty selection skips; failure rejects preserving selection; optional clear happens only after success. [src/renderer/src/components/terminal-pane/terminal-selection-copy.test.ts:1-55](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-selection-copy.test.ts:1)

**Remaining acceptance:** Assert selected/empty/repeat platform cases and native interrupt ownership, clipboard failure and no unintended selection clear.

### terminal.selectAll

**Eligibility:** Active or first pane; preview xterm also supports.

**Event:** First selectAll arms native-only tracker and executes; first and repeated actions both preventDefault+stopImmediatePropagation, with repeat skipping selectAll work.

**Effect:** terminal.selectAll() on selected pane, not OS document selection.

**Branches:** No pane -> return without consumption. Non-Mac bare Ctrl+A remains shell input unless explicitly bound.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:213-213](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:213). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:65-77](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:65); [src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts:175-220](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts:175).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **terminal-select** (policy matcher only): Mac Mod+A and repeat selectAll; Linux/Windows Ctrl+Shift+A selects, bare Ctrl+A yields. [src/renderer/src/components/terminal-pane/terminal-shortcut-select-all.test.ts:1-36](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-select-all.test.ts:1)

**Remaining acceptance:** Assert full xterm selection and event propagation first/repeat/missing pane on all platforms; custom overrides and preview.

### terminal.paste

**Eligibility:** Owned terminal container excluding terminal search/native-chat editables; native clipboard event required in insecure web and Mac Edit-menu paths.

**Event:** Matched keyboard path generally prevent+stop and dedupe following native paste; required native event yields until paste handler. Unmatched native paste chord arms suppression timer. Preview Mac default paste defers to Edit menu.

**Effect:** Capture pane/PTY/transport/focus identity, read clipboard text/image via proper client/runtime path; build bounded host/client/platform paste plan, pasteTerminalText or chunked PTY write, record input and recover image atlas after success.

**Branches:** Missing manager/pane, changed identity/focus, duplicate event -> no write; oversized text/image errors or paste failure set terminal error; generic clipboard exception caught. No blind clipboard->current later pane fallback.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:225-225](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:225). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-pane-paste-listeners.ts:1-248](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-pane-paste-listeners.ts:1); [src/renderer/src/components/terminal-pane/terminal-pane-paste-execution.ts:1-150](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-pane-paste-execution.ts:1); [src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts:115-210](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts:115).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert exact bytes/bracketed/large/image paths with safe fixtures, owner/focus race, native-event dedup, insecure web clipboard and Mac menu with no duplicate shell submission.

### terminal.search

**Eligibility:** Owned normal terminal handler; preview deliberately swallows without search UI.

**Event:** Nonrepeat prevent+stop.

**Effect:** setSearchOpen(open=>!open).

**Branches:** Opens/closes pane search; query changes later. Preview has no search effect despite catalog binding.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:237-237](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:237). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:95-100](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:95).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **terminal-policy** (policy matcher only): Mac search, clear, close, vertical/horizontal split and next/previous pane produce exact typed actions. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38-69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38)

**Remaining acceptance:** Assert open/close, active pane and terminal-search shortcut conflict ordering, repeat and preview no-op.

### terminal.clear

**Eligibility:** Normal owned terminal; active/first pane optional after event consumed.

**Event:** Nonrepeat preventDefault+stopImmediatePropagation; preview consumes without clear.

**Effect:** Mark cleared leaf, clearTerminalScrollbackAndFollowOutput, clear remote terminal buffer or local api.pty.clearBuffer, persist layout.

**Branches:** No pane consumed no-op; this clears retained scrollback/buffer, not a process restart or shell clear command; preview unsupported.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:245-245](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:245). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:101-109](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:101); [src/renderer/src/components/terminal-pane/use-terminal-pane-layout-persistence.ts:125-138](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/use-terminal-pane-layout-persistence.ts:125).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **terminal-policy** (policy matcher only): Mac search, clear, close, vertical/horizontal split and next/previous pane produce exact typed actions. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38-69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38)

**Remaining acceptance:** Assert visible scrollback and saved buffer cleared on correct local/runtime PTY, no process restart, missing pane and remote failure.

### terminal.focusNextPane

**Eligibility:** Normal manager with >=2 panes; focused active pane repaired by outer listener.

**Event:** Nonrepeat preventDefault+stopImmediatePropagation once >=2; fewer panes leaves unclaimed; preview consumes no-op.

**Effect:** If expanded restore/refit/persist first; locate active pane in ordered panes, modulo index+(1), setActivePane(target,focus:true).

**Branches:** Active pane not in list becomes consumed no-op after possible unexpand; no single-pane focus effect; preview lacks manager.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:253-253](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:253). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:127-150](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:127).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **terminal-policy** (policy matcher only): Mac search, clear, close, vertical/horizontal split and next/previous pane produce exact typed actions. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38-69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38)

**Remaining acceptance:** Assert direction 1, wrapping, expanded restoration/persistence, single/zero and missing active pane, actual DOM/xterm focus.

### terminal.focusPreviousPane

**Eligibility:** Normal manager with >=2 panes; focused active pane repaired by outer listener.

**Event:** Nonrepeat preventDefault+stopImmediatePropagation once >=2; fewer panes leaves unclaimed; preview consumes no-op.

**Effect:** If expanded restore/refit/persist first; locate active pane in ordered panes, modulo index+(-1), setActivePane(target,focus:true).

**Branches:** Active pane not in list becomes consumed no-op after possible unexpand; no single-pane focus effect; preview lacks manager.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:261-261](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:261). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:127-150](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:127).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **terminal-policy** (policy matcher only): Mac search, clear, close, vertical/horizontal split and next/previous pane produce exact typed actions. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38-69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38)

**Remaining acceptance:** Assert direction -1, wrapping, expanded restoration/persistence, single/zero and missing active pane, actual DOM/xterm focus.

### terminal.equalizePaneSizes

**Eligibility:** Normal owned terminal; binding unassigned by default unless customized.

**Event:** Nonrepeat preventDefault+stopImmediatePropagation before expanded guard; preview consumes no-op.

**Effect:** If not expanded manager.equalizePaneSizes(), equalize DOM split sizes recursively, publish layout change only if changed; focus active/first pane.

**Branches:** Expanded -> consumed no-op; fewer than2 manager panes -> equalize no-op; already equal no layout callback. Preview unsupported.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:269-269](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:269). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:151-160](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:151); [src/renderer/src/lib/pane-manager/pane-manager-layout-sweeps.ts:25-42](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/pane-manager/pane-manager-layout-sweeps.ts:25).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **equalize-policy** (policy matcher only): Equalize unassigned is null; custom binding resolves equalizePaneSizes. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:435-450](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:435)

**Remaining acceptance:** Assert actual unequal DOM ratios become equal, changed-only callback/persistence, expanded/single cases and custom binding.

### terminal.expandPane

**Eligibility:** Normal manager >=2 panes and active/first target.

**Event:** Nonrepeat preventDefault+stopImmediatePropagation once multipane; single pane unclaimed; preview consumes no-op.

**Effect:** toggleExpandPane: restore if already expanded, else apply expanded DOM layout, focus target, refit and persist; retain prior layout for collapse.

**Branches:** Missing manager/target or apply failure restores/clears state; preview unsupported.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:277-277](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:277). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:161-170](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:161); [src/renderer/src/components/terminal-pane/expand-collapse.ts:170-223](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/expand-collapse.ts:170).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

**Assertions:** No action-specific assertion body associated in this review; not a claim that no test exists anywhere.

**Remaining acceptance:** Assert expanded DOM and persisted layout, second toggle restoration, single pane, apply failure and close/split interactions.

### terminal.setTitle

**Eligibility:** Normal terminal binding configured, optional active/first pane.

**Event:** Nonrepeat consume before optional pane; preview consumes no-op.

**Effect:** Start pane rename: cancel pending animation frame, increment rename session, reset completion flags, initialize value from current pane title or empty and set renaming pane.

**Branches:** No pane consumed no-op; does not immediately write title. Commit/escape is later UI action, not tab.rename.

**Definition:** [src/shared/keybindings/definitions-core-3.ts:285-285](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-3.ts:285). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:171-179](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:171); [src/renderer/src/components/terminal-pane/use-terminal-pane-title-state.ts:65-150](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/use-terminal-pane-title-state.ts:65).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **title-policy** (policy matcher only): Title actions unassigned are null; customized set/clear resolve; repeated set-title is null. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:451-487](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:451)

**Remaining acceptance:** Assert pane title editor/session, no immediate persisted title, stale scheduled focus cancellation and subsequent commit/cancel; preview no-op.

### terminal.clearPaneTitle

**Eligibility:** Normal terminal configured binding and truthy custom pane title to remove.

**Event:** Nonrepeat consumes before optional pane/title check; preview consumes no-op.

**Effect:** Delete pane title from state/ref, mark removed leaf title and persist layout.

**Branches:** Missing pane/no custom title consumed no-op; does not reset tab custom title or terminal process title; preview unsupported.

**Definition:** [src/shared/keybindings/definitions-core-4.ts:6-6](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-4.ts:6). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:180-188](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:180); [src/renderer/src/components/terminal-pane/use-terminal-pane-layout-persistence.ts:140-173](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/use-terminal-pane-layout-persistence.ts:140).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **title-policy** (policy matcher only): Title actions unassigned are null; customized set/clear resolve; repeated set-title is null. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:451-487](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:451)

**Remaining acceptance:** Assert correct leaf title removal/persistence/reload, no-title no-op, tab title untouched and preview consumed no-op.

### terminal.closePane

**Eligibility:** Normal owned terminal, optional pane; terminal-context tab.close aliases same action; preview swallowed.

**Event:** Nonrepeat preventDefault+stopImmediatePropagation before optional pane.

**Effect:** Sole pane calls onCloseTab. Multipane without PTY closes; with PTY probe/timeout controls confirmation. Execute closes web runtime terminal, clears pane caches/agent/error/PTY binding then manager teardown disposes pane, promotes sibling, refits, focuses replacement and publishes close/layout callbacks.

**Branches:** Timeout asks confirmation; cancel retains pane; skip-confirm may be persisted from dialog. Current source probe verdict !==live and catch execute close, including unverifiable; not evidence process exited and conflicts with rewrite liveness rule. No proof these conditions are safe to inherit unchanged.

**Definition:** [src/shared/keybindings/definitions-core-4.ts:14-14](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-4.ts:14). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:189-197](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:189); [src/renderer/src/components/terminal-pane/use-terminal-pane-close-actions.ts:45-225](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/use-terminal-pane-close-actions.ts:45); [src/renderer/src/lib/pane-manager/pane-split-close.ts:172-254](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/pane-manager/pane-split-close.ts:172).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **terminal-policy** (policy matcher only): Mac search, clear, close, vertical/horizontal split and next/previous pane produce exact typed actions. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38-69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38)

**Remaining acceptance:** Assert live/exited/unverifiable/rejection/timeout separately with zero real process kills; root decide source defect policy, then isolated real PTY tab/pane close, confirmation/cancel and retained remote owner.

### terminal.splitRight

**Eligibility:** Normal owned terminal with active/first pane; effective client-platform binding, not PTY host default.

**Event:** Nonrepeat preventDefault+stopImmediatePropagation; unexpand restores/refits/persists before split; preview consumes no-op.

**Effect:** splitTerminalPaneWithInheritedCwd(direction='vertical',source=getKeyboardSplitTelemetrySource() (keyboard or contextual_tour)): remote split request carries PTY/worktree/tab/leaf identity and handles without local split; local uses confirmed cached cwd or pending cwd promise. Manager creates pane/divider, wraps DOM split, sets active/focus, forwards cwd/pty spawn hints and publishes layout.

**Branches:** No target/parent/manager or remote handled branch creates no local pane; split return null no interaction recording; preview unsupported. Right means vertical divider, Down horizontal divider.

**Definition:** [src/shared/keybindings/definitions-core-4.ts:22-22](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-4.ts:22). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:198-223](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:198); [src/renderer/src/components/terminal-pane/terminal-pane-split-with-inherited-cwd.ts:1-57](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-pane-split-with-inherited-cwd.ts:1); [src/renderer/src/lib/pane-manager/pane-split-close.ts:52-158](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/pane-manager/pane-split-close.ts:52).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **terminal-policy** (policy matcher only): Mac search, clear, close, vertical/horizontal split and next/previous pane produce exact typed actions. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38-69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38)
- **split-policy** (policy matcher only): Non-Mac Ctrl+D yields; Ctrl+Shift+D splits vertically; Alt+Shift+D horizontally; Mac Alt+Shift+D yields. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:489-521](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:489)
- **split-effect** (remote/manager mocks): Remote split forwards PTY, direction, source and worktree/tab/leaf with no local manager call; local confirmed cached cwd passed to horizontal split. [src/renderer/src/components/terminal-pane/terminal-pane-split-with-inherited-cwd.test.ts:38-88](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-pane-split-with-inherited-cwd.test.ts:38)

**Remaining acceptance:** Assert vertical exact layout/new active pane, inherited cwd promise/cache, remote owner adoption/no double local creation, expanded restore and platform overrides.

### terminal.splitDown

**Eligibility:** Normal owned terminal with active/first pane; effective client-platform binding, not PTY host default.

**Event:** Nonrepeat preventDefault+stopImmediatePropagation; unexpand restores/refits/persists before split; preview consumes no-op.

**Effect:** splitTerminalPaneWithInheritedCwd(direction='horizontal',source=getKeyboardSplitTelemetrySource() (keyboard or contextual_tour)): remote split request carries PTY/worktree/tab/leaf identity and handles without local split; local uses confirmed cached cwd or pending cwd promise. Manager creates pane/divider, wraps DOM split, sets active/focus, forwards cwd/pty spawn hints and publishes layout.

**Branches:** No target/parent/manager or remote handled branch creates no local pane; split return null no interaction recording; preview unsupported. Right means vertical divider, Down horizontal divider.

**Definition:** [src/shared/keybindings/definitions-core-4.ts:34-34](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-4.ts:34). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:198-223](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-action-dispatch.ts:198); [src/renderer/src/components/terminal-pane/terminal-pane-split-with-inherited-cwd.ts:1-57](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-pane-split-with-inherited-cwd.ts:1); [src/renderer/src/lib/pane-manager/pane-split-close.ts:52-158](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/lib/pane-manager/pane-split-close.ts:52).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **terminal-policy** (policy matcher only): Mac search, clear, close, vertical/horizontal split and next/previous pane produce exact typed actions. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38-69](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:38)
- **split-policy** (policy matcher only): Non-Mac Ctrl+D yields; Ctrl+Shift+D splits vertically; Alt+Shift+D horizontally; Mac Alt+Shift+D yields. [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:489-521](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.test.ts:489)
- **split-effect** (remote/manager mocks): Remote split forwards PTY, direction, source and worktree/tab/leaf with no local manager call; local confirmed cached cwd passed to horizontal split. [src/renderer/src/components/terminal-pane/terminal-pane-split-with-inherited-cwd.test.ts:38-88](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-pane-split-with-inherited-cwd.test.ts:38)

**Remaining acceptance:** Assert horizontal exact layout/new active pane, inherited cwd promise/cache, remote owner adoption/no double local creation, expanded restore and platform overrides.

### terminal.switchInputSource

**Eligibility:** Explicit opt-in binding; terminal scope; client platform matcher including repeats.

**Event:** Arm native-only input suppression and stopImmediatePropagation; deliberately DO NOT preventDefault, allowing OS input source action. Preview returns false to xterm while retaining native default.

**Effect:** Suppress terminal byte delivery for bound native input-source gesture; actual selected OS input source is controlled by OS settings/layout, not hardcoded application mutation.

**Branches:** Unassigned returns null so ordinary space/control behavior continues; OS may have no corresponding configured action. No claim shortcut changes language merely from matched action.

**Definition:** [src/shared/keybindings/definitions-core-4.ts:46-46](/Users/carlos/Documents/Drogon-mentu-session/src/shared/keybindings/definitions-core-4.ts:46). **Effect bodies:** [src/renderer/src/components/terminal-pane/terminal-shortcut-policy.ts:70-115](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-shortcut-policy.ts:70); [src/renderer/src/components/terminal-pane/terminal-keyboard-event-handlers.ts:180-245](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/terminal-keyboard-event-handlers.ts:180); [src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts:185-224](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/dashboard-popout/preview-terminal-key-handler.ts:185).

**Shared routing:** terminal, preview-terminal; see JSON for exact shared source anchors. These do not replace the effect bodies.

- **input-source** (policy matcher only; not OS switching): Configured Shift+Space including repeat resolves native input-source; unassigned yields across platforms; alternate Ctrl+Space works. [src/renderer/src/components/terminal-pane/repro-8299-shift-space-input-source.test.ts:60-120](/Users/carlos/Documents/Drogon-mentu-session/src/renderer/src/components/terminal-pane/repro-8299-shift-space-input-source.test.ts:60)

**Remaining acceptance:** Assert no PTY bytes, no preventDefault, repeat/native suppression and companion control codes; on authorized platform fixture verify real OS layout switch without changing personal profile.

## Evidence integrity

Every source/test reference in JSON contains fileSha256 and rangeSha256 (original bytes, inclusive lines). Metadata is inherited only; per-action effects were reconciled manually. The builder validates exact88-ID equality, all referenced files/ranges and every assertion/family reference. Prior candidate artifact hashes are captured without modifying them. Rebuild with `python3 docs/migration/audit-closure/e2-settings/build-shortcut-action-followup.py`; the builder reads/hashes source text and writes only these two follow-up artifacts.
