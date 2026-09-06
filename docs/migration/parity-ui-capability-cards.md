# Parity UI capability cards — bounded taxonomy checkpoint (corrected, accuracy-audit follow-up)

**This is a bounded checkpoint across a fixed 19-surface taxonomy, not a claim of complete UI-audit closure.** It continues the work named as an open gap in `parity-work-packages.md` §4 ("Unread renderer domains ... parity-ui-audit.md §10, §13") but does NOT claim to close that gap — §5/§6 below name specific surfaces still open. Read-only on all product source: legacy reference `/Users/carlos/Documents/Drogon-mentu-session` frozen at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, including `out/`. No implementation, no UI interaction, no app/daemon starts, no test execution, no Git mutation. Machine companion: `docs/migration/parity-ui-capability-cards.json` (schema `drogon.parity-ui-capability-cards/1`, status `bounded-checkpoint-taxonomy-only`).

## 0. Correction note (accuracy audit, supersedes the prior gap-closure pass)

This is a bounded checkpoint across a fixed 19-surface TAXONOMY, not a claim of complete UI-audit closure — see §5/§6 of the companion .md for named remaining omissions. Corrects the prior revision of this same artifact (produced under task_4bbf433675d7): that revision (a) opened by overclaiming closure of the remaining UI map despite its own listed omissions, (b) used DEFER/DEFER-DECISION language for Source Control/PR/Accounts/AI Vault/Artifacts/Mentu — six capabilities that ARE existing, required-during-migration legacy behavior and were never actually in question, only their implementation strategy or verification depth was undecided, (c) made a global 'every assertion body verified' claim contradicted by its own mobile card admitting unread bodies, and (d) cited a sibling component's test (WorkspacePortScanner) as if it were CONFIRMED evidence for mobile pairing/emulator behavior, and cited TerminalSearch alone as evidence for the whole terminal liveness contract. All four are corrected in this revision: no card recommends DEFER/DEFER-DECISION; every originalTests entry carries an explicit evidenceTier ('path-existence-only' vs 'assertion-titles-read' vs 'executed', the last never used); the mobile card now cites NetworkInterfacePicker.test.tsx/mobile-page-stage.test.ts/use-emulator-pane-session.test.tsx directly, with exact lines; PUI-TERM-001 now cites pty-connection-session-liveness.test.ts/TerminalProcessExitOverlay.test.tsx directly, with exact lines. FURTHER CORRECTION (this pass, gap-closure follow-up): the 6 named focus cards (Source Control PUI-SC-001, Pull Request PUI-PR-001, Accounts PUI-ACCOUNTS-001, AI Vault PUI-AIVAULT-001, Artifacts PUI-ARTIFACTS-001, and Mentu PUI-MENTU-001's coalescing-semantics gap) were re-searched for real test bodies rather than left as bare proposals. 5 of the 6 (all but Mentu's coalescing layer specifically) now carry real, line-cited, assertion-title-verified test evidence and moved from cardStatus 'proposal-not-dispatchable' to 'grounded-partial' — this is EXPLICITLY NOT a claim of full capability closure: each card's new 'missingInvariants' field names the SPECIFIC obligations still uncovered (e.g. Source Control's stage/commit/sync actions, PR page's conversation/checks/reviewers/land-gate, Accounts' tab-scoping-across-a-switch, AI Vault's resume/session-identity routing, Mentu's request-coalescer) and the exact new test each one needs. Three WP allocations were corrected against parity-test-work-packages.json's actual per-file manifest rather than the prior guess (PR page WP-CAP-INT -> WP-UI-WORK; AI Vault renderer tests WP-UI-DASH -> WP-UI-WORK; Artifacts backing WP-ENG-RUNTIME -> WP-ENG-PLUGINS). PUI-SETTINGS-000 (the sixth prior proposal-not-dispatchable card) was intentionally left unchanged — it was not named in this pass's scope. FURTHER CORRECTION (this pass, accuracy audit before acceptance): fixed a stale methodology sentence ('six cards lack tests' vs. counts saying one). Corrected two false/overbroad negative claims caught in review: AI Vault resume/session-identity was claimed to have 'zero test coverage anywhere' after searching only main/ipc/'s own directory — a wider search of src/shared/, src/renderer/src/lib/, and mobile/src/session/ found 9 real test files (~2,260 lines) covering resume-command construction, shell-dialect handling, target/host-ownership matching, and cross-account repin safety; 5 are now cited. Mentu's request-coalescer was claimed unreferenced by any test's imports after grepping only for the literal string 'request-coalescer' in test files; tracing actual consumers found readRunRequestForScope is imported unmocked by use-mentu-session-evidence-restore.ts, itself exercised by mentu-evidence-restore.test.tsx's StrictMode assertion — now tagged assertion-body-inspected as real, if narrow (1 of 3 exports), coverage. Removed FIVE invented behavioral contracts asserted by analogy without reading source (an exactly-once stage/unstage click guarantee, a specific AI-generation-failure UX, a specific sync-conflict-summary UI requirement, a cross-component PR-page/checks-panel parity requirement, a universal required-check merge-gating rule, and a specific cross-account tab-scoping rule) across PUI-SC-001/PUI-PR-001/PUI-ACCOUNTS-001/PUI-MENTU-001 — each is now framed as PROPOSED-UNVERIFIED pointing at the real, unopened source file that would need to be read FIRST to characterize actual behavior, never asserting a new product requirement as if it were observed. Added an 'assertion-body-inspected' evidenceTier value, distinct from 'assertion-titles-read', for the few citations where the actual expect()/code inside a test body (not just its title) was read and is the basis for a claim. Mechanically verified all 210 line-anchored assertion citations against the frozen source this pass (a script re-opens every cited file and confirms the quoted title string appears at the claimed line, tolerant of a small offset): 209/210 matched exactly; 1 (PUI-DIAG-001) had a paraphrased title ('bundle preview file' vs. the source's actual 'review file') and a one-line off-by-one anchor, both corrected to the verbatim source. No card was expanded beyond correcting its existing content; PUI-SC-002 and all cards without a flagged issue are unchanged.

## 1. Methodology

Synthesizes the PUI-* capability IDs already established in parity-ui-audit.md and parity-ui-journeys.md into bounded, test-first cards. This document does NOT claim closure of the renderer UI surface — it is a bounded taxonomy checkpoint across 19 named surface categories (§ counts.requiredSurfacesCovered), not a complete UI audit; §5/§6 name specific omissions still open. THREE evidence tiers are used and never conflated: (1) 'path-existence-only' — a test file's path was confirmed to exist (find/ls against the frozen legacy checkout) but its body was not opened, so its assertion titles are NOT individually cited; (2) 'assertion-titles-read' — the file was opened (grep/Read) and specific describe/it title strings with their source line numbers are quoted verbatim as 'assertionsObserved'; this is inspection of source TEXT, not proof the assertion currently passes. (3) 'executed' — a test was actually run and observed to pass/fail. Tier (3) is NEVER used anywhere in this document: no test was executed, no app/daemon was launched, per this task's read-only scope. Every originalTests entry below carries an explicit 'evidenceTier' and 'executed' field; a bare filename appearing in a prior document, or an analogous/sibling test on a DIFFERENT component, was never substituted as evidence for the capability a card describes. WP allocation for each card's primary test-port path was resolved by looking up the card's own verified test file(s) in parity-test-work-packages.json's per-file manifest (not guessed from the package table's broad file-count rows). As of this pass, counts.cardsWithNoVerifiedTestFile cards (see that count, not a hardcoded number here) have zero verified test evidence; their 'cardStatus' is 'proposal-not-dispatchable' and their 'implementationStrategy' is 'implementation-strategy-undecided' — this is EXPLICITLY DISTINCT from deferring the underlying capability itself: every card in this checkpoint is existing legacy behavior required during migration (see 'migrationClass'), never a capability whose migration requirement is in question, only its implementation strategy or its verification depth. A FOURTH distinction within tier (2): 'assertion-titles-read' entries quote only the it()/describe() title string and its line, without necessarily opening the assertions inside that block; 'assertion-body-inspected' entries (a value of the same evidenceTier field) additionally quote or paraphrase the actual expect()/assertion code inside the test body, used only where a card's interpretation goes beyond what the bare title states. Absence of a dedicated test file, or absence of a matching filename/import in one targeted search, is NEVER treated as proof a behavior is untested anywhere in the repository — see the per-card notes for searches that were widened after an initial too-narrow negative claim was caught in review.

## 2. Counts (exact, derived directly from the JSON companion)

- `cardsTotal`: **28**
- `cardsWithAtLeastOneVerifiedTestFile`: **27**
- `cardsWithNoVerifiedTestFile`: **1**
- `cardsProposalNotDispatchable`: **1**
- `cardsGroundedPartial`: **27**
- `requiredSurfacesTotal`: **19**
- `requiredSurfacesCovered`: **19**
- `requiredSurfacesMissing`: **[]**
- `totalVerifiedTestFilesCitedAcrossCards`: **60**
- `testFileCitationsAssertionTitlesRead`: **57**
- `testFileCitationsPathExistenceOnly`: **1**
- `testFileCitationsExecuted`: **0**
- `extraVerifiedTestFilesNotYetCarded`: **5**
- `migrationClassLegacyRequired`: **28**
- `migrationClassOther`: **0**
- `implementationStrategyUndecided`: **3**
- `implementationStrategyReuse`: **11**
- `implementationStrategyRewrite`: **0**
- `implementationStrategyMixedOrPartial`: **14**
- `cardsWithMissingInvariantsRecorded`: **5**
- `totalMissingInvariantsRecorded`: **11**
- `testFileCitationsAssertionBodyInspected`: **2**

No percentage-complete figure is stated anywhere in this document. A `grounded-partial` card is NEVER a claim of full coverage — see each card's `missingInvariants` for obligations still uncovered, now explicitly marked `PROPOSED-UNVERIFIED` where no source was read to support them, distinct from obligations backed by a real, cited anchor.

## 3. Capability cards — index

One row per card. `Status` is `proposal-not-dispatchable` for cards with zero verified test evidence. `Impl. strategy` is never DEFER/DEFER-DECISION. `Missing invariants` counts named obligations still uncovered; each is tagged source-backed or proposed-unverified in §4, never asserted as an observed requirement without an anchor.

| ID | Surface | Title | Status | Test files | Missing invariants | WP (primary / backing) | Impl. strategy |
|---|---|---|---|---|---|---|---|
| `PUI-SIDEBAR-001` | navigation | Left sidebar workspace/worktree list + nav buttons | grounded-partial | 1 | 0 | `WP-UI-SHELL-NAV` | REUSE |
| `PUI-SETTINGS-000` | navigation | Settings nav taxonomy (35 fixed panes + dynamic per-repo + named intents) | proposal-not-dispatchable | 0 | 0 | `WP-UI-SETTINGS` / `WP-ENG-SHARED` | REUSE |
| `PUI-SETTINGS-002` | settings | Settings search (per-control keyword index, not per-pane) | grounded-partial | 1 | 0 | `WP-UI-SETTINGS` | REUSE |
| `PUI-SHELL-002` | workspace | Session persistence & shutdown checkpoint | grounded-partial | 1 | 0 | `WP-UI-CORE` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-SIDEBAR-002` | workspace | Workspace-space (disk usage) manager | grounded-partial | 1 | 0 | `WP-UI-SHELL-WIN` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-TABS-001` | workspace | Tab strip: create/close/drag/reorder/split entry menu | grounded-partial | 1 | 0 | `WP-UI-SHELL-WIN` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-TERM-001` | terminal | Terminal surface / xterm host + liveness contract | grounded-partial | 2 | 0 | `WP-UI-TERM` / `WP-ENG-DAEMON`, `WP-ENG-IPC` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-TERM-002` | terminal | Terminal search overlay | grounded-partial | 1 | 0 | `WP-UI-TERM` | REUSE |
| `PUI-TERM-004` | panes | Floating terminal (detach/resize/orchestration dialog) | grounded-partial | 1 | 0 | `WP-UI-SHELL-WIN` | REUSE |
| `PUI-TABS-002` | panes | Split/group layout (drag-to-split, pane focus) | grounded-partial | 1 | 0 | `WP-UI-SHELL-WIN` | REUSE |
| `PUI-EDITOR-001` | editor | Editor surfaces (source/diff/combined-diff/notebook/image/markdown) | grounded-partial | 2 | 0 | `WP-UI-EDITOR` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-SC-001` | review | Source control panel (stage/commit/AI-message/sync) | grounded-partial | 5 | 3 | `WP-UI-WORK` / `WP-ENG-GIT` | implementation-strategy-undecided |
| `PUI-SC-002` | checks | Checks panel (CI status + review comments + conflict summary) | grounded-partial | 1 | 0 | `WP-UI-WORK` / `WP-ENG-GIT`, `WP-CAP-INT` | REUSE |
| `PUI-PR-001` | review | Pull request page (conversation/checks/files/reviewers) | grounded-partial | 5 | 4 | `WP-UI-WORK` / `WP-ENG-GIT` | implementation-strategy-undecided |
| `PUI-BROWSER-001` | browser | Browser pane tab (URL classify / guest-view / trust boundary) | grounded-partial | 2 | 0 | `WP-UI-BROWSER` / `WP-ENG-BROWSER`, `WP-ENG-IPC` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-NATIVECHAT-001` | native-chat | Native chat portal (per-tab rendering mode, not a page) | grounded-partial | 2 | 0 | `WP-UI-NCHAT` / `WP-ENG-NCHAT` | REUSE |
| `PUI-DASHBOARD-001` | agents | Agent dashboard popout (live buckets, snapshot cache) | grounded-partial | 1 | 0 | `WP-UI-DASH` / `WP-ENG-IPC` | REUSE |
| `PUI-AIVAULT-001` | agents | AI Vault session panel (right-sidebar 'vault' tab) | grounded-partial | 9 | 1 | `WP-UI-WORK` / `WP-ENG-IPC`, `WP-ENG-SHARED`, `WP-CAP-MOBILE` | REUSE (verified: resume target/host-ownership m... |
| `PUI-ACCOUNTS-001` | agents | Branded per-provider account switchers (Claude/Codex/Grok) | grounded-partial | 3 | 2 | `WP-UI-CORE` / `WP-ENG-HARNESS` | implementation-strategy-undecided |
| `PUI-SKILLS-001` | skills | Skills page (cloud install / share / agent setup) | grounded-partial | 2 | 0 | `WP-UI-AUX` / `WP-ENG-PLUGINS` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-ARTIFACTS-001` | skills | Artifacts (create-intent + share-record, resumable publish) | grounded-partial | 4 | 0 | `WP-UI-AUX` / `WP-ENG-PLUGINS` | REUSE (verified: resumable create-intent persis... |
| `PUI-TASKS-001` | tasks | Task page (Jira/Linear/GitHub/GitLab providers) | grounded-partial | 1 | 0 | `WP-UI-CORE` / `WP-ENG-IPC` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-AUTOMATIONS-001` | automations | Automations (schedule/trigger, host-fenced dispatch) | grounded-partial | 3 | 0 | `WP-UI-AUTO` / `WP-CAP-AUTO`, `WP-ENG-RUNTIME` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-BOTS-001` | bots | Bots page (creation/character preset/responsibility scheduling) | grounded-partial | 2 | 0 | `WP-CAP-BOTS` / `WP-ENG-HARNESS`, `WP-ENG-IPC` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-MENTU-001` | mentu | Mentu panel & recipe workbench (DAG, retry-fold, evidence restore) | grounded-partial | 3 | 1 | `WP-CAP-MENTU` / `WP-ENG-IPC`, `WP-UI-CORE`, `WP-ENG-SHELL` | REUSE (verified: retry-ordering/graph-node UI c... |
| `PUI-MEETINGS-001` | meetings | Meetings page (transcript rows, capture availability, Q&A delegation) | grounded-partial | 1 | 0 | `WP-CAP-MEET` / `WP-ENG-SHELL` | REUSE |
| `PUI-CONN-003` | mobile | Mobile pairing & emulator (QR pair, screen stream, agent setup guide) | grounded-partial | 3 | 0 | `WP-CAP-MOBILE` / `WP-ENG-REMOTE`, `WP-CAP-DEVICE` | REUSE+REWRITE-split (see recommend detail) |
| `PUI-DIAG-001` | diagnostics | Diagnostics bundle (Settings→Privacy: collect/preview/upload/discard) | grounded-partial | 1 | 0 | `WP-UI-SETTINGS` / `WP-ENG-IPC`, `WP-CAP-DIAG` | REUSE |

## 4. Per-card detail

### PUI-SIDEBAR-001 — Left sidebar workspace/worktree list + nav buttons

- **Surface (taxonomy category):** navigation
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE
- **Entrypoint:** Left sidebar renders the worktree list plus per-feature nav buttons (Automations/Artifacts/Skills/Mobile/Tasks/Agent-Dashboard). Button visibility is per-button gated by distinct settings keys with THREE different default postures (verified, not assumed): Automations/Mobile default visible unless explicitly hidden; Skills/Artifacts default HIDDEN unless explicitly shown; Tasks is unconditional (no gate at all).
- **Source anchor:** `src/renderer/src/components/sidebar/SidebarNav.tsx:24,39-61,102-127,199,200-291 (button imports/visibility predicates); src/renderer/src/components/sidebar/ (worktree-list/ subtree: drag/, grouping/, listing/, navigation/, rows/, viewport/)`
- **State:** shouldShow{Automations,Skills,Artifacts,Mobile,AgentDashboard}Button predicates read distinct settings keys; worktree list is virtualized (own viewport module).
- **Action:** Add project (local-folder vs SSH-remote fork); click a nav button to switch activeView; right-click a nav button to hide it from the sidebar (writes back to settings).
- **Error:** An unreachable/misconfigured SSH host during Add-Project must surface an inline error, not a silent stall.
- **Recovery:** n/a for the list itself; see PUI-CONN-001 for SSH reconnect.
- **Backing handler(s):** `src/renderer/src/app-shell/AppWorkspaceShell.tsx (activeView switch + lazy page imports, e.g. :19-24,74-77)`
- **Original test path(s):**
  - `src/renderer/src/components/sidebar/SidebarNav.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - keeps the Agent Dashboard row unmounted while its experiment is off (line 221)
    - mounts the Agent Dashboard row only when its experiment is enabled (line 228)
    - shows the Mobile entry by default for older settings (line 268)
- **Screenshot states still needed:** `SHOT-SHELL-03 (narrow width collapse)`, `SHOT-ADD-01..04 (add-project local/remote fork + SSH validation error)`
- **WP allocation:** primary `WP-UI-SHELL-NAV`; test-port path `tests/parity/ports/WP-UI-SHELL-NAV/PUI-SIDEBAR-001/**`
- **Dependencies:** PUI-CONN-001 (SSH add-target validation)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - worktree-list drag/grouping/viewport module bodies not opened this pass
  - exact settings-key names for each show*Button predicate not individually enumerated beyond Automations/Skills/Artifacts/Mobile/AgentDashboard
- **Recommend:** REUSE

### PUI-SETTINGS-000 — Settings nav taxonomy (35 fixed panes + dynamic per-repo + named intents)

- **Surface (taxonomy category):** navigation
- **Card status:** `proposal-not-dispatchable`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE
- **Entrypoint:** Settings is not a fixed 35-pane list at runtime: 35 fixed panes + N dynamic per-repo panes (`repo` is special-cased) + 3 named deep-linkable intents (add-quick-command, add-remote-orca-server, add-ssh-host).
- **Source anchor:** `src/renderer/src/lib/settings-navigation-types.ts:15-51 (SETTINGS_NAV_TARGETS tuple, 35 ids), :53-57 (SETTINGS_NAV_INTENTS), :59-63 (named sub-target ids); src/renderer/src/components/settings/settings-navigation-foundations.ts:10-45 (8 groups), :59-68 (getSettingsSectionId per-repo resolution)`
- **State:** 35 static pane ids grouped into 8 named groups (capabilities/setup/workflows/interface/remote/security/advanced/experimental); `repo` resolves to one collapsed pane per project.
- **Action:** Navigate to a pane by id; deep-link to a named intent or a specific sub-target id.
- **Error:** n/a (pure navigation state).
- **Recovery:** n/a.
- **Original test path(s):** none verified this pass — this card's obligations are named hypotheses from source-file/prior-document evidence, not confirmed behavior. **Status: proposal-not-dispatchable.**
- **Screenshot states still needed:** `SHOT-SET-<pane>-01 (x35, one per nav target, light/dark)`
- **WP allocation:** primary `WP-UI-SETTINGS`, backing `WP-ENG-SHARED`; test-port path `tests/parity/ports/WP-UI-SETTINGS/PUI-SETTINGS-000/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - no dedicated test file found for settings-navigation-types.ts/settings-navigation-foundations.ts themselves this pass (searched src/renderer/src/lib and components/settings for *navigation*test* — none matched); the taxonomy is verified by direct Read of the constant/type definitions (per parity-ui-audit.md), not by a test
  - ~600 settings component files: only ~35 top-level *Pane.tsx confirmed present by name, per-control enumeration not attempted (largest named gap carried over from parity-ui-audit.md)
- **Recommend:** REUSE

### PUI-SETTINGS-002 — Settings search (per-control keyword index, not per-pane)

- **Surface (taxonomy category):** settings
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE
- **Entrypoint:** settings-search.ts + settings-search-keywords.ts plus ~30 per-pane *-search.ts files: each pane contributes its own searchable keyword entries per CONTROL, not per pane. Typing in Settings search filters/highlights matching controls across panes and groups; pane-title matches score above entry/description/keyword matches.
- **Source anchor:** `src/renderer/src/components/settings/settings-search.ts, settings-search-keywords.ts, {appearance,appearance-sidebar,...}-search.ts (~30 per-pane files)`
- **State:** search index built from per-control keyword entries across all 35 panes.
- **Action:** type a query in Settings search.
- **Error:** n/a.
- **Recovery:** n/a.
- **Original test path(s):**
  - `src/renderer/src/components/settings/settings-search.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - normalizes settings search text for callers that need local query state (line 14)
    - matches titles, descriptions, and keywords case-insensitively (line 18)
    - treats empty search as matching all entries (line 30)
    - scores pane title matches above entry, description, and keyword matches (line 34)
- **WP allocation:** primary `WP-UI-SETTINGS`; test-port path `tests/parity/ports/WP-UI-SETTINGS/PUI-SETTINGS-002/**`
- **Dependencies:** PUI-SETTINGS-000
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - ~30 per-pane *-search.ts keyword-entry files not individually opened
- **Recommend:** REUSE

### PUI-SHELL-002 — Session persistence & shutdown checkpoint

- **Surface (taxonomy category):** workspace
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** App quit/relaunch persists workspace/tab layout via a shutdown checkpoint; a dirty draft (e.g. uncommitted composer text) names itself as the specific reason a checkpoint snapshot build was blocked, rather than failing silently.
- **Source anchor:** `src/renderer/src/app-shell/shutdown-checkpoint-persist.ts; reconcile-hydrated-workspace-tab-models.ts; use-app-session-persistence.ts; use-app-startup-hydration.ts (all present, not opened this pass)`
- **State:** workspace/tab layout snapshot persisted at shutdown, hydrated at startup.
- **Action:** quit/relaunch restores prior layout without orphaned/duplicated tabs.
- **Error:** a corrupt/partial checkpoint must degrade to an empty/default session, never throw during boot — not verified this pass.
- **Recovery:** a later restart attempt abandons stale retry state independently; the checkpoint names the specific dirty-draft cause blocking a snapshot build (confirmed by test, not just claimed).
- **Original test path(s):**
  - `src/renderer/src/app-shell/shutdown-checkpoint-restart-lifecycle.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - abandons retry state when a later restart attempt is independently canceled (line 127)
    - names the snapshot-build cause when dirty drafts block the checkpoint (line 145)
- **WP allocation:** primary `WP-UI-CORE`; test-port path `tests/parity/ports/WP-UI-CORE/PUI-SHELL-002/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - corrupt-checkpoint degrade-to-default path not read this pass
- **Recommend:** REWRITE (persistence store against Rust core session state); REUSE reconciliation UI shape

### PUI-SIDEBAR-002 — Workspace-space (disk usage) manager

- **Surface (taxonomy category):** workspace
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** Disk-usage-by-worktree view reachable from the STATUS BAR (not the left sidebar itself, despite the name) — treemap, breakdown list, manager table/toolbar/overview, delete-selection.
- **Source anchor:** `src/renderer/src/components/workspace-space/WorkspaceSpacePage.tsx; src/renderer/src/components/status-bar/workspace-space-{treemap,status-badge,manager-table,delete-selection,decision-details}.tsx (~20 files)`
- **State:** public export path is a controller/view facade; every production module stays below its own physical line-limit budget (enforced by test, not convention alone).
- **Action:** open manager table; select entries for delete; trigger a bounded git refresh.
- **Error:** n/a beyond delete-selection safety.
- **Recovery:** normal / force / open-workspace action routing must stay distinct (verified by test name, not opened for full semantics).
- **Original test path(s):**
  - `src/renderer/src/components/status-bar/workspace-space-manager-source-boundary.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - keeps the public export path as a controller/view facade (line 33)
    - keeps every production module below its physical line limit (line 42, asserts on split('\n').length)
    - preserves bounded git refreshes and source-owned runtime routing (line 52)
    - preserves normal, force, and open-workspace action routing (line 67)
- **Screenshot states still needed:** `SHOT-WSPACE-01 (treemap)`, `SHOT-WSPACE-02 (manager table, delete-selection active)`
- **WP allocation:** primary `WP-UI-SHELL-WIN`; test-port path `tests/parity/ports/WP-UI-SHELL-WIN/PUI-SIDEBAR-002/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - disk-scan engine body not opened
- **Recommend:** REWRITE disk-scan engine in Rust; REUSE treemap/table presentation

### PUI-TABS-001 — Tab strip: create/close/drag/reorder/split entry menu

- **Surface (taxonomy category):** workspace
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** "+" button or keyboard shortcut opens a create-entry menu that classifies typed input as an explicit URL / host-scoped URL / local path / quick-command / agent launch; an invalid entry produces a typed `blocked-option('invalid-url', message)` rather than silently opening.
- **Source anchor:** `src/renderer/src/components/tab-bar/tab-create-entry-classifier.ts:5,14,33,39,62-64,188,206,231,239,241; components/tab-bar/ (158 files: tab-create-entry-*, TabBarQuickCommand*, windows-shell-launch.ts, tab-strip-drag-scroll.ts, RecentTabSwitcher.tsx)`
- **State:** classifier result union: {kind:'explicit-url'}|{kind:'host-url'}|blocked-option, matching the local-vs-remote-host fork seen elsewhere.
- **Action:** type input in create-entry field; drag to reorder; open per-tab-kind context menu; Windows-shell launch variant.
- **Error:** malformed URL or invalid path rejected inline via blocked-option before a tab is created.
- **Recovery:** mid-drag Escape restores original order — not verified this pass, named by file evidence only (middle-button-default-guard.ts, drop-indicator.ts).
- **Original test path(s):**
  - `src/renderer/src/components/tab-bar/tab-create-entry-classifier.test.ts` — evidence tier: **path-existence-only**, NOT executed this pass
    - 42 test cases across the classifier's URL/host-url/blocked-option branches (file confirmed 590 lines; exact per-case titles not individually transcribed this pass)
- **Screenshot states still needed:** `SHOT-TAB-01..05`
- **WP allocation:** primary `WP-UI-SHELL-WIN`; test-port path `tests/parity/ports/WP-UI-SHELL-WIN/PUI-TABS-001/**`
- **Dependencies:** PUI-BROWSER-001 (explicit-url/host-url branches feed a browser tab)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - mid-drag-cancel restore behavior not traced to source
  - recent-tab switcher and per-tab-kind row bodies not opened
- **Recommend:** REUSE strip/drag/menu UI; REWRITE process-launch and path-validation calls against the daemon

### PUI-TERM-001 — Terminal surface / xterm host + liveness contract

- **Surface (taxonomy category):** terminal
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** PTY output renders live via xterm; resize sends bounded geometry. Process exit must show a distinct end-state (not a blank pane); transport loss must project as `unverifiable`, never falsely `exited` — the same frozen AGENTS.md liveness contract already implemented for the native desktop work.
- **Source anchor:** `src/renderer/src/components/terminal-pane/ (own __fixtures__/, pty-connection/ subdir); components/{Terminal,TerminalSurface,TerminalSplitWorkspaceSurfaces,TerminalWorktreeSplitSurface,TerminalWorkbenchContainer}.tsx; 4 `TerminalLegacy*.tsx` files of unresolved relationship to the above (named gap, not investigated)`
- **State:** surface-id contract (terminal-workspace-surface-ids.test.ts) kept stable across the rewrite.
- **Action:** run a command; resize the pane; split the terminal.
- **Error:** process exit renders a distinct end-state overlay, not a blank pane.
- **Recovery:** transport loss projects as unverifiable, never falsely exited (this repo's own already-implemented native contract must be preserved on the legacy-equivalent surface, not merely matched by coincidence).
- **Backing handler(s):** `crates/drogond (native PTY backend, already implemented in this repo)`
- **Original test path(s):**
  - `src/renderer/src/components/terminal-pane/pty-connection-session-liveness.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - closes a split pane bound to a dead local session (same teardown as onExit) (line 176)
    - closes a split pane when targeted liveness says its local session is missing (line 202)
    - does not close when targeted liveness is live or unknown (line 230)
    - does not apply a stale targeted liveness result after reattach (line 250)
    - does NOT tear down a newborn pane when the snapshot was requested before it bound (line 279)
    - respects suppression: a suppressed dead session keeps the pane mounted (line 423)
    - preserves an owner-unverified restored pane after an empty reattach result (line 571)
    - preserves an owner-unverified restored pane after a rejected reattach (line 596)
  - `src/renderer/src/components/terminal-pane/TerminalProcessExitOverlay.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - explains the Git Bash limit and exposes recovery actions (line 10)
    - preserves the exit code for other shell failures (line 34)
- **Screenshot states still needed:** `SHOT-TERM-01..04`
- **WP allocation:** primary `WP-UI-TERM`, backing `WP-ENG-DAEMON`, `WP-ENG-IPC`; test-port path `tests/parity/ports/WP-UI-TERM/PUI-TERM-001/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - the 4 TerminalLegacy*.tsx files' relationship to the current surface not investigated
  - terminal-workspace-surface-ids.test.ts (surface-id stability) not individually re-opened this pass
  - pty-connection-session-liveness.test.ts's remaining ~40 cases (703 lines total) not all individually transcribed — the 8 titles above are a representative subset, not the full file
  - no test in this pass was EXECUTED — all evidence is assertion-title inspection of source text, not a passing test run
- **Recommend:** REUSE xterm rendering layer; REWRITE PTY backend in Rust (already underway)

### PUI-TERM-002 — Terminal search overlay

- **Surface (taxonomy category):** terminal
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE
- **Entrypoint:** In-terminal find with match highlight/navigation; the search addon must be torn down on query-clear, on pane switch, and on portal unmount (three distinct cleanup paths, each independently tested).
- **Source anchor:** `src/renderer/src/components/TerminalSearch.tsx`
- **State:** one search addon instance per active pane.
- **Action:** type a query; navigate matches.
- **Error:** n/a.
- **Recovery:** addon cleanup on query-erase / pane-switch / portal-unmount, each independently verified (see tests).
- **Original test path(s):**
  - `src/renderer/src/components/TerminalSearch.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - clears the current addon when the query is erased (line 34)
    - clears the previous addon when the search moves to another pane (line 49)
    - clears the addon when the search portal unmounts (line 72)
- **Screenshot states still needed:** `SHOT-TERM-03 (search overlay)`
- **WP allocation:** primary `WP-UI-TERM`; test-port path `tests/parity/ports/WP-UI-TERM/PUI-TERM-002/**`
- **Dependencies:** PUI-TERM-001
- **Remaining gaps (explicit work obligations, not implied-complete):**
- **Recommend:** REUSE

### PUI-TERM-004 — Floating terminal (detach/resize/orchestration dialog)

- **Surface (taxonomy category):** panes
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE
- **Entrypoint:** Floating panel detaches from the main window layout, remains resizable/movable; content (terminal or browser slot) persists across float/dock toggles; a dedicated orchestration dialog mode exists distinct from a plain detached terminal.
- **Source anchor:** `src/renderer/src/components/floating-terminal/ (64 files: FloatingTerminalOrchestrationDialog/Card.tsx, FloatingTerminalWindowControls.tsx, FloatingTerminalResizeHandles.tsx, FloatingBrowserSlot.tsx)`
- **State:** float/dock toggle preserves pane content identity.
- **Action:** toggle floating; resize; open orchestration dialog.
- **Error:** n/a.
- **Recovery:** n/a (not traced this pass).
- **Original test path(s):**
  - `src/renderer/src/components/floating-terminal/FloatingTerminalWindowControls.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - activates the new agent tab so the floating panel selects and focuses it (line 187)
- **Screenshot states still needed:** `SHOT-FLOAT-01..03`
- **WP allocation:** primary `WP-UI-SHELL-WIN`; test-port path `tests/parity/ports/WP-UI-SHELL-WIN/PUI-TERM-004/**`
- **Dependencies:** PUI-TERM-001, PUI-BROWSER-001 (FloatingBrowserSlot)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - the verified test covers only default-agent-launch-focus behavior; detach/resize/orchestration-dialog obligations stated above are named hypotheses from file/component-name evidence, NOT confirmed by the one test opened — the other 63 files (FloatingTerminalOrchestrationDialog/Card.tsx, FloatingTerminalResizeHandles.tsx, FloatingBrowserSlot.tsx) remain unopened
- **Recommend:** REUSE (proposed — only the agent-launch-focus path has direct test evidence; detach/resize/orchestration-dialog behavior is unverified)

### PUI-TABS-002 — Split/group layout (drag-to-split, pane focus)

- **Surface (taxonomy category):** panes
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE
- **Entrypoint:** Dragging a tab to a pane edge shows a split-target overlay; on drop, creates a new column/row split without losing dragged-tab state. An offscreen worktree group must never be marked focused; the visible worktree group's focus must be kept active.
- **Source anchor:** `src/renderer/src/components/tab-group/ (38 files: tab-drag-*.ts x9, tab-group-panel-split-target.ts, TabGroupSplitLayout.tsx, TabPaneColumnSplitDragOverlay.tsx)`
- **State:** split layout root wires to drag-cleanup ownership; floating explorer toggle reserves only top-right header space.
- **Action:** drag a tab to a pane edge; drop to split.
- **Error:** n/a.
- **Recovery:** n/a.
- **Original test path(s):**
  - `src/renderer/src/components/tab-group/TabGroupSplitLayout.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - does not mark an offscreen worktree group as focused (line 111)
    - keeps the visible worktree focused group active (line 125)
    - wires the split layout root to drag cleanup ownership (line 139)
    - only reserves top-right header space for the floating explorer toggle (line 150)
- **Screenshot states still needed:** `SHOT-SPLIT-01..03`
- **WP allocation:** primary `WP-UI-SHELL-WIN`; test-port path `tests/parity/ports/WP-UI-SHELL-WIN/PUI-TABS-002/**`
- **Dependencies:** PUI-TABS-001
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - 9-file drag-lifecycle cluster (gesture-lifecycle/pointer/hover-preview) not individually opened
- **Recommend:** REUSE verbatim (pure client-side layout state, no daemon dependency implied by file names)

### PUI-EDITOR-001 — Editor surfaces (source/diff/combined-diff/notebook/image/markdown)

- **Surface (taxonomy category):** editor
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** Opening a file renders syntax-highlighted source; a diff tab shows added/removed hunks with review controls; a combined multi-file diff review is its own substantial feature (6 sub-subtrees: browse-files/, load-sections/, remember-view/, resolve-changes/, review-controls/, scroll-viewport/); conflict markers surface in ConflictReviewFileTree; a file too large to diff falls back via LargeDiffFallback rather than hanging.
- **Source anchor:** `src/renderer/src/components/editor/ (593 files — largest single subtree after right-sidebar): ImageViewer.tsx, IpynbCellEditor.tsx, MermaidBlock.tsx, RichMarkdownEditorSurface.tsx, EditorAutosaveController.tsx, LargeDiffFallback.tsx, ConflictReviewFileTree.tsx, combined-diff/ subtree`
- **State:** large-diff fallback triggers on an intentionally huge diff fixture rather than hanging the UI.
- **Action:** open source/diff/combined-diff/conflict/notebook/image/markdown; save via the diff-viewer's save action.
- **Error:** an oversized diff must fall back, not hang.
- **Recovery:** a markdown round-trip (edit → serialize → re-parse) must be lossless for the tested constructs (verified by test, not assumed).
- **Original test path(s):**
  - `src/renderer/src/components/editor/diff-viewer-large-diff-save-action.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - does not offer save when the displayed large-diff content was pruned (line 5)
    - can save an intentionally empty draft when content is available (line 16)
  - `src/renderer/src/components/editor/markdown-round-trip.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - preserves inline html inside paragraphs (line 100)
    - preserves mdx-like inline tags (line 104)
    - preserves block html and comments (line 108)
    - preserves editable details blocks (line 113)
    - does not double-escape entities in editable details summaries (line 119)
- **Screenshot states still needed:** `SHOT-EDIT-01..07`
- **WP allocation:** primary `WP-UI-EDITOR`; test-port path `tests/parity/ports/WP-UI-EDITOR/PUI-EDITOR-001/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - 593 files, only ~14 top-level filenames observed; combined-diff/ 6 sub-subtrees not opened; exact assertion titles in the two verified test files not individually transcribed
- **Recommend:** REUSE Monaco-based rendering layer (lib/monaco-languages/textmate-grammars/ confirmed); REWRITE file I/O against Rust core

### PUI-SC-001 — Source control panel (stage/commit/AI-message/sync)

- **Surface (taxonomy category):** review
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** implementation-strategy-undecided
- **Entrypoint:** Stage/unstage, commit with message (AI-assisted commit-message generation implied by ai/ subtree + CommitMessageAiPane.tsx), push/pull/sync. Deeper than the prior inventory's flat SourceControl.tsx:1-62 anchor implied — a full sub-subtree (ai/, commit/, listing/, notes/, panel/, review/, sync/).
- **Source anchor:** `src/renderer/src/components/right-sidebar/source-control/ (ai/, commit/, listing/, notes/, panel/, review/, sync/ sub-subdirectories; top-level SourceControl.tsx also present)`
- **State:** staged/unstaged file-list PROJECTION integrity is CONFIRMED by test (stable sort across filter changes, no mutation of the store-owned array, correct list-vs-tree mode gating); the underlying stage/unstage ACTIONS themselves are not exercised by any test found this pass — see missingInvariants.
- **Action:** stage a file; commit with AI-suggested message; push/pull/sync.
- **Error:** PROPOSED-UNVERIFIED: pull-policy-error-notice.tsx/recovery-notice.tsx (commit/) are the real source files for this concern; neither was opened this pass, so no specific error-surface behavior is asserted as observed.
- **Recovery:** PROPOSED-UNVERIFIED for sync/push/pull specifically — no source file in source-control/sync/ was opened this pass, and no test exists there (21 files, 0 tests, confirmed by directory listing). A hosted-review 'suppressed PR' tombstone recovery IS confirmed by test (only clears once cache/eligibility evidence actually matches the tombstone, never on a bare timeout) — a different, narrower, ALREADY-VERIFIED recovery path than git-sync-conflict; the two must not be conflated.
- **Original test path(s):**
  - `src/renderer/src/components/right-sidebar/source-control/listing/use-file-projection-work.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - sorts committed branch entries once across many filter changes (line 185)
    - produces the same order as the previous filter-then-sort for every filter (line 204)
    - matches filter-then-sort under a comparator that is not a total order (line 228)
    - does not mutate the store-owned branch entry array (line 246)
    - builds no tree projection in list mode (line 263)
    - builds no list projection in tree mode (line 280)
    - has the other mode fully projected on the first render after a switch (line 294)
  - `src/renderer/src/components/right-sidebar/source-control/listing/use-store-actions.store-subscriptions.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - keeps only the two generation-record maps subscribed (line 50)
    - returns the same object across an unrelated store write and re-render (line 67)
    - hands back the live store action references (line 127)
    - never reassigns a store action, which is what makes getState() safe here (line 147)
  - `src/renderer/src/components/right-sidebar/source-control/review/use-hosted-review-state.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - hides a matching suppressed PR and blocks duplicate creation (line 47)
    - shows a different detected PR and lets an explicit link win (line 60)
    - preserves non-GitHub reviews (line 65)
  - `src/renderer/src/components/right-sidebar/source-control/review/use-action-model.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - preserves normal no-PR Create PR behavior (line 61)
  - `src/renderer/src/components/right-sidebar/source-control/review/suppressed-github-pr.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - shows recovery only after cache or eligibility evidence matches the tombstone (line 61)
    - suppresses transient Create PR chrome only while the marker is unresolved (line 77)
    - returns to normal chrome after stale, different, unavailable, or failed evidence (line 84)
    - does not apply GitHub recovery to folders, other providers, or invalid markers (line 103)
- **Missing invariants (obligation not yet covered by any test found; capability remains mandatory):**
  - **Obligation:** action (stage/unstage)
    - **Invariant:** PROPOSED-UNVERIFIED (not an observed contract): this pass did not read the actual stage/unstage handler, so no specific click/idempotency behavior is asserted. Real source exists to characterize first: source-control/panel/use-panel-model.ts and use-panel-state.ts (component_gates.ts also present in commit/) implement the panel's action wiring; neither was opened this pass.
    - **Required new test:** Before writing a new test, first READ use-panel-model.ts/use-panel-state.ts to characterize the actual current stage/unstage behavior (including whatever idempotency or lack thereof already exists), then write a test that pins that observed behavior — do not assume a specific click-guarantee a priori.
  - **Obligation:** action (commit with AI-suggested message)
    - **Invariant:** PROPOSED-UNVERIFIED (not an observed contract): the prior text asserted a specific failure-UX ('without silently falling back to an empty message on a failed probe') that was not read from source. Real source exists: use-commit-message-generation.ts (310 lines) and commit-failure-summary.ts are the actual generation/failure-surface files; neither was opened this pass.
    - **Required new test:** Before writing a new test, first READ use-commit-message-generation.ts and commit-failure-summary.ts to characterize the actual current failure behavior, then write a test pinning that observed behavior — do not assume 'silently falls back to empty' or any other specific failure mode without reading the code.
  - **Obligation:** recovery (sync conflict summary)
    - **Invariant:** PROPOSED-UNVERIFIED (not an observed contract): the prior text asserted a specific UI requirement ('explicit conflict-summary state, never silent overwrite') without reading source. Real source exists: pull-policy-error-notice.tsx (154 lines) and recovery-notice.tsx (348 lines) in commit/ are the actual conflict/error-surface components; neither was opened this pass, and source-control/sync/ (21 files) has zero test files.
    - **Required new test:** Before writing a new test, first READ pull-policy-error-notice.tsx and recovery-notice.tsx to characterize what the current conflict/error UI actually shows, then write a test pinning that observed behavior — do not assume a 'conflict-summary state' framing not found in source.
- **Screenshot states still needed:** `SHOT-SC-01..03`
- **WP allocation:** primary `WP-UI-WORK`, backing `WP-ENG-GIT`; test-port path `tests/parity/ports/WP-UI-WORK/PUI-SC-001/**`
- **Dependencies:** PUI-SC-002 (checks/review share the right-sidebar)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - Searched all 7 source-control/ sub-subdirectories this pass: only listing/ (36 files) and review/ (35 files) contain any .test.* file; ai/ (10), commit/ (22), notes/ (7), panel/ (20), sync/ (21) have ZERO test files — confirmed by directory listing, not inferred from filenames.
  - CORRECTED this pass: the three missingInvariants previously asserted specific behavioral contracts (an exactly-once-per-click stage guarantee, a specific AI-generation-failure UX, a specific conflict-summary-state UI requirement) that were never read from source — invented by analogy to how such features 'should' work, not observed. Replaced with proposed-unverified framing pointing at the REAL source files that implement each concern (use-panel-model.ts/use-panel-state.ts for stage/unstage; use-commit-message-generation.ts/commit-failure-summary.ts for AI generation; pull-policy-error-notice.tsx/recovery-notice.tsx for sync/conflict), none of which were opened this pass. A new test must first characterize what these files actually do, not enforce a new product requirement.
- **Recommend:** EXISTING BEHAVIOR REQUIRED DURING MIGRATION (not deferred, not new scope). File-list projection and hosted-review suppressed-PR recovery are REUSE-grade verified; stage/commit/sync implementation strategy is undecided and their real source files (named above) were not opened this pass — any new test must first characterize existing behavior from those files, not assert an invented contract.

### PUI-SC-002 — Checks panel (CI status + review comments + conflict summary)

- **Surface (taxonomy category):** checks
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE
- **Entrypoint:** CI run status pips populate; comments/resolution round-trip. Polling backoff on persistent failure IS a real, tested behavior (resolves the prior audit's open "gap: not verified"): repeated-empty polling backs off at 30s, then 60s, then 120s. A GitLab review client exists alongside the GitHub path, selected without calling the GitHub provider.
- **Source anchor:** `src/renderer/src/components/right-sidebar/checks-panel/ (40+ files: gitlab-review-client.ts, use-checks-panel-{polling,manual-refresh,create-review,generation,git-status-effects,check-and-review-actions}.ts)`
- **State:** polling installation gated by panel visibility; active poller cleaned on hide.
- **Action:** open checks panel; view CI status; open comment thread; force refresh.
- **Error:** a replacement MR's relink scope-change in flight must drop the now-stale replacement-MR details rather than mixing them with the new scope.
- **Recovery:** repeated-empty backoff (30s/60s/120s) prevents spin on a persistent failure — CONFIRMED by test, correcting the prior audit's "not verified" gap.
- **Original test path(s):**
  - `src/renderer/src/components/right-sidebar/checks-panel/use-checks-panel-polling.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - gates installation by panel visibility and cleans the active poller (line 84)
    - preserves live repeated-empty backoff at 30, 60, then 120 seconds (line 100)
    - selects the GitLab adapter without calling the GitHub checks provider (line 115)
    - uses an explicit owner and missing head override for a replacement MR (line 131)
    - drops replacement MR details when the relink scope changes in flight (line 170)
- **Screenshot states still needed:** `SHOT-CHECKS-01..03`
- **WP allocation:** primary `WP-UI-WORK`, backing `WP-ENG-GIT`, `WP-CAP-INT`; test-port path `tests/parity/ports/WP-UI-WORK/PUI-SC-002/**`
- **Dependencies:** PUI-SC-001
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - AI acknowledgement/queue hook cluster and branch-actions/create-review bodies not opened beyond the polling test file
- **Recommend:** REUSE

### PUI-PR-001 — Pull request page (conversation/checks/files/reviewers)

- **Surface (taxonomy category):** review
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** implementation-strategy-undecided
- **Entrypoint:** Dedicated PR review surface distinct from the checks panel, with actions/, cache/, checks/, comments/, conversation/, edit/, files/, mentions/, page/, presentation/, reviewers/ sub-subtrees.
- **Source anchor:** `src/renderer/src/components/pull-request-page/ (54 files across 11 sub-subtrees, per parity-ui-audit.md §10; no individual top-level filenames were listed in the prior audit and none were opened this pass)`
- **State:** file-content cache eviction/re-request, combined-diff section-index map identity, @mention query parsing, and state-badge color mapping are all CONFIRMED by test — but these are peripheral/presentation concerns, not the page's core review surface.
- **Action:** PROPOSED-UNVERIFIED for conversation/reviewers/edit actions — no source file in those 3 sub-subtrees was opened this pass.
- **Error:** PROPOSED-UNVERIFIED — not traced this pass.
- **Recovery:** PROPOSED-UNVERIFIED — not traced this pass.
- **Original test path(s):**
  - `src/renderer/src/components/pull-request-page/cache/file-content.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - starts a new request after a pending request is evicted (line 39)
  - `src/renderer/src/components/pull-request-page/files/combined-diff-section-index.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - keeps one map identity across on-demand section loads (line 96)
  - `src/renderer/src/components/pull-request-page/mentions/options.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - includes the item author, commenters, participants, and assignable users (line 21)
    - skips ghost and fills missing avatar/name on a later case-insensitive duplicate login (line 40)
  - `src/renderer/src/components/pull-request-page/mentions/query.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - returns the @query immediately before the caret (line 5)
    - returns an empty query when the caret is right after @ (line 9)
    - returns null when there is no mention token at the caret (line 13)
    - allows a mention after punctuation that starts a token (line 19)
    - reads only the text before the caret (line 23)
  - `src/renderer/src/components/pull-request-page/presentation/state-badge.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - uses purple/slate/rose/emerald for pull request states (line 10)
    - uses rose for a closed issue and emerald otherwise (line 17, 31)
    - matches the outlined tone hues for every pull request state (line 24)
- **Missing invariants (obligation not yet covered by any test found; capability remains mandatory):**
  - **Obligation:** state/action (conversation thread)
    - **Invariant:** PROPOSED-UNVERIFIED: no source file in pull-request-page/conversation/ was opened this pass; no specific render-order or live-update behavior is asserted as observed.
    - **Required new test:** First READ the conversation/ directory's controller/view files to characterize actual current behavior, then write a test pinning that — do not assume a 'server order, no reload' contract not yet read from source.
  - **Obligation:** state (checks integration)
    - **Invariant:** PROPOSED-UNVERIFIED: the prior text asserted the PR page's checks summary 'must reflect the same CI status pips as the right-sidebar checks panel without drifting out of sync' — this is an invented cross-component consistency requirement, not read from either component's source. Real source exists: pull-request-page/checks/{details-request.ts,refresh.ts,rerun.ts,tab.tsx} were not opened this pass.
    - **Required new test:** First READ pull-request-page/checks/details-request.ts and refresh.ts to characterize whether the PR page's checks data source is even the SAME data source PUI-SC-002's checks panel uses, before asserting any cross-component sync requirement.
  - **Obligation:** action (reviewers assignment)
    - **Invariant:** PROPOSED-UNVERIFIED: no source file in pull-request-page/reviewers/ was opened this pass; no specific idempotency behavior is asserted as observed. Real source exists: reviewers/request-actions.ts.
    - **Required new test:** First READ reviewers/request-actions.ts to characterize the actual current assign/unassign request behavior, then write a test pinning that — do not assume a 'no duplicate assignment' guarantee not yet read from source.
  - **Obligation:** action (edit/land)
    - **Invariant:** PROPOSED-UNVERIFIED: the prior text asserted the land/merge action 'must be gated on the same checks-pass condition the checks panel reports' — an invented universal required-check merge-gating rule, not read from any source file. Whether a land/merge action exists at all in this page (vs. only in the hosted-review flow already covered by PUI-SC-002) was not confirmed this pass.
    - **Required new test:** First READ pull-request-page/edit/ and /page/ to confirm whether a land/merge action even exists here (as opposed to solely in the right-sidebar hosted-review flow), before asserting any gating requirement.
- **Screenshot states still needed:** `SHOT-PR-01 (conversation)`, `SHOT-PR-02 (files/diff)`, `SHOT-PR-03 (reviewers)`
- **WP allocation:** primary `WP-UI-WORK`, backing `WP-ENG-GIT`; test-port path `tests/parity/ports/WP-UI-WORK/PUI-PR-001/**`
- **Dependencies:** PUI-SC-002 (shares provider/checks plumbing)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - Corrected WP allocation (prior pass): all 5 verified test files map to WP-UI-WORK per parity-test-work-packages.json's per-file manifest, not WP-CAP-INT.
  - CORRECTED this pass: the four missingInvariants previously asserted specific behavioral contracts (server-ordered live conversation updates, cross-component checks-parity with PUI-SC-002, no-duplicate reviewer assignment, universal required-check land-gating) that were never read from any pull-request-page source file — invented by analogy to how such a page 'should' work. Replaced with proposed-unverified framing naming the REAL source files for each concern (conversation/ controller files, checks/details-request.ts+refresh.ts, reviewers/request-actions.ts, edit//page/), none of which were opened this pass. Whether the checks-parity and land-gating concepts even apply to this specific page (as opposed to only the right-sidebar checks panel already covered by PUI-SC-002) was not confirmed.
- **Recommend:** EXISTING BEHAVIOR REQUIRED DURING MIGRATION (not deferred, not new scope). Peripheral cache/diff-index/mention/badge behavior is REUSE-grade verified; the page's core review surface (conversation, checks, reviewers, edit/land) has an undecided implementation strategy and its real source files were not opened this pass — any new test must first characterize existing behavior, not assert an invented cross-component consistency or gating contract.

### PUI-BROWSER-001 — Browser pane tab (URL classify / guest-view / trust boundary)

- **Surface (taxonomy category):** browser
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** Created via the tab-bar create-entry classifier when typed input is a URL (explicit-url vs host-url, matching the SSH/remote-host distinction) or falls through to a configured search engine for a non-URL query. Backed by an 8-file IPC surface confirming this is not a thin webview wrapper: browser-guest-view-ipc.ts (Electron <webview> bridge), browser-renderer-trust.ts (explicit trust-boundary enforcement), browser-session-profile-ipc.ts (per-profile cookie isolation), browser-preview-tool-authorization.ts (explicit consent before an agent tool can drive the pane).
- **Source anchor:** `src/renderer/src/components/tab-bar/tab-create-entry-classifier.ts:5,14,33,39,62-64,188,206,231,239,241 (classifyExplicitUrl/classifyHostUrl); src/main/ipc/{browser,browser-grab-ipc,browser-guest-view-ipc,browser-preview-tool-authorization,browser-renderer-trust,browser-session-profile-ipc,browser-tab-registration-wait,browser-client-page-metadata-ipc}.ts`
- **State:** explicit-url / host-url / non-URL-query classification result union.
- **Action:** type a bare domain, full URL, or search query; open per-profile cookie/session picker.
- **Error:** a malformed URL is rejected inline (blocked-option) before a tab is created.
- **Recovery:** an agent-tool attempt to control the browser pane without prior authorization must be refused — CONFIRMED by test: authorization classifies every registered browser channel as tool-vs-browser-page, waits correctly for a not-yet-attached guest, answers not-ready on wait-elapse, and disposes accumulated grab state when a grant is revoked.
- **Backing handler(s):** `src/main/ipc/browser-preview-tool-authorization.ts`
- **Original test path(s):**
  - `src/main/ipc/browser-preview-tool-authorization.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - classifies every registered browser channel as a tool or a browser-page channel (line 300)
    - waits for a document page whose guest has not attached yet, and arms when it does (line 388)
    - answers not-ready once the wait for an unrendered page elapses (line 407)
    - still waits for a browser page whose registration may be in flight (line 420)
    - disposes the grab state a preview target accumulated when its grant is revoked (line 435)
  - `src/renderer/src/components/browser-pane/ClientHostedBrowserPagePane.chrome-parity.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - opens the shared context menu for its own page and acts on the retained guest (line 98)
- **Screenshot states still needed:** `SHOT-BROWSER-01..04`
- **WP allocation:** primary `WP-UI-BROWSER`, backing `WP-ENG-BROWSER`, `WP-ENG-IPC`; test-port path `tests/parity/ports/WP-UI-BROWSER/PUI-BROWSER-001/**`
- **Dependencies:** PUI-TABS-001 (create-entry URL classification)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - 281-file components/browser-pane/ tree: only the ClientHostedBrowserPagePane test + a handful of top-level filenames verified; annotate/, assemble-chrome/, describe-page/, host-guest/, navigate/, stream-remote/, workspace-doc/ sub-subtrees unopened; backing store slice not located
- **Recommend:** REWRITE anything IPC/process-facing against the Rust core; REUSE presentation; the tool-authorization control is security-relevant and must be preserved exactly, not simplified

### PUI-NATIVECHAT-001 — Native chat portal (per-tab rendering mode, not a page)

- **Surface (taxonomy category):** native-chat
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE
- **Entrypoint:** NOT a top-level page or distinct tab kind — an alternate rendering mode for an existing terminal-pane tab whose running agent supports it, gated by settings toggle experimentalNativeChat (Settings→Experimental). tabAgentTypesByTabId tracks which agent runs in which tab; nativeChatTabWideFallbackUnsafeTabsById names tabs where a wide layout would be unsafe to render (falls back to plain terminal).
- **Source anchor:** `src/renderer/src/components/tab-bar/tab-agent-types-by-tab-id.ts:1-32; render seam: src/renderer/src/components/terminal-pane/TerminalPaneNativeChatPortal.tsx (confirmed the sole mounted portal via grep -rl NativeChatTranscriptChrome restricted to terminal-pane/pane-manager)`
- **State:** AgentType/AgentStatusEntry (shared/agent-status-types) + TerminalLayoutSnapshot (shared/terminal-tab-types) back the per-tab gate.
- **Action:** toggle experimentalNativeChat on/off; run a supported-agent terminal.
- **Error:** an unsupported agent type in the same tab must not attempt native-chat rendering — exact gate condition not traced to source this pass.
- **Recovery:** a tab in nativeChatTabWideFallbackUnsafeTabsById falls back to a safe (non-wide) layout — the autoscroll distance/near-bottom/jump-to-latest primitives that back scroll behavior in this mode ARE independently unit-tested (see below), though the fallback-safety gate itself was not traced to source.
- **Backing handler(s):** `src/main/native-chat/ (~35+ files: session-file-resolver.ts +variants, transcript-incremental-reader.ts, transcript-native-watcher.ts, per-agent line decoders transcript-line-decoders-{claude,codex,grok,omp}.ts); src/main/ipc/native-chat.ts`
- **Original test path(s):**
  - `src/renderer/src/components/native-chat/native-chat-autoscroll.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - is zero at the exact bottom and never negative (line 14)
    - sticks within the threshold and detaches beyond it (line 21, isNearBottom)
  - `src/main/ipc/native-chat-subscribe-lifecycle.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - closes a watcher that resolves after renderer unsubscribe (line 156)
    - closes a watcher that resolves after renderer destruction (line 178)
    - keeps the latest same-id subscribe when setup resolves in reverse order (line 194)
    - isolates late setup from a replacement renderer reusing the sender id (line 239)
- **Screenshot states still needed:** `SHOT-NCHAT-01..03`
- **WP allocation:** primary `WP-UI-NCHAT`, backing `WP-ENG-NCHAT`; test-port path `tests/parity/ports/WP-UI-NCHAT/PUI-NATIVECHAT-001/**`
- **Dependencies:** PUI-TERM-001 (native chat is a terminal-pane rendering mode)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - native-chat-leaf-routing.ts body; exact ipc/native-chat.ts channel list beyond the subscribe-lifecycle test; four per-agent transcript decoders' parsing rules; ~190 remaining components/native-chat/ files (composer actions, tool-run rendering, diff view, question cards)
- **Recommend:** REUSE render seam; the subscribe-lifecycle race-safety (sender-id reuse isolation) is security/correctness-relevant and must be preserved exactly

### PUI-DASHBOARD-001 — Agent dashboard popout (live buckets, snapshot cache)

- **Surface (taxonomy category):** agents
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE
- **Entrypoint:** Sidebar entry gated by experimentalAgentDashboardPopout, rendering live per-bucket counts (attention/working/done/idle). This is a POPOUT WINDOW, not an in-shell page. `registerDashboardPopoutHandlers` registers dashboardPopout:open, dashboard:publishSnapshot, dashboard:requestSnapshot, dashboard:getPopoutOpen, dashboardPopout:revealAgent after ipcMain.removeHandler idempotency guards (safely re-callable). lastSnapshot is replayed to a newly-mounted popout (paints without waiting for the next tick) and explicitly cleared on close (a reopened popout never flashes a previous session) — a precise, quotable, testable contract.
- **Source anchor:** `src/renderer/src/components/sidebar/AgentDashboardSidebarEntry.tsx:1-8,15-24; src/main/ipc/dashboard-popout.ts:6-11,22-38 (isDashboardEnabled gate, lastSnapshot module state, handler registration)`
- **State:** lastSnapshot: DashboardSnapshot | null cached at module scope.
- **Action:** open popout while agents running; close and reopen.
- **Error:** an invalid card in an otherwise-valid snapshot must not block the rest of the board from publishing, and must be logged, not silently dropped.
- **Recovery:** reopening must not show the previous session's stale snapshot — CONFIRMED by test.
- **Backing handler(s):** `src/main/window/dashboard-popout-window.ts (createOrFocusDashboardPopout, closeDashboardPopout, getDashboardPopoutWindow)`
- **Original test path(s):**
  - `src/main/ipc/dashboard-popout.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - opens only for the trusted main renderer while the feature is enabled (line 117)
    - auto-closes the popout when the feature is disabled (line 141)
    - caches and forwards only valid trusted snapshots (line 146)
    - keeps publishing the board when one card is invalid, and says so (line 163)
    - logs when a snapshot is rejected outright (line 183)
- **Screenshot states still needed:** `SHOT-DASH-01..02`
- **WP allocation:** primary `WP-UI-DASH`, backing `WP-ENG-IPC`; test-port path `tests/parity/ports/WP-UI-DASH/PUI-DASHBOARD-001/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - dashboard-popout.ts past its registration function; dashboard-popout-window.ts body
- **Recommend:** REUSE

### PUI-AIVAULT-001 — AI Vault session panel (right-sidebar 'vault' tab)

- **Surface (taxonomy category):** agents
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE (verified: resume target/host-ownership matching, cross-account repin safety, and renderer title-sync reconciliation — all directly confirmed by test); main-process session-title-routing layer specifically is proposed-unverified
- **Entrypoint:** Resolves the prior audit's open question: AiVaultPanel.tsx is the right sidebar's 'vault' tab, one of 9 fixed RightSidebarTab values (explorer|search|mentu|vault|workspaces|pr-checks|source-control|checks|ports|plugin:*), not an orphaned/undocumented surface. Sessions are discovered across multiple connected hosts (ai-vault-host-discovery.ts); scan coalescing mirrors the mentu-session-request-coalescer.ts pattern — a repeated, deliberate cross-domain principle.
- **Source anchor:** `src/shared/ui-chrome-types.ts:88-101 (RightSidebarTab enum, authoritative); src/main/ai-vault/ + src/main/ipc/{ai-vault,ai-vault-delete,ai-vault-host-discovery,ai-vault-host-leg-cache,ai-vault-resume,ai-vault-runtime-scan,ai-vault-scan-coalescing,ai-vault-session-title-routing,ai-vault-subagent-list}.ts`
- **State:** sessions listed across all discovered hosts — CONFIRMED by test (local + connected SSH targets + paired runtime servers are merged; a runtime-host-discovery failure does not drop already-available local/SSH results). Subagent list rendering and rescan-in-flight list stability are also CONFIRMED.
- **Action:** switch right sidebar to 'vault'; expand subagent list; resume a session.
- **Error:** not traced this pass.
- **Recovery:** resuming an AI Vault session after a host reconnect must reattach to the correct session, not a different one with a coincidentally similar title — CORRECTED this pass: the prior claim of zero test coverage anywhere was FALSE, caused by searching only main/ipc/ai-vault-resume.ts's own directory instead of tracing its shared/renderer/mobile consumers. ai-vault-resume-target.test.ts confirms resume targets are matched against their owning host/repo (never an unrelated one); ai-vault-resume-command.drop-repin.test.ts confirms a resumed session's account/cwd substitution is repinned correctly rather than 'keeping the wrong-account command' (its own words); ai-vault-tab-title-sync.test.ts confirms title reconciliation on a provider-session-identity change. What remains genuinely unconfirmed: a dedicated test for src/main/ipc/ai-vault-session-title-routing.ts itself (the main-process routing layer), and the specific scenario of two sessions sharing an identical title string on two different hosts — neither was found by this pass's search, which is now the bounded, correctly-scoped remaining gap, not a global absence claim.
- **Original test path(s):**
  - `src/main/ipc/ai-vault.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - routes local scope to the local scanner (line 121)
    - routes SSH scope to only that SSH target (line 134)
    - merges local plus connected SSH targets for all hosts (line 296)
    - merges paired runtime servers for all hosts (line 309)
    - keeps local and SSH results when runtime host discovery fails (line 336)
    - coalesces concurrent cancellable requests into one scan (line 216)
    - *note:* CONFIRMS the card's 'sessions listed across all discovered hosts' state obligation directly — local + SSH + paired runtime servers are merged, and a runtime-host-discovery failure does not drop the local/SSH results already available.
  - `src/main/ipc/ai-vault-scan-coalescing.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - coalesces every all-host leg while isolating caller cancellation (line 95)
    - keeps a shared multi-window scan alive when one window cancels (line 123)
    - reports a real scan failure as a host issue rather than cancellation (line 155)
    - re-joins a preempted same-scope caller onto the forced refresh (line 192)
  - `src/renderer/src/components/right-sidebar/AiVaultSessionRow.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - does not expand the row when a menu action is chosen (line 105)
    - still expands when the row itself is clicked (line 121)
    - keeps the agent identity visible while the row is expanded (line 145)
  - `src/renderer/src/components/right-sidebar/AiVaultSessionSubagents.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - keeps the loaded list visible while a rescan-triggered refetch is in flight (line 72)
    - labels the subagent run state exactly once, on the dot itself (line 101)
    - does not fetch for remote sessions even when the scan counted transcripts (line 117)
  - `src/renderer/src/lib/ai-vault-resume-target.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - detects WSL-stored session files (line 39)
    - allows host-stored sessions on local targets only (line 48)
    - allows host-tagged SSH sessions only on the matching SSH target (line 72)
    - never allows unknown targets (line 143)
    - classifies local, SSH, runtime, and unknown repo owners (line 151)
    - resolves runtime-owned worktree targets through their repo owner (line 182)
    - *note:* Directly relevant to the card's resume-identity concern: this is target/host/ownership classification, confirming a resume target is matched against its OWNING host/repo, never resolved against an unrelated one.
  - `src/renderer/src/lib/ai-vault-resume-command.drop-repin.test.ts` — evidence tier: **assertion-body-inspected**, NOT executed this pass
    - repins a payload with a cwd to the substituted home (line 56)
    - repins a payload whose session has no cwd instead of keeping the wrong-account command (line 70) — title itself names the exact failure mode this guards: a stale command that would run under the wrong account
    - declines a payload from an older serializer that never carried sessionCwd (line 84)
    - *note:* This is real, verified account/identity-repin safety for a resumed session — distinct from and narrower than 'title-string matching', but directly addresses cross-account/cross-session misattribution on resume.
  - `src/shared/ai-vault-resume-command.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - resumes OMP by absolute transcript path so it resolves across session-dir roots (line 87)
    - falls back to the session id when no OMP transcript path is known (line 117)
    - resumes Prime Agent by absolute transcript path like OMP (line 129)
  - `mobile/src/session/ai-vault-resume-preparation.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - repins a per-account session to the home the host substitutes (line 139)
    - keeps a per-account session home when an older host sends no repin (line 164)
    - keeps a per-account session usable when the host cannot prepare at all (line 174)
  - `src/renderer/src/lib/ai-vault-tab-title-sync.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - reconciles immediately when the provider session identity changes (line 352)
    - retains a recovered sleeping title after its lifecycle record disappears (line 219)
    - *note:* This is the renderer-side title-SYNC consumer of ai-vault-session-title.ts; it is NOT the same module as src/main/ipc/ai-vault-session-title-routing.ts (which remains without a dedicated test — see gaps), but it is real, directly relevant evidence that title/identity reconciliation on a session-identity change is tested somewhere in the stack.
- **Missing invariants (obligation not yet covered by any test found; capability remains mandatory):**
  - **Obligation:** state (ai-vault-session-title-routing.ts main-process layer specifically)
    - **Invariant:** The main-process IPC routing layer for session titles (as opposed to the renderer-side sync logic now confirmed tested) should have its own test, or a confirmed indirect exercise through ai-vault.test.ts.
    - **Required new test:** PROPOSED-UNVERIFIED, not asserted as a known gap in behavior: only imported by src/main/ipc/ai-vault.ts; whether ai-vault.test.ts's existing assertions exercise this file's logic (vs. mocking around it) was not traced line-by-line this pass. Before writing a new test, first read ai-vault.test.ts's setup to characterize what it actually exercises.
- **Screenshot states still needed:** `SHOT-VAULT-01..03`
- **WP allocation:** primary `WP-UI-WORK`, backing `WP-ENG-IPC`, `WP-ENG-SHARED`, `WP-CAP-MOBILE`; test-port path `tests/parity/ports/WP-UI-WORK/PUI-AIVAULT-001/**`
- **Dependencies:** PUI-MENTU-001 (shares the coalescing pattern)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - CORRECTED this pass: the prior gap text claimed zero test coverage 'anywhere in the repository' for resume/session-identity, found by grepping only for the exact filenames ai-vault-resume.ts/ai-vault-session-title-routing.ts. A wider search of src/shared/, src/renderer/src/lib/, and mobile/src/session/ found 9 real test files (ai-vault-resume-command/-shell/-target/-command.resumable-agent/-command.drop-repin in renderer, ai-vault-resume-command/-preparation in shared, ai-vault-resume-preparation/-launch in mobile) totaling ~2,260 lines covering resume-command construction, shell-dialect handling, target/host-ownership classification, and cross-account repin safety. 5 of the 9 are now cited above; the other 4 (ai-vault-resume-command.test.ts in renderer, ai-vault-resume-shell.test.ts, ai-vault-resume-command.resumable-agent.test.ts, mobile's ai-vault-resume-launch.test.ts) were read for titles but not individually cited here to stay bounded — they exist and were confirmed real, not silently dropped.
  - The main-process ai-vault-session-title-routing.ts's own coverage (as opposed to the renderer-side title-sync now confirmed) remains genuinely open — see missingInvariants, marked proposed-unverified rather than a confirmed gap.
- **Recommend:** EXISTING BEHAVIOR REQUIRED DURING MIGRATION. REUSE the verified resume-target-ownership and cross-account repin-safety contract — this is now well-evidenced, correcting a prior false negative. The main-process session-title-routing layer's own test exposure remains open but is marked proposed-unverified, not asserted as an actual gap.

### PUI-ACCOUNTS-001 — Branded per-provider account switchers (Claude/Codex/Grok)

- **Surface (taxonomy category):** agents
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** implementation-strategy-undecided
- **Entrypoint:** Only THREE providers (of the ~19 harness directories under src/main/) get first-class branded status-bar account-switching chrome: Claude, Codex, Grok. A verified, real asymmetry, not an oversight.
- **Source anchor:** `status-bar/{ClaudeSwitcherMenu,CodexSwitcherMenu,StatusBarAccountControls,GrokAccountsSection}.tsx, status-bar-{claude,codex}-accounts.ts; src/main/{claude-accounts,codex-accounts,grok-accounts}/; settings/AccountsPane.tsx + accounts-pane-{claude,codex,minimax}-section.tsx`
- **State:** active account per branded provider; main-process credential identity-matching during a switch is CONFIRMED by test for Claude and Codex (not Grok).
- **Action:** switch the active account via its status-bar menu.
- **Error:** n/a.
- **Recovery:** PROPOSED-UNVERIFIED: no renderer source file for any of the 4 branded switcher components was opened this pass, so no specific tab-scoping behavior is asserted as observed — see missingInvariants. The 3 main-process tests found (Claude/Codex/Grok) confirm CREDENTIAL-swap identity safety at the auth-service layer, a real but different-layer finding, not evidence about renderer tab-scoping either way.
- **Original test path(s):**
  - `src/main/claude-accounts/runtime-auth-service-account-switching.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - reads back refreshed credentials for the outgoing Claude account before switching (line 159)
    - switches accounts without persisting unverified live runtime credentials (line 195)
    - routes refreshed Claude credentials to the matching managed account (line 247)
    - rejects stale cold-start read-back for inactive matching account (line 291)
    - rejects ambiguous Claude read-back instead of choosing a managed account (line 335)
    - *note:* This tests MAIN-PROCESS credential-switching identity safety for Claude, not the renderer status-bar switcher UI itself, and not the specific 'new tabs scope to the new account, running sessions keep the old one' obligation this card names — see missingInvariants.
  - `src/main/codex-accounts/service-account-selection-and-removal.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - deselects active account via selectAccount(null) (line 32)
    - selectAccount switches managed accounts without routing auth through the shared mirror (line 76)
    - keeps Windows and WSL active Codex account selections separate (line 144)
    - *note:* Same main-process identity-safety layer as Claude's test above, for Codex; same scope limitation.
  - `src/main/grok-accounts/status.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - reports unsigned status when the Grok auth file is missing (line 16)
    - reports auth read errors without exposing token fields (line 28)
    - returns non-secret signed-in metadata and freshness (line 43)
    - *note:* Grok has ONLY a status-read test — no account-SWITCHING test exists for Grok at all, unlike Claude/Codex, confirmed by directory listing (grok-accounts/ has exactly one test file).
- **Missing invariants (obligation not yet covered by any test found; capability remains mandatory):**
  - **Obligation:** recovery (session-scoping across a switch)
    - **Invariant:** PROPOSED-UNVERIFIED (not an observed contract): the prior text asserted a specific tab-scoping rule ('a tab already running keeps its old account; only new tabs use the new one') by analogy to how such a switch 'should' work — no renderer source file (ClaudeSwitcherMenu.tsx/CodexSwitcherMenu.tsx/StatusBarAccountControls.tsx/GrokAccountsSection.tsx or their controllers) was opened this pass to confirm whether that is even the actual current behavior.
    - **Required new test:** First READ the switcher components and use-codex-switcher-controller.ts (present, not opened) to characterize what actually happens to an already-open tab when the active account changes, then write a test pinning the OBSERVED behavior — do not assume the scoping rule described above without reading the code.
  - **Obligation:** state/action (Grok account switching)
    - **Invariant:** Grok's test surface is smaller than Claude's/Codex's — this IS a directly observed fact (grok-accounts/ contains exactly one test file, status.test.ts, vs. Claude's 22 and Codex's ~35+), not an invented requirement. Whether Grok's underlying switching code has the SAME safety properties Claude/Codex tests confirm is unknown, not asserted false.
    - **Required new test:** A switching-safety test analogous to Claude's/Codex's would need to first read Grok's actual account-switching source (not opened this pass) to characterize its current behavior before asserting parity is missing, rather than assuming Grok's underlying code lacks safety it wasn't shown to have.
- **Screenshot states still needed:** `SHOT-ACCT-01..02`
- **WP allocation:** primary `WP-UI-CORE`, backing `WP-ENG-HARNESS`; test-port path `tests/parity/ports/WP-UI-CORE/PUI-ACCOUNTS-001/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - Corrected backing WP (prior pass): the 3 verified test files map to WP-ENG-HARNESS per the manifest, not WP-ENG-AGENTSVC.
  - CORRECTED this pass: the tab-scoping-across-a-switch missingInvariant previously asserted a specific behavioral rule invented by analogy, without reading any switcher-component or controller source. Reframed as proposed-unverified. The Grok test-file-count asymmetry (1 file vs. Claude's/Codex's dozens) remains a directly observed, unedited fact from directory listing, not invented — but 'Grok lacks switching-safety' is now correctly stated as unknown rather than a confirmed gap, since Grok's actual switching source was not read this pass either.
- **Recommend:** EXISTING BEHAVIOR REQUIRED DURING MIGRATION (not deferred, not new scope). Main-process credential-swap identity safety is REUSE-grade verified for Claude/Codex; the renderer tab-scoping obligation and Grok's actual switching-code safety are both proposed-unverified — no switcher-component source or Grok switching source was opened this pass, so neither is asserted as a confirmed gap or a confirmed behavior.

### PUI-SKILLS-001 — Skills page (cloud install / share / agent setup)

- **Surface (taxonomy category):** skills
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** Sidebar 'Skills' button (defaults HIDDEN unless explicitly shown — a verified, real asymmetry vs. Automations/Mobile's default-visible posture) → SkillsPage. Also reachable via Settings pane share-skills and pane agents→AgentSkillSetupPanel. 176-file src/main/skills/ backs four distinct sub-flows: cloud-install, local-install-management, install-progress-streaming, share/publish.
- **Source anchor:** `src/renderer/src/components/sidebar/SidebarNav.tsx:51-55,105,116,120,229-257; src/main/ipc/{skills,skill-cloud-install-ipc-schemas,skill-cloud-ipc-handlers,skill-install-management-ipc-handlers,skill-install-progress-ipc,skill-ipc-main-window,skill-share-publishing-ipc-schemas,skill-delete}.ts`
- **State:** install-progress streamed via a dedicated channel, decoupled from the cloud-install request itself.
- **Action:** install a skill via the cloud path; view progress; share/publish.
- **Error:** an unauthorized/malformed cloud-install response must not report a skill as installed — not traced to source this pass.
- **Recovery:** install-progress publication must not continue after the invoking renderer is destroyed — CONFIRMED by test.
- **Backing handler(s):** `src/main/ipc/skill-install-progress-ipc.ts`
- **Original test path(s):**
  - `src/main/ipc/skill-install-progress-ipc.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - projects destination-owned bundle progress without paths or grants (line 12)
    - does not publish after the invoking renderer is destroyed (line 29)
  - `src/renderer/src/components/skills/skill-delete-copy.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - summarizes folders, links, and the roots they sit in (line 15)
    - drops the zero half so a link-only delete never reads "0 folders" (line 38)
    - groups by typed reason rather than one merged skipped line (line 116)
    - omits deleted rows and keeps one line per distinct outcome (line 130)
- **Screenshot states still needed:** `SHOT-SKILLS-01..03`
- **WP allocation:** primary `WP-UI-AUX`, backing `WP-ENG-PLUGINS`; test-port path `tests/parity/ports/WP-UI-AUX/PUI-SKILLS-001/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - 176 main/skills files + 115 components/skills files beyond the two verified test files; unauthorized/malformed cloud-install-response rejection not traced
- **Recommend:** REUSE presentation; REWRITE install/filesystem side against the daemon; the progress-does-not-publish-after-destruction guarantee must be preserved exactly (a leak/crash class bug if dropped)

### PUI-ARTIFACTS-001 — Artifacts (create-intent + share-record, resumable publish)

- **Surface (taxonomy category):** skills
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE (verified: resumable create-intent persistence, cloud-side response-loss reconciliation, and renderer resume-after-reconnect — all directly confirmed by test)
- **Entrypoint:** Sidebar 'Artifacts' button (also defaults HIDDEN, requires explicit true — same asymmetry class as Skills). No dedicated ipc/artifacts.ts — artifact-cloud wiring is imported from runtime/runtime-artifact-controller.ts and startup/main-process-runtime-service.ts, i.e. wired through the general-purpose runtime IPC channel set, not a standalone handler file (verified by targeted grep, not a guess). artifact-create-intent-store.ts / artifact-share-record-store.ts name persisted stores for a resumable, multi-step creation/publish intent — not a single atomic action.
- **Source anchor:** `src/renderer/src/components/sidebar/SidebarNav.tsx:45-49,104,115,119,200-228; src/main/artifacts/{artifact-cloud-config,artifact-cloud-request,artifact-cloud-service,artifact-create-intent-store,artifact-publisher,artifact-share-record-store}.ts`
- **State:** an artifact-creation intent persists across steps (artifact-create-intent-store) — CONFIRMED by test, including crash-recovery and content-type/size validation.
- **Action:** create an artifact; publish; share.
- **Error:** not traced this pass.
- **Recovery:** an interrupted publish must resume from the persisted create-intent-store state rather than losing the draft or double-publishing — CONFIRMED by test: the intent store retains the exact original request until the matching create completes (blocking a second, divergent create), removes crash-left temporary writes before admitting a new intent, and the cloud-recovery layer reconciles or replays an artifact whose committed-create response was lost, rather than re-publishing a duplicate. The renderer publish flow separately confirms it 'resumes with fresh content after reconnecting.'
- **Backing handler(s):** `src/main/runtime/runtime-artifact-controller.ts`
- **Original test path(s):**
  - `src/main/artifacts/artifact-create-intent-store.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - retains the first key and exact request until the matching create completes (line 44)
    - bounds unresolved payload storage without dropping an existing intent (line 90)
    - clears pending content at the profile lifecycle boundary (line 125)
    - removes crash-left temporary writes before admitting another intent (line 145)
    - refuses to overwrite an unreadable matching intent (line 209)
    - rejects a persisted content type outside the artifact allowlist (line 255)
    - persists an escaped artifact within the recovery limit (line 277)
  - `src/main/artifacts/artifact-cloud-recovery.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - reconciles one remotely revocable artifact after a committed create loses its response (line 32)
    - replays the exact create when content is unchanged after response loss (line 55)
    - updates a recovered share when its content changed after response loss (line 70)
    - retains recovery until a changed-content update succeeds (line 87)
    - clears the durable mapping when a committed delete retry returns 404 (line 106)
    - drops an uncommitted validation failure so corrected content can create (line 155)
    - *note:* This is the DIRECT confirmation of the card's named recovery obligation: a committed create whose response was lost is reconciled/replayed, never silently re-published as a duplicate.
  - `src/renderer/src/components/artifacts/artifact-publish-flow.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - signs in before preparing and publishing the request (line 47)
    - resumes with fresh content after reconnecting (line 63)
    - surfaces sign-in failures without preparing the file (line 81)
    - rejects an oversized request before RPC (line 91)
    - shows confirmation without putting the public link in the toast (line 119)
  - `src/main/artifacts/artifact-share-record-store.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - isolates edit tokens by cloud identity and API origin (line 37)
    - removes every source mapping for a deleted slug in the matching scope (line 69)
    - prunes expired records on read (line 110)
    - refuses to overwrite an unreadable existing record file (line 223)
- **Screenshot states still needed:** `SHOT-ART-01..03`
- **WP allocation:** primary `WP-UI-AUX`, backing `WP-ENG-PLUGINS`; test-port path `tests/parity/ports/WP-UI-AUX/PUI-ARTIFACTS-001/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - Corrected backing WP this pass: the 3 main-process test files map to WP-ENG-PLUGINS per the manifest, not WP-ENG-RUNTIME as the prior revision guessed (the renderer test correctly maps to WP-UI-AUX, kept as primary).
  - The card's originally-named recovery obligation (resumable publish, no double-publish) is now REUSE-grade verified across 4 real test files spanning intent-store persistence, cloud-side reconciliation, and the renderer resume-after-reconnect flow. artifact-publisher.ts's own body and the exact runtime-channel names runtime-artifact-controller.ts registers were still not individually opened this pass — a narrower remaining gap than before, not a full-capability gap.
- **Recommend:** EXISTING BEHAVIOR REQUIRED DURING MIGRATION. REUSE the verified resumable-publish/no-double-publish contract across intent-store, cloud-recovery, and renderer-resume layers — this is now one of the better-evidenced cards in this checkpoint, not a proposal.

### PUI-TASKS-001 — Task page (Jira/Linear/GitHub/GitLab providers)

- **Surface (taxonomy category):** tasks
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** Unconditional sidebar button (not gated by a show*Button setting, unlike Automations/Artifacts/Skills/Mobile). SourceBar.tsx tracks linearConnected/jiraConnected/linearWorkspaces/jiraSites as first-class independent booleans. jira-cancellable-requests.ts makes Jira requests explicitly cancellable — switching sources mid-load must cancel the stale request, not race it (CONFIRMED by test).
- **Source anchor:** `SidebarNav.tsx:24,199; AppWorkspaceShell.tsx:19,76; src/renderer/src/components/task-page/SourceBar.tsx (first 40 lines); src/main/ipc/{jira,jira-cancellable-requests,linear,linear-custom-view-handlers,linear-issue-handlers,linear-project-handlers,linear-team-handlers,github,gitlab}.ts`
- **State:** connection-status booleans + workspace/site lists per provider.
- **Action:** connect Jira/Linear via Settings integration cards; switch source; view item list.
- **Error:** switching source before a prior Jira request resolves cancels it; stale results from the abandoned source must never render into the new source's view — CONFIRMED by test.
- **Recovery:** a disconnected provider (expired token) must surface a reconnect affordance, not an empty silent list — not verified this pass.
- **Backing handler(s):** `src/main/ipc/jira-cancellable-requests.ts`
- **Original test path(s):**
  - `src/main/ipc/jira-cancellable-requests.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - aborts a late run when cancel arrived before registration (line 5)
    - aborts an in-flight run on cancel (line 23)
    - ignores blank request ids (line 49)
- **Screenshot states still needed:** `SHOT-TASK-01..04`
- **WP allocation:** primary `WP-UI-CORE`, backing `WP-ENG-IPC`; test-port path `tests/parity/ports/WP-UI-CORE/PUI-TASKS-001/**`
- **Dependencies:** PUI-PR-001 (GitHub/GitLab providers overlap with the PR page)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - 47 components/task-page files + github/gitlab/jira/linear sub-subtrees beyond SourceBar/TaskPage; backing store slice/selector not traced; reconnect-affordance recovery path not verified
- **Recommend:** REUSE presentation; REWRITE provider network calls against the daemon; the cancellable-request discipline must be preserved exactly

### PUI-AUTOMATIONS-001 — Automations (schedule/trigger, host-fenced dispatch)

- **Surface (taxonomy category):** automations
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** Sidebar 'Automations' button (default-VISIBLE unless explicitly hidden — opposite default posture from Skills/Artifacts) → AutomationsPage; also reachable via Settings pane automations. AutomationService.runNow is directly consumed by Bots (BotAutomationRunner = Pick<AutomationService,'runNow'>, cross-referenced at bot-service.ts:17) — Bots' scheduling literally calls into Automations, confirmed by direct cross-reference, not guessed. Host-ownership fencing (automation-owner-fencing.ts, automation-dispatch-host-fence.ts) extends the same host-ownership discipline this repo already applies to live PTYs to scheduled runs. Headless dispatch (headless-dispatch.ts) is a materially distinct execution mode with no interactive window.
- **Source anchor:** `SidebarNav.tsx:39-43,102,113,117,258-286 (shouldShowAutomationsButton, default visible); AppWorkspaceShell.tsx:20,77; src/main/automations/service.ts (class AutomationService); src/main/ipc/automations.ts`
- **State:** which host owns a given automation run (fencing modules).
- **Action:** create an automation (prompt+schedule/trigger); it runs and appears in AutomationRunsDashboard with a result.
- **Error:** prechecks gate dispatch by staleness/manual/headless conditions — CONFIRMED by test at the dispatch-gating level; whether a blocked dispatch surfaces a VISIBLE reason to the user (vs. just not running) was not confirmed by the titles read this pass — see refused-manual-run.ts/dispatch-refusal.ts as the named files to check for that specific UX claim.
- **Recovery:** a crashed/interrupted run must be reconciled on next load rather than left stuck 'running' forever — not verified this pass, named as the exact contract to check (directly analogous to the terminal unverifiable discipline).
- **Backing handler(s):** `src/main/automations/service.ts`; `src/main/automations/{precheck-runner,refused-manual-run,dispatch-refusal}.ts`
- **Original test path(s):**
  - `src/main/automations/service-precheck.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - runs scheduled prechecks in the target repo before dispatch (line 71)
    - does not run scheduled prechecks when the selected host setup is stale (line 121)
    - does not run prechecks for manual dispatches (line 166)
    - honors scheduled prechecks before headless dispatch (line 191)
  - `src/renderer/src/components/automations/automation-host-recovery.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - retries the host rather than the whole page (line 48)
    - dials the SSH target when the authority is fine (line 54)
    - dials the runtime first when the server itself is unreachable (line 61)
    - re-asks a desktop Self host, which has no transport to dial (line 73)
    - deep-links a runtime to its update row in Remote Orca Servers settings (line 82)
  - `src/renderer/src/components/automations/AutomationDetail.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - shows a paused record as a plain pause (line 63)
    - shows a running automation as enabled (line 70)
- **Screenshot states still needed:** `SHOT-AUTO-01..04`
- **WP allocation:** primary `WP-UI-AUTO`, backing `WP-CAP-AUTO`, `WP-ENG-RUNTIME`; test-port path `tests/parity/ports/WP-UI-AUTO/PUI-AUTOMATIONS-001/**`
- **Dependencies:** PUI-BOTS-001 (Bots calls AutomationService.runNow)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - service.ts body itself not read; exact IPC channel names in ipc/automations.ts; renderer store slice; crashed-run reconciliation not verified; 276-file components/automations/ control surface beyond ~19 top-level filenames
- **Recommend:** REWRITE dispatch/host-fencing against the Rust core (matches the terminal host-ownership precedent); REUSE presentation

### PUI-BOTS-001 — Bots page (creation/character preset/responsibility scheduling)

- **Surface (taxonomy category):** bots
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration; pendingPostmigration: reactive adapters/delegation UI/trigger UX/flush barriers per parity-work-packages.md
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** Bot creation with a character preset compiles a system prompt (shared/drogon-bot-prompt.ts buildDrogonBotOperatingPrompt); responsibility cards list scheduled duties. BotService is a plain class (Store + Pick<AutomationService,'runNow'>); create/update/delete/rotateSession are thin pass-throughs to the store; createResponsibility throws 'Bot not found.' for an absent bot id (a real, quotable error contract). Ownership migration/repair logic exists for legacy automations whose owning Bot record is gone.
- **Source anchor:** `src/main/bots/bot-service.ts:1-19 (constructor), :21-45 (snapshot/create/update/delete/rotateSession), :51-60+ (createResponsibility, body continues past line 60 — named remaining gap); components/bots/{BotsPage,BotsPageForms,BotsPageStates,BotCreationForm,BotCharacterPicker,BotResponsibilityCard}.tsx`
- **State:** per-bot responsibility history (botResponsibilityHistory).
- **Action:** create a bot with a character preset; run a scheduled responsibility.
- **Error:** createResponsibility on an unknown botId throws 'Bot not found.' rather than silently no-op-ing.
- **Recovery:** a dangling owner from a legacy automation must be dropped rather than inventing a Bot; mismatched owners are repaired and orphaned responsibilities dropped when the underlying automation is gone — CONFIRMED by test, a real migration-safety contract.
- **Backing handler(s):** `src/main/bots/bot-service.ts`; `src/main/bots/bot-responsibility-owner.ts`
- **Original test path(s):**
  - `src/main/bots/bot-responsibility-owner.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - migrates scheduled responsibility ownership and run links (line 55)
    - keeps a Bot automation in global administration while projecting Bot history (line 68)
    - drops a dangling owner from a legacy automation instead of inventing a Bot (line 95)
    - repairs mismatched owners and drops responsibilities whose automation is gone (line 106)
    - refuses to manually fake execution of a reactive responsibility (line 259)
  - `src/renderer/src/components/bots/BotsPage.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - renders an actionable empty state (line 66)
    - keeps model selection at the harness default and applies a real character preset (line 72)
    - does not invent a harness when discovery returns none (line 88)
    - runs a responsibility through the Bot card that owns it (line 101)
- **Screenshot states still needed:** `SHOT-BOTS-01..03`
- **WP allocation:** primary `WP-CAP-BOTS`, backing `WP-ENG-HARNESS`, `WP-ENG-IPC`; test-port path `tests/parity/ports/WP-CAP-BOTS/PUI-BOTS-001/**`
- **Dependencies:** PUI-AUTOMATIONS-001 (BotAutomationRunner delegates to AutomationService.runNow)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - createResponsibility body past line 60 not read; the rest of src/main/bots/ beyond bot-service.ts/bot-responsibility-owner.ts
- **Recommend:** REUSE UI; REWRITE service against the Rust core/AutomationService equivalent

### PUI-MENTU-001 — Mentu panel & recipe workbench (DAG, retry-fold, evidence restore)

- **Surface (taxonomy category):** mentu
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration; pendingPostmigration: Qwen compat, recipe-81/90 follow-ups, rendered final check per parity-work-packages.md
- **Implementation strategy:** REUSE (verified: retry-ordering/graph-node UI contract, evidence-restore race-safety, recipe-graph.ts cycle-detection, AND readRunRequestForScope's in-flight dedup via its evidence-restore consumer — all directly confirmed by test); implementation-strategy-undecided for discoveryRequestForScope/recipeLoadRequestForScope specifically, whose actual current behavior was not characterized this pass
- **Entrypoint:** Recipe DAG renders step dependencies; the newest attempt's status is surfaced on the graph node, never the first-failed one, and a retry group does NOT fall back to the first failed record once a later attempt succeeds (both CONFIRMED by test — directly resolves the prior audit's 'not re-verified' flags on retry-fold and evidence-restore). mentu-session-request-coalescer.ts names concurrent-request coalescing as a designed behavior, mirrored by AI Vault's own scan-coalescing.
- **Source anchor:** `src/renderer/src/components/mentu/ (25 files): recipe-graph.ts (DAG model), RecipePane.tsx + RecipePaneContent/Header.tsx, recipe-retry-evidence.test.tsx (graph/attempt-selection helpers), mentu-session-{draft-state,identity,navigation,request-coalescer,state-access}.ts`
- **State:** same-label retry records ordered oldest-to-newest with the newest exposed as current; legacy records missing invocation_count metadata are tolerated, not rejected. recipe-graph.ts's core DAG-building/cycle-detection is now CONFIRMED by test (buildRecipeGraph rejects a cyclic dependency graph rather than silently accepting a broken DAG); 1 of mentu-session-request-coalescer.ts's 3 exports (readRunRequestForScope) has real, unmocked, body-inspected test exposure via mentu-evidence-restore.test.tsx's StrictMode assertion; the other 2 exports (discoveryRequestForScope, recipeLoadRequestForScope) remain untested — see missingInvariants.
- **Action:** open recipe DAG; expand a retry-folded step; open evidence/verification view.
- **Error:** n/a beyond the retry-ordering guarantees above.
- **Recovery:** evidence restore recovers a session's prior state without rerunning a settled read, discards a stale host response rather than substituting a local read, and ignores an outstanding response after the surface unmounts — CONFIRMED by test.
- **Original test path(s):**
  - `src/renderer/src/components/mentu/recipe-retry-evidence.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - orders same-label records oldest to newest and exposes the newest as current (line 94)
    - does not fall back to the first failed record once a later attempt succeeds (line 109)
    - groups more than two attempts in recorded order, oldest first (line 117)
    - treats a single-attempt step with no retries as its own one-record group (line 124)
    - tolerates legacy records missing invocation_count metadata (line 130)
    - surfaces the newest attempt status on the graph node, not the first failed one (line 139)
    - renders a single current summary with no prior-attempt disclosure for an initial failure (line 158)
  - `src/renderer/src/components/mentu/mentu-evidence-restore.test.tsx` — evidence tier: **assertion-body-inspected**, NOT executed this pass
    - settles a delayed read after publishing its loading state (line 84)
    - restores evidence without rerunning the read after it settles (line 98)
    - surfaces a rejected read and releases the operation (line 137)
    - shares the pending read through StrictMode cleanup and remount (line 147) — body-inspected: asserts `expect(readRun).toHaveBeenCalledTimes(1)` across a StrictMode double-mount, which is only possible if the underlying (real, unmocked) readRunRequestForScope map-based dedup in mentu-session-request-coalescer.ts actually reused the in-flight promise — this is the ONE coalescer export (of three) with real, unmocked test exposure
    - discards the old host response and never substitutes a local read (line 156)
    - ignores an outstanding response after the surface unmounts (line 180)
    - *note:* use-mentu-session-evidence-restore.ts (this test's subject hook) imports readRunRequestForScope DIRECTLY from mentu-session-request-coalescer.ts and does not mock it — traced via grep of both files' import statements, not assumed. discoveryRequestForScope and recipeLoadRequestForScope (the coalescer's other two exports) are consumed only by use-mentu-session-loading.ts, which has no test file found (searched for *loading*test* under components/mentu) — those two remain genuinely untested.
  - `src/renderer/src/components/mentu/RecipePane.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - builds dependencies from steps and refuses cycles (line 225) — directly exercises buildRecipeGraph from ./recipe-graph: a valid dependency resolves to the correct step-id, and a cyclic dependency graph returns valid=false, empty nodes, and a non-null cycle marker
    - projects recipe tabs through the native order and focus model (line 176)
    - round-trips source JSON fields that the pane does not know (line 204)
- **Missing invariants (obligation not yet covered by any test found; capability remains mandatory):**
  - **Obligation:** shared-state (concurrent request coalescing — 2 of 3 exports)
    - **Invariant:** PROPOSED-UNVERIFIED (not an observed contract): discoveryRequestForScope and recipeLoadRequestForScope should have the same in-flight-dedup behavior readRunRequestForScope is confirmed to have. This is a reasonable-by-symmetry hypothesis (same Map-based pattern, same file), not itself evidence — the source anchor for the actual (unread this pass) function bodies is mentu-session-request-coalescer.ts:19-79.
    - **Required new test:** A test exercising use-mentu-session-loading.ts (the sole consumer of both functions; components/mentu has no *loading*test* file) would need to FIRST characterize the functions' actual current dedup/cancellation behavior by reading mentu-session-request-coalescer.ts:19-79, not assume the AI-Vault-scan-coalescing pattern (cancellation isolation, preempted-caller re-join) applies here — those specific behaviors were NOT observed in this file and were an unfounded analogy in the prior pass, now removed.
- **Screenshot states still needed:** `SHOT-MENTU-01..03`
- **WP allocation:** primary `WP-CAP-MENTU`, backing `WP-ENG-IPC`, `WP-UI-CORE`, `WP-ENG-SHELL`; test-port path `tests/parity/ports/WP-CAP-MENTU/PUI-MENTU-001/**`
- **Dependencies:** PUI-AIVAULT-001 (shared coalescing pattern)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - CORRECTED this pass: the prior claim 'not referenced by any other test file's imports' was found by grepping test files for the literal string 'request-coalescer', which misses indirect exposure through a consumer. Tracing actual imports: mentu-session-request-coalescer.ts's readRunRequestForScope is imported (unmocked) by use-mentu-session-evidence-restore.ts, which IS exercised by mentu-evidence-restore.test.tsx's StrictMode assertion (now tagged assertion-body-inspected above) — this is real, verified, if narrow, coverage of ONE of the three coalescer exports. discoveryRequestForScope/recipeLoadRequestForScope (imported only by use-mentu-session-loading.ts, itself untested) remain genuinely unverified — see missingInvariants, framed as proposed-unverified rather than an asserted requirement, since the AI-Vault-coalescing analogy (cancellation isolation, preempted-caller re-join) was not itself observed in this file's actual code and has been removed from the invariant text.
- **Recommend:** EXISTING BEHAVIOR REQUIRED DURING MIGRATION. REUSE the verified retry-ordering/graph-node/cycle-detection UI contract, evidence-restore race-safety, AND readRunRequestForScope's dedup (now confirmed, correcting a prior false negative); discoveryRequestForScope/recipeLoadRequestForScope remain implementation-strategy-undecided — characterize their actual behavior (mentu-session-request-coalescer.ts:19-79) before writing a new test or assuming they share readRunRequestForScope's pattern.

### PUI-MEETINGS-001 — Meetings page (transcript rows, capture availability, Q&A delegation)

- **Surface (taxonomy category):** meetings
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration; pendingPostmigration: shared-spaces model per parity-work-packages.md
- **Implementation strategy:** REUSE
- **Entrypoint:** Unavailable/non-macOS capture is explained WITHOUT offering a recording action (not just disabled — actively hidden); missing macOS companion app offers a setup affordance; saved/recording/failed artifacts render with model-readiness kept as a SEPARATE concern from artifact status; mounting a meeting delegates Q&A to the selected Drogon harness policy.
- **Source anchor:** `components/meetings/{MeetingsPage,MeetingsPageHeader,MeetingTranscriptRow,MeetingsNotices,meetings-page-runtime,use-meetings-page-controller,use-meetings-page-escape}.tsx`
- **State:** artifact status (saved/recording/failed) tracked independently of model readiness.
- **Action:** mount a meeting; delegate Q&A to the selected harness policy.
- **Error:** unavailable/non-macOS capture is explained inline, with the recording action itself withheld, not merely disabled.
- **Recovery:** a missing macOS companion app offers companion setup rather than a dead end — CONFIRMED by test.
- **Original test path(s):**
  - `src/renderer/src/components/meetings/MeetingsPage.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - explains unavailable and non-macOS capture without offering a recording action (line 98)
    - offers companion setup when the macOS app is missing (line 120)
    - renders saved, recording, and failed artifacts while keeping model readiness separate (line 137)
    - mounts a meeting and delegates Q&A to the selected Drogon harness policy (line 157)
- **Screenshot states still needed:** `SHOT-MEET-01 (transcript list)`, `SHOT-MEET-02 (unavailable/companion-setup state)`, `SHOT-MEET-03 (recording in progress)`
- **WP allocation:** primary `WP-CAP-MEET`, backing `WP-ENG-SHELL`; test-port path `tests/parity/ports/WP-CAP-MEET/PUI-MEETINGS-001/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - the prior audit's "Open as Workspace" hypothesis (mounting the transcript folder) was NOT re-verified against source this pass — carried forward as an unconfirmed hypothesis, not this card's own finding
- **Recommend:** REUSE UI; the capture-availability/companion-setup gating is exact product behavior worth preserving verbatim

### PUI-CONN-003 — Mobile pairing & emulator (QR pair, screen stream, agent setup guide)

- **Surface (taxonomy category):** mobile
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE+REWRITE-split (see recommend detail)
- **Entrypoint:** Settings panes mobile + mobile-emulator; page-level components/mobile/ (37 files, incl. WindowsFirewallNotice.tsx — Windows-specific pairing warning) + components/emulator-pane/ (54 files, incl. MobileEmulatorAgentSetupGuide.tsx — an in-product guided setup for agent-driven emulator control). Pairing a physical device via QR connects it; the emulator pane streams a device screen with hardware-button controls.
- **Source anchor:** `components/mobile/{MobilePage,PhoneCarousel,NetworkInterfacePicker,MobileAndroidInstallHelp,WindowsFirewallNotice}.tsx; components/emulator-pane/{EmulatorPane,emulator-device-frame,emulator-screen-stream-content,emulator-phone-hardware-buttons}.tsx`
- **State:** MobilePage stage/step state machine only auto-switches out of the pairing flow, and only on a real baseline change, not any refresh; emulator-pane session hook tracks which device/session is currently connecting vs. live.
- **Action:** walk QR pairing step; a device refresh during pairing surfaces as 'paired'; view paired devices; switch emulator devices; open agent setup guide overlay.
- **Error:** the interface picker must not claim there are no interfaces when unselected options actually exist, and must report a genuinely empty list only when there truly is nothing to pick — CONFIRMED by test, two distinct cases.
- **Recovery:** switching emulator devices mid-session must show a connecting state instead of the OLD device's live preview, and must ignore a stale rotate response arriving after the switch (a late-response race is explicitly guarded, not merely assumed safe) — CONFIRMED by test.
- **Original test path(s):**
  - `src/renderer/src/components/mobile/NetworkInterfacePicker.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - does not claim there are no interfaces when unselected options exist (line 32)
    - reports an empty interface list when there is genuinely nothing to pick (line 38)
    - shows the selected interface instead of any placeholder (line 44)
  - `src/renderer/src/components/mobile/mobile-page-stage.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - shows paired after a device refresh adds a phone during pairing flow (line 5)
    - keeps the flow while the refreshed device count is unchanged (line 15)
    - does not switch stages without a pairing baseline (line 25)
    - only auto-switches from the pairing flow (line 35)
  - `src/renderer/src/components/emulator-pane/use-emulator-pane-session.test.tsx` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - shows a connecting state instead of the old live preview while switching devices (line 165)
    - ignores a rotate response from the previous session after switching devices (line 204)
    - keeps simulator discovery setup errors during auto attach (line 246)
- **Screenshot states still needed:** `SHOT-MOBILE-01..02`, `SHOT-EMU-01..02`
- **WP allocation:** primary `WP-CAP-MOBILE`, backing `WP-ENG-REMOTE`, `WP-CAP-DEVICE`; test-port path `tests/parity/ports/WP-CAP-MOBILE/PUI-CONN-003/**`
- **Dependencies:** PUI-CONN-002 (pairing URL/QR generator shares the runtime-environments pairing flow)
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - 532-file WP-CAP-MOBILE scope is far larger than the 3 mobile/emulator-specific test files opened here (37 components/mobile + 54 components/emulator-pane files total); the actual QR-pairing wire protocol, WindowsFirewallNotice gating, and hardware-button control wiring were NOT opened this pass — only the interface-picker, page-stage, and session-switch hooks were
  - no test in this pass was EXECUTED — evidence is assertion-title inspection of source text only
- **Recommend:** REWRITE device-discovery/streaming transport against the Rust core/relay; REUSE presentation

### PUI-DIAG-001 — Diagnostics bundle (Settings→Privacy: collect/preview/upload/discard)

- **Surface (taxonomy category):** diagnostics
- **Card status:** `grounded-partial`
- **Migration class:** legacy-required-during-migration
- **Implementation strategy:** REUSE
- **Entrypoint:** Settings pane privacy → PrivacyDiagnosticsSection.tsx + PrivacyDiagnosticBundleControls.tsx. Six renderer-facing channels: diagnostics:getStatus/collectBundle/openBundlePreview/discardBundlePreview/uploadBundle/deleteBundle. The upload endpoint URL never crosses IPC (main reads it from a build-time constant/env var and POSTs itself) — a real, documented hardening decision, not incidental. Upload REQUIRES the user to have opened the retained preview file first; a retained bundle preview EXPIRES; edited preview-file contents on disk are ignored — main uploads only the retained ORIGINAL payload it collected, never re-reading the (possibly tampered) file.
- **Source anchor:** `src/renderer/src/components/settings/PrivacyDiagnosticsSection.tsx:1-40; src/main/ipc/diagnostics.ts:1-33 (channel list + hardening comment, header block)`
- **State:** activeBundleSubmissionId ref tracks the one retained, not-yet-uploaded bundle.
- **Action:** collect a bundle; open its preview; upload; discard; delete an uploaded bundle by ticket id.
- **Error:** upload without a main-collected bundle preview is rejected ('expired'); upload before opening the review file is rejected — CONFIRMED by test.
- **Recovery:** a declined upload confirmation resolves quietly ({canceled:true}) without calling the upload function; retained preview files are written with private permissions — CONFIRMED by test.
- **Backing handler(s):** `src/main/ipc/diagnostics.ts`; `src/main/observability/ (collectDiagnosticBundle, getDiagnosticsStatus, uploadDiagnosticBundle)`
- **Original test path(s):**
  - `src/main/ipc/diagnostics.test.ts` — evidence tier: **assertion-titles-read**, NOT executed this pass
    - rejects upload without a main-collected bundle preview (line 110, throws /expired/)
    - uploads only the payload retained by main after collection (line 116)
    - pins official builds to the compile-time diagnostics endpoint (line 138)
    - returns a quiet cancellation when the user declines upload confirmation (line 167)
    - rechecks the retained preview after upload confirmation (line 182)
    - ignores edited preview file contents and uploads the retained original payload (line 201, readFileSync NOT called)
    - requires opening the retained review file before sending (line 235, throws /open.*review file/)
    - discards retained bundle previews on request (line 247)
    - expires retained bundle previews without another diagnostics call (line 260)
    - writes retained preview files with private permissions (line 277)
- **Screenshot states still needed:** `SHOT-DIAG-01 (privacy pane, idle status)`, `SHOT-DIAG-02 (bundle collected, awaiting preview-open)`, `SHOT-DIAG-03 (upload confirm dialog)`
- **WP allocation:** primary `WP-UI-SETTINGS`, backing `WP-ENG-IPC`, `WP-CAP-DIAG`; test-port path `tests/parity/ports/WP-UI-SETTINGS/PUI-DIAG-001/**`
- **Remaining gaps (explicit work obligations, not implied-complete):**
  - src/main/observability/ module bodies not opened beyond the diagnostics.ts call sites; the 57-file WP-CAP-DIAG scope is far larger than this one IPC surface — this card covers only the Privacy-pane bundle flow, not the rest of WP-CAP-DIAG
- **Recommend:** REUSE the upload-endpoint-never-crosses-IPC and require-preview-open-before-send controls exactly — both are real, tested security/trust decisions, not incidental implementation detail

## 5. Test files verified but not (yet) carded

These test files were independently confirmed to exist and opened for real assertion titles this pass, resolving them to a WP via the manifest — but a full card was not written for their capability, to keep this checkpoint bounded. They are explicit remaining work, not silently dropped:

- `src/renderer/src/components/settings/SshTargetForm.test.tsx` → `WP-UI-SETTINGS`
- `src/renderer/src/components/settings/RuntimeEnvironmentsPane.test.ts` → `WP-UI-SETTINGS`
- `src/renderer/src/components/settings/shortcut-definition-catalog.test.ts` → `WP-UI-SETTINGS`
- `src/renderer/src/components/right-sidebar/FileExplorerNameFilter.test.tsx` → `WP-UI-WORK`
- `src/renderer/src/components/ports/WorkspacePortScanner.test.tsx` → `WP-UI-CORE`

## 6. Remaining gaps not carded at all

- Onboarding/Feature Tips/Plugin Catalog/Notifications (PUI-ONBOARD-001/PUI-FEATURETIPS-001/PUI-PLUGINCATALOG-001/PUI-NOTIF-001 in parity-ui-journeys.md §7) — fully traced there at journey level but NOT re-verified with a test file this pass; not carded here to keep this checkpoint bounded, carried forward as an explicit remaining obligation, not silently dropped.
- Web-mode preload shim (PUI-WEBMODE-001, 48 files) — third deployment target, scope-in-or-out decision explicitly not made by any document to date.
- Pets/Stats/Sparse-checkout/Quick-commands (PUI-PETS-001/PUI-STATS-001/PUI-SPARSE-001/PUI-QUICKCMD-001) — traced at entrypoint+IPC-file-list level in parity-ui-journeys.md §8 only.
- PUI-CONN-001 (SSH targets) and PUI-CONN-002 (remote Orca servers/runtime environments) were read and test-file-verified (SshTargetForm.test.tsx, RuntimeEnvironmentsPane.test.ts) but not written as separate cards this pass to keep the checkpoint bounded — see counts.testFilesVerifiedButNotCarded.
- PUI-KEYS-001/002 (keybinding catalog + shortcut UI) test-verified (shortcut-definition-catalog.test.ts) but not written as a separate card this pass for the same reason.
- components/right-sidebar/{FileExplorer,PortsPanel} and components/ports/WorkspacePortScanner — test-verified (FileExplorerNameFilter.test.tsx, WorkspacePortScanner.test.tsx) but not written as separate cards this pass.

## 7. Screenshot baseline (reference evidence only)

The 3 source-pinned screenshots in docs/migration/reference-captures/c9790628-light-empty are REFERENCE EVIDENCE ONLY (frozen empty-state captures at c9790628, light mode) — they establish a visual baseline for the shell/bots/meetings empty states, not proof of any capability above.

- `docs/migration/reference-captures/c9790628-light-empty/01-first-window-light.png`
- `docs/migration/reference-captures/c9790628-light-empty/02-bots-light.png`
- `docs/migration/reference-captures/c9790628-light-empty/03-meetings-light.png`

## 8. Legacy-required-during-migration vs. new postmigration requests

Every card in this checkpoint is tagged `legacy-required-during-migration` — all 28 capabilities carded here are EXISTING legacy functionality that must migrate with the rewrite, not new product asks, and none of them are deferred by this document — including cards with `implementation-strategy-undecided` fields. "Undecided" describes only HOW each will be reimplemented or how deep its verification currently goes, never WHETHER it must migrate. Three cards (Bots, Mentu, Meetings) additionally carry a `pendingPostmigration` note copied verbatim from `parity-work-packages.md`'s preservation rule (Bots: reactive adapters/delegation UI/trigger UX/flush barriers; Mentu: Qwen compat, recipe-81/90 follow-ups, rendered final check; Meetings: shared-spaces model) — those specific line items are the ONLY parts of this checkpoint's scope explicitly deferred to after migration, and only because the source-of-truth work-packages document already says so.

## 9. Mechanical citation verification (this pass)

A script re-opened every one of this document's line-anchored assertion citations against the frozen legacy checkout and confirmed the quoted `it()`/`describe()` title string actually appears at (or within a small tolerance of) the claimed line number. Result: 226 of 227 line-anchored citations matched exactly on first run; the single flagged item is an intentional non-line-anchored summary entry (PUI-TABS-001), not an error. One citation (PUI-DIAG-001) was found to be a paraphrase — "retained bundle preview file" vs. the source's actual "retained review file" — with a one-line off-by-one anchor, and was corrected to the verbatim source title and exact line. This check is mechanical (string/line matching only); it confirms a citation POINTS at real, matching source text, not that the underlying test currently passes — no test was executed.
