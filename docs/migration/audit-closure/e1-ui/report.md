# E1 UI reconciliation — candidate remains open

Pinned source: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (read-only). Lead Task `task_671da369fc93`, Dispatch `ctx_2b1bbe519b1c`.

**Proposed disposition: open.** All 42 supplied card records and eight additional named IDs are linked below, including all 19 remaining-card invariants and the accepted 45 Bots/Mentu/Meetings states. This closes no accepted audit group: important semantic obligations remain beyond absent screenshots. No tests or app were executed.

Audit orientation remains approximately 60%, medium-low confidence, 7/12 accepted groups, delta 0. The next milestone is root review and allocation of the finite residual source blocks. The 24-hour target is flexible; no product/test-migration percentage is inferred from this mapping.

## Runtime and authority

Requested launch was gpt-6-astra/high. Live worker inspection proved Codex, ready/input_accepted, depth 1; reused-terminal launch metadata does not authenticate effective model. Root owns model provenance. Preamble omitted maxDepth/canDispatchSubWorkers; root message `msg_d03920a4b7d8` supplied max=1 and instructed no children until revalidation. No child was launched, no denial bypassed, and no child requires release.

## Completeness and precedence

- The 42-card union alone omits SHELL-001/003, TERM-003, SETTINGS-001/003, KEYS-002, DROGON-001 and CONN-004. All 50 named IDs are accounted for; this is an ID map, not 50 accepted capabilities.
- SETTINGS-001..035 is an ambiguous pane-range proposal, overlapping the explicit search/deep-link IDs. Preserve the fixed/dynamic pane topology through SETTINGS-000/E2; root must ratify unambiguous pane identities.
- ActivityPrototypePage is mounted by activeView in AppWorkspaceShell:78 and needs explicit ownership/reachability characterization. It is not silently removed because its name says Prototype.
- Coordinator state v3 and UI-C01–C11 supersede old delta-audit proof claims. All 42 source fingerprints in that accepted package match; its 45 states remain 19 Bots, 16 Mentu, 10 Meetings, with zero new execution receipts. Old Bot createResponsibility and meeting-mount enumeration gaps are explicitly superseded, not assigned again.
- A separate fresh read of mentu-session-request-coalescer.ts:15-105 resolves the two old unreviewed exports: caller-keyed in-flight promises, identity-checked deletion on either settlement; discovery maps API rejection to unavailable/null, load propagates its promise. No cancellation/subscriber isolation is implemented in that module. Consumer key and stale-response behavior still require their own tests.
- The manifest references 104 concrete source test files and reuses their existing work-package allocation. It is a cited-evidence manifest, not a repeat of M1 or a replacement for the full UI suite.

## Fresh reconciliation of all 14 remaining cards

### PUI-ONBOARD-001

Onboarding visibility is exactly non-null state with closedAt null. Completed and dismissed close paths write flowVersion, closedAt, outcome, lastCompletedStep and checklist.dismissed through onboarding.update; a close latch admits one close, resets on rejection and reports error. A successful completion schedules the star notice.

**Correction/limit:** No-reappearance depends on receiving persisted closedAt, not an unconditional promise that onboarding can never reopen. The existing persistence test checks notification settings and a scheduled callback with a mocked API, not a disk/app relaunch.

**Source:** `src/renderer/src/components/onboarding/should-show-onboarding.ts:1-7`; `src/renderer/src/components/onboarding/use-onboarding-flow-persistence.ts:71-129`; `src/renderer/src/app-shell/use-onboarding-and-feature-tips.ts:44-65`.

**Still required:** Preserve unchanged OnboardingFlow and persistence tests; characterize skip confirmation click through update and failed-close retry, then isolated disk restart for completed/dismissed outcomes. Keep explicit onboarding-reopen behavior; independently exercise step skipping, Windows terminal step and async preflight.

**Selected assertion bodies read, not run:** `src/renderer/src/components/onboarding/use-onboarding-flow-persistence.test.ts:119-165`.

### PUI-FEATURETIPS-001

Automatic tours require hydrated UI, eligibility, no onboarding/blocking surface/active tour, an unseen tour and an unused session allowance. Start chooses the required starting target, not a persisted arbitrary mid-step. Interaction persistence is awaited before requesting; source disable/unmount suppresses the active attached tour. Dismissal tests clear active tour and persist the tour ID as seen; stale dismissal of another tour does nothing.

**Correction/limit:** The earlier no-contextual-tour-tests claim is false: store, gate, overlay, control and hook tests exist. The verified persistence unit is a whole tour ID; an invented per-step durable-resume contract must not be ported as an unchanged expectation.

**Source:** `src/renderer/src/components/contextual-tours/use-contextual-tour.ts:44-52,127-175,183-249`; `src/renderer/src/components/contextual-tours/contextual-tour-gate.ts:73-84,127-169`.

**Still required:** Baseline and port complete contextual-tour/feature-tip suites from the existing M1 allocation, including overlay target visibility, cleanup and per-tip dialogs. Execute restart with whole-tour seen IDs, failed persistence, onboarding suppression and a missing/reappearing target; no mocked-store result is app restart evidence.

**Selected assertion bodies read, not run:** `src/renderer/src/store/slices/ui-contextual-tours.test.ts:122-139,495-542`; `src/main/persistence-ui-state.test.ts:359-401`.

### PUI-PLUGINCATALOG-001

Capability requests are strict objects with a closed kind enum; invalid manifests are rejected during install inspection. Rollback serializes mutation, requires one retained predecessor, validates key/safety-list/provenance/integrity, then publishes its immutable version and returns the consent fingerprint. Rollback/remove dialogs focus Cancel, block busy confirmation and pass the selected pluginKey; removal also removes stored plugin data.

**Correction/limit:** Rollback is source-backed and a real installer test reads its lock record; it is not proved merely by the dialog name. The test uses fixture Git and local temporary files, not a marketplace network or renderer consent journey.

**Source:** `src/shared/plugins/plugin-capabilities.ts:15-29`; `src/shared/plugins/plugin-manifest.ts:129-162`; `src/main/plugins/plugin-install-staging.ts:56-79`; `src/main/plugins/plugin-install.ts:195-285`; `src/renderer/src/components/settings/PluginRollbackDialog.tsx:15-68`; `src/renderer/src/components/settings/PluginRemoveDialog.tsx:15-65`.

**Still required:** Exercise malformed capability object/kind through preview/install and assert no publication; separately retain current consent/fingerprint tests. Rendered rollback/remove/consent flow; exact previous fingerprint re-consent, no/ambiguous predecessor, stale preview, integrity failure and interrupted publication.

**Selected assertion bodies read, not run:** `src/main/plugins/plugin-marketplace-installer.test.ts:144-197`.

### PUI-NOTIF-001

Probe is unsupported off macOS or without native support. Native authorized/denied readout is authoritative; pending authorization triggers only one probe even with force. With no readout, force bypasses cached session evidence, but joins a pending probe. A show/failed event updates observed evidence; timeout returns blocked non-authoritatively without recording failed. Mobile fanout precedes desktop-focus suppression and has independent cooldown.

**Correction/limit:** force:true is not a universal guarantee of corrected permission state. Existing notifications-permission-onboarding tests directly cover force/cache, pending authorization and timeout recovery; native permission remains an OS integration obligation.

**Source:** `src/main/ipc/notifications.ts:28-85,112-184`; `src/main/ipc/notification-permission-probe.ts:5-30,40-112`.

**Still required:** Run unchanged permission/onboarding and mobile-fanout cases, including failed-event then forced successful-event transition. Exercise NotificationsPane settings interactions, actual macOS permission changes, native banner/tray and mobile dismissal/focus behavior with isolated profiles.

**Selected assertion bodies read, not run:** `src/main/ipc/notifications-permission-onboarding.test.ts:102-229`.

### PUI-WEBMODE-001

installWebPreloadApi wraps a partial concrete API in a fallback proxy. Missing on* returns unsubscribe; is*/has*/pathExists resolve false; list*/detect* resolve []; preview* returns found:false; write/resize/reportGeometry return undefined; other methods resolve undefined. Bots explicitly reject desktop-only operations. stats.summary catches failure and returns zero counters/null firstEventAt.

**Correction/limit:** Both inherited universal claims are unsupported: not every desktop capability has an implemented web projection, and not every missing method produces a visible unavailable message. Preserve explicit rejection, synthetic/empty fallback and implemented runtime route as distinct source behaviors; this is not permission to remove required web functionality.

**Source:** `src/renderer/src/web/preload-api/web-fallback-api.ts:1-63`; `src/renderer/src/web/web-preload-api.ts:55-154`.

**Still required:** OPEN ENUMERATION: reconcile each concrete web factory and fallback caller against domain contracts and full web tests; root/E3 owns shared bridge linkage, E1 owns visible states. Run complete web-preload and runtime-client suites with the pinned config, then connected/disconnected/mixed-version web journeys; assert actual current fallback behavior, never invented blanket copy.

### PUI-PETS-001

Bundle import rejects invalid/oversized manifest, final manifest symlink, lexical absolute/escaping spritesheet paths, final spritesheet symlink and oversized/non-file/unsupported sheet. Limits are 64 KiB manifest and 64 MiB image; manifest length is checked again after reading. Copies stage to a fresh UUID sibling temporary directory then rename, removing temporary data on failure.

**Correction/limit:** This does not establish universal symlink confinement: O_NOFOLLOW protects the final open when supported, and the fallback copies on platforms without it; parent-component symlink races and cross-platform behavior still need characterization. Do not elevate the broad malicious-bundle expectation above the exact guards read.

**Source:** `src/main/ipc/pet-import-size-limits.ts:1-2`; `src/main/ipc/pet-symlink-safe-copy.ts:1-27`; `src/main/ipc/pet-bundle-import.ts:25-100`; `src/main/ipc/pet-bundle-spritesheet-source.ts:8-55`.

**Still required:** Preserve pet-bundle and pet-agent-state tests; add or locate path traversal, final/intermediate symlink, TOCTOU growth, 64 KiB/64 MiB boundary and partial-copy cleanup fixtures. Render agent-state animation, import/cancel/failure and persisted pet selection on supported OSes.

### PUI-STATS-001

StatsPane records usage-tracking and fetches stats on mount. Missing summary hides only summary area; both zero agent/PR totals show the first-agent empty message; otherwise three cards show agents, worked duration and PRs, with optional tracking date. Usage Analytics always remains and mounts only the selected Overview/Claude/Codex/OpenCode/Grok pane. stats:summary returns four collector aggregate fields.

**Correction/limit:** StatsPane is located at components/stats, not components/settings. The earlier import-isolation test is neither its behavior nor IPC round-trip coverage. A rejected web stats call synthesizes zeros (WEBMODE contract), so zero is not universally a successful measured result.

**Source:** `src/renderer/src/components/stats/StatsPane.tsx:21-218`; `src/main/ipc/stats.ts:1-8`; `src/main/stats/collector.ts:114-120`.

**Still required:** Characterize null/zero/nonzero summaries, duration/date formatting, provider switch mount cleanup and summary errors through the real store/IPC path. Port existing collector and usage-provider suites; actual provider availability, usage/error states, rendered layouts and restart remain.

### PUI-SPARSE-001

New/edit drafts trim names, reject blank/>80/case-insensitive collisions and parse directories. Save closes draft only on successful returned preset, retains errors and clears submitting while mounted. Delete first requests confirmation; successful removal clears matching draft/confirmation, rejection retains confirmation, and finally clears deleting ID. Repo IPC normalizes directories, retains existing ID/createdAt, changes preset storage and broadcasts sparsePresets:changed.

**Correction/limit:** Settings edits are preset mutations; the inspected handler does not run checkout mutations. This alone does not prove existing-worktree path consistency across other consumers or remote persistence. The prior assertion that one render-error test covers add/edit/delete is not accepted.

**Source:** `src/renderer/src/components/settings/SparsePresetSettingsSection.tsx:34-153,187-239`; `src/main/ipc/repos/sparse-preset-handlers.ts:8-90`.

**Still required:** Port full repo sparse and creation-time tests. Add rendered new/edit/delete success, false-return/rejection, unmount and confirmation-state cases. Verify settings edit versus existing-worktree snapshot and later creation application locally and on SSH; read indirect storage/subscription consumers before claiming no mutation outside this handler.

**Selected assertion bodies read, not run:** `src/main/ipc/repos-sparse-presets.test.ts:102-148`.

### PUI-QUICKCMD-001

Settings scopeSelection is a local view filter (null means sticky all); a single repo/global filter only seeds a new draft. Commands carry their own normalized global/repo scope. Host editors are fenced by available host and runtime connection generation; stale editors close. Menu receives already partitioned repo/global host entries and separately searches them. Host keys combine host ID and command ID; remote commands join local commands only for supported current generation.

**Correction/limit:** Do not equate the Settings list filter with a saved command scope or assume the menu owns host filtering. The shared repo-match test covers global/null and matching/nonmatching repo, not a full Settings-create-to-menu journey.

**Source:** `src/renderer/src/components/settings/QuickCommandsPane.tsx:49-84,90-198`; `src/renderer/src/components/tab-bar/TabBarQuickCommandsMenu.tsx:36-80`; `src/renderer/src/hooks/use-terminal-quick-command-hosts.ts:64-99,125-198`.

**Still required:** Trace partitioning consumer and render Settings-created global/repo commands in matching/nonmatching workspace, folder workspace and runtime-host contexts. Exercise unsupported/stale host loads, generation changes during edits, search, keyboard/IME, delete/run, exact saved scope and command IDs.

**Selected assertion bodies read, not run:** `src/shared/terminal-quick-commands.test.ts:249-286`.

### PUI-CONN-001

Startup partitions targets into passphrase-deferred, awaited eager and background; background targets are deferred before connecting and removed from deferred only on connected publication. Eager connection waits at most 15 seconds; timed-out IDs remain deferred for focus reattach. Non-timed-out eager targets poll getState for old/wrapped providers. Active workspace targets derive from repo connection plus tab/pending/split PTY IDs.

**Correction/limit:** These helpers publish connection state or report timeout/failure; they do not themselves emit live/unverifiable/exited process verdicts. Missing contact cannot be translated to exited. Startup and settings CRUD/passphrase/destructive actions remain distinct seams.

**Source:** `src/renderer/src/startup/ssh-startup-reconnect.ts:7-45`; `src/renderer/src/startup/startup-ssh-connection-restore.ts:5-128`; `src/renderer/src/startup/active-workspace-ssh-targets.ts:24-49`.

**Still required:** Run all three located startup suites and SshTargetForm unchanged; verify unresolved passphrase/destructive dialogs and settings CRUD-to-startup identity. Real SSH unavailable/late-connected/passphrase and mixed-version restore with host-owned liveness; assert tabs/workspaces retained without treating timeout as exit.

### PUI-CONN-002

Pair generation sends trimmed address, rotate:true and explicit reach intent; unavailable clears generated links and reports guidance. Grant/network loads discard stale/unmounted replies. Successful revoke removes matching grant and clears current generated link; already-revoked reloads grants. Host access form requires nonblank name and parsed link; loopback needs explicit tunnel override; busy disables submission. Grant rows distinguish current/unused/last-used and per-row revoking.

**Correction/limit:** Pair-link generation is not second-device attachment. UI copy about disconnecting immediately is not an observed transport result; actual verification/connection/save sequence and runtime grant enforcement remain integration work.

**Source:** `src/renderer/src/components/settings/RuntimePairingUrlGenerator.tsx:72-168,180-303`; `src/renderer/src/components/settings/RuntimeHostAccessForm.tsx:33-67,240-285`; `src/renderer/src/components/settings/RuntimeAccessGrantList.tsx:26-160`.

**Still required:** Port form/generator/status tests; exercise reach intent, stale loads, unavailable generation, copy/revoke failure and loopback gating. Read and test add-host verification/save controller, actual second-device pairing, identity mismatch, version skew, revocation/disconnect and active-host removal policy.

### PUI-KEYS-001

Keep KEYS-001 catalog and KEYS-002 UI as separate IDs. Recorder notifies main to suspend global dispatch and clears focus on cleanup. saveBindings normalizes/parses, validates available definition, checks conflicts, then chooses reset or override and surfaces rejection. Keybinding store awaits api.keybindings.setAction and applies returned snapshot; it does not persist via GlobalSettings.

**Correction/limit:** Reuse accepted M4 catalog counts; recount is not E1 closure. The current UI/backend snapshot path is source-characterized, while actual OS activation and watcher persistence remain E2/T4. Do not promise instantaneous effects before the async action returns.

**Source:** `src/renderer/src/components/settings/ShortcutsPane.tsx:44-100,159-221`; `src/renderer/src/store/slices/keybindings.ts:25-31,66-93`.

**Still required:** Port recorder/list/visibility/mutation tests and E2 dedicated keybinding persistence tests; cover reset/common override, duplicate conflict, removed plugin action and rejection. Actual macOS/Linux/Windows chords, recorder cleanup, terminal policy, generated agents/plugins and persisted file reload are execution obligations.

### PUI-FILEEXP-001

Name filtering is Files-view query state backed by runtime file list; oversized query disables loading, initial load has null paths, and clearing the filter resets query. Separate collapsed-path projection tests cover toggling and unrelated-path retention. Row action tests inspect visibility and mock clipboard/download calls, including remote host/SSH/web capability gates and error toasts.

**Correction/limit:** FileExplorerRow.actions is not a rendered row CRUD test. The 24-line projection test does not assert matching-node autoexpansion. Preserve rename/delete/reveal, virtualized tree/watch/drag and filter integration as exact remaining obligations rather than treating the Actions filename as coverage.

**Source:** `src/renderer/src/components/right-sidebar/use-file-explorer-name-filter.ts:24-86`.

**Still required:** OPEN ENUMERATION: read row CRUD/reveal callbacks and runtime mutation authority, tree projection/watch/drag source; characterize exact current behavior before adding assertions. Port complete existing row/projection tests; rendered filtering with autoexpanded matches, selection, rename/delete/reveal across local/SSH/runtime and failure/recovery.

**Selected assertion bodies read, not run:** `src/renderer/src/components/right-sidebar/file-explorer-name-filter-projection.test.ts:1-24`; `src/renderer/src/components/right-sidebar/FileExplorerRow.actions.test.tsx:49-236`.

### PUI-PORTS-001

Forward dialog distinguishes add/edit, defaults privileged remote ports to local port+10000, and uses saved targetId/entry ownership. Submit validates both ports 1..65535, sends add/updatePortForward, closes after success and reports EADDRINUSE/EACCES specially. Remove calls removePortForward by ID, swallows rejection and expects broadcast state; it does not optimistically remove a row.

**Correction/limit:** Add/remove cannot be described as one generic guaranteed list update. Dialog/default target binding and asynchronous broadcasts are separate contracts; remove failure is not currently an inline error contract. Scanner and panel tests must remain distinct.

**Source:** `src/renderer/src/components/right-sidebar/ssh-port-forward-dialog.tsx:13-32,49-85,159-215`; `src/renderer/src/components/right-sidebar/ssh-forwarded-port-row.tsx:13-39`; `src/renderer/src/components/network/AddressPicker.tsx:30-77`.

**Still required:** Run full scanner/panel/section tests; exercise add/edit/remove plus authoritative broadcasts, errors and target switch while dialog open. Read remaining AddressPicker/CustomAddressDialog validation and host scan consumers; real SSH tunnel/browser opening and stale scan retention, not scanner mocks alone.

## Complete card ledger

| ID | Evidence disposition | Input anchor |
| --- | --- | --- |
| PUI-SIDEBAR-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:43` |
| PUI-SETTINGS-000 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:95` |
| PUI-SETTINGS-002 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:132` |
| PUI-SHELL-002 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:179` |
| PUI-SIDEBAR-002 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:222` |
| PUI-TABS-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:270` |
| PUI-TERM-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:317` |
| PUI-TERM-002 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:386` |
| PUI-TERM-004 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:432` |
| PUI-TABS-002 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:479` |
| PUI-EDITOR-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:528` |
| PUI-SC-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:586` |
| PUI-SC-002 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:701` |
| PUI-PR-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:754` |
| PUI-BROWSER-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:869` |
| PUI-NATIVECHAT-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:933` |
| PUI-DASHBOARD-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:996` |
| PUI-AIVAULT-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:1048` |
| PUI-ACCOUNTS-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:1205` |
| PUI-SKILLS-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:1292` |
| PUI-ARTIFACTS-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:1353` |
| PUI-TASKS-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:1448` |
| PUI-AUTOMATIONS-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:1500` |
| PUI-BOTS-001 | accepted-bounded-Drogon-states-reused | `docs/migration/parity-ui-capability-cards.json:1578` |
| PUI-MENTU-001 | accepted-bounded-Drogon-states-reused | `docs/migration/parity-ui-capability-cards.json:1646` |
| PUI-MEETINGS-001 | accepted-bounded-Drogon-states-reused | `docs/migration/parity-ui-capability-cards.json:1734` |
| PUI-CONN-003 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:1783` |
| PUI-DIAG-001 | inherited-open-semantics-preserved | `docs/migration/parity-ui-capability-cards.json:1859` |
| PUI-ONBOARD-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:39` |
| PUI-FEATURETIPS-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:121` |
| PUI-PLUGINCATALOG-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:213` |
| PUI-NOTIF-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:322` |
| PUI-WEBMODE-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:422` |
| PUI-PETS-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:504` |
| PUI-STATS-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:595` |
| PUI-SPARSE-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:658` |
| PUI-QUICKCMD-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:736` |
| PUI-CONN-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:822` |
| PUI-CONN-002 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:891` |
| PUI-KEYS-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:962` |
| PUI-FILEEXP-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:1028` |
| PUI-PORTS-001 | fresh-bounded-source-reconciliation | `docs/migration/parity-ui-remaining-surface-cards.json:1098` |

Every card retains its original obligations, gaps, missing invariants, test paths, owner and rendered states in closure.json. Its 19-row remainingInvariantReconciliation maps each original obligation independently; fullUiTestAllocationReferences points to all existing UI package manifests without recensus. Inherited claims remain inherited until the fresh correction or accepted v3 contract specifically supersedes them. No blanket all-state closure is claimed.

## Supplemental IDs retained

- **PUI-SHELL-001** → PUI-SIDEBAR-001, E5. Local Windows AND Linux use custom 138px/36px controls; paired web clients do not. Mac traffic-light gutter is 80px. Correct original audit claim that Linux is not customized. Remaining: Root shell/inset/fullscreen/narrow window rendering and platform tests; not closed by chrome constants.
- **PUI-SHELL-003** → PUI-KEYS-001, PUI-KEYS-002, E2. Global dispatcher remains separate from catalog and editor. Remaining: Trace use-global-keybindings dispatcher to actions and OS/terminal policy; owned jointly with E2.
- **PUI-TERM-003** → PUI-QUICKCMD-001. Terminal command creation/editor/launch identity is retained separately from Settings filtering. Remaining: TerminalQuickCommandDialog and launch integration, persisted scope, appendEnter and host ownership.
- **PUI-SETTINGS-001** → PUI-SETTINGS-000, E2. Original 001..035 notation is a pane-range proposal, not 35 stable standalone cards; numeric IDs 002/003 already denote search/deep links. Remaining: Root must ratify pane-qualified identities preserving every fixed and dynamic pane; retain E2 214 fields and pane controls without inventing a new acceptance denominator.
- **PUI-SETTINGS-003** → PUI-SETTINGS-000, E2. Target watcher observes late child mounts, settles once, disconnects on cancel/success/5-second timeout, and no-ops without root/MutationObserver. Remaining: Port watcher tests; actual pane/repo/host/section/intent navigation and target scroll/focus across async mounts.
- **PUI-KEYS-002** → PUI-KEYS-001, E2. Separate shortcut-editor ID retained; source contract in KEYS-001 note does not merge catalog and UI acceptance. Remaining: Recorder, rows, reset/remove/disable, errors and actual key dispatch.
- **PUI-DROGON-001** → PUI-BOTS-001, PUI-MEETINGS-001. DrogonProductSectionPage is a bots/meetings placeholder component with close action; it is not a Bots/Meetings/Mentu parent-tab container. Current AppWorkspaceShell directly mounts BotsPage and MeetingsPage. Remaining: No import was found by bounded renderer-source name search; absence is not global/history reachability proof. Root decides archival classification; required implemented pages remain.
- **PUI-CONN-004** → PUI-TABS-001, PUI-SETTINGS-000, E2, E5. Windows/WSL shell settings, launch and CLI registration remain named obligations. Remaining: Coordinate settings selectors and Windows-shell launch/file setup with E2/E5; source names are not actual Windows acceptance.

## Source-enumeration debt versus execution debt

E1 stays open because web-domain semantics, inherited non-Drogon card gaps, supplemental identities/activity routing and the explicit remaining source seams still require characterization. Missing screenshot/runtime receipts alone are not reasons to call a known source behavior unenumerated.

All original journey sections are mapped in closure.json with line windows, card IDs and unchanged screenshot tokens. Preserve light/dark/narrow and OS/host variants; three prior light empty-state captures do not establish those journeys. Bot legacy test drift must retain unchanged baseline receipts alongside current minimal-form tests. Mentu mocks/record-derived liveness, meeting platform overrides and in-memory stores remain bounded evidence.

Execution proceeds only in coordinator-prepared isolated checkouts. closure.json supplies an exact pinned-config Vitest command for every cited file and future Playwright commands; candidate commands remain unassigned until real source-to-candidate ports exist. Native runtime preparation is a prerequisite, compile/setup errors are not RED, skips are not PASS, and the full M1/M7 suite remains mandatory.

## Artifact verification

`build-reconciliation.py` regenerates only this directory. It checks the 42-card set, all 50 named IDs, all 19 inherited remaining invariants, 45 accepted Drogon states and 42 matching fingerprints; closure.json contains full SHA-256, source reviewed ranges, document anchors, complete residual lists and execution limits. This is metadata validation, not product testing. Root independently reviews before changing central ledgers.
