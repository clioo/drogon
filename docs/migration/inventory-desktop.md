# Drogon Desktop Subsystems Migration Inventory

**Document Version:** 1.1.0

**Date:** 2026-09-05

**Target Repository:** `/Users/carlos/Documents/Drogon-rewrite`

**Migration Reference:** `/Users/carlos/Documents/Drogon-mentu-session` (read-only reference)
**Architecture:** Rust core daemon with versioned contracts; isolated Electron/React renderer reusing Orca visual grammar (`docs/STYLEGUIDE.md`, `src/renderer/src/assets/main.css`).

> [!NOTE]
> **Performance & Verification Principle:** Source presence is not measured performance. Prior claims of 60fps rendering, <100ms tree loading, or current test suite pass rates (e.g. 35/35) are unverified in this rewrite and have been removed. All tests referenced below represent **historical test suites** in the legacy repository; they serve as regression anchors, not proof of rewrite correctness.

---

## 1. Session Shell
- **Source Anchors:** `src/renderer/src/App.tsx:35-105` (root layout, window insets), `src/renderer/src/app-shell/AppWorkspaceShell.tsx:95-256` (3-column layout), `src/renderer/src/app-shell/app-window-chrome.ts:1-75` (`MAC_TRAFFIC_LIGHTS_WIDTH = '80px'`, `WINDOW_CONTROLS_WIDTH = '138px'`).
- **Historical Tests:** `shutdown-checkpoint-persist.test.ts:1-95`, `reconcile-hydrated-workspace-tab-models.test.ts:1-110`, `TabGroupSplitLayout.test.ts:1-150`.
- **Strategy:** **REUSE** renderer 3-column shell, tab bar, and CSS token bindings. **REWRITE** session persistence and window chrome IPC handlers in the Rust core service daemon.
- **Parity Acceptance:** Mac launches with 80px traffic-light gutter; workspaces and split tab states restore identically without orphan tabs.

## 2. Terminal / xterm
- **Source Anchors:** `src/renderer/src/lib/pane-manager/pane-dom-creation.ts:22-100` (xterm Terminal & addon setup), `src/renderer/src/lib/pane-manager/pane-lifecycle.ts:1-150` (resize observer, safe fit), `src/renderer/src/components/terminal-pane/TerminalPane.tsx:1-120`, `terminal-link-provider-guard.ts:1-75` (crash guard).
- **Historical Tests:** `pane-dom-creation.test.ts:1-85`, `terminal-tab-actions.test.ts:1-110`, `TerminalProcessExitOverlay.test.tsx:1-90`, `terminal-link-provider-guard.test.ts:1-60`.
- **Strategy:** **REUSE** xterm renderer, FitAddon, IME positioning, and crash guards. **REWRITE** backend PTY spawner/stream coordinator in Rust core (`portable-pty`), replacing `node-pty`.
- **Parity Acceptance:** Window resize sends bounded geometry packets without reflow corruption; process termination shows exit overlay with restart action.

## 3. Explorer
- **Source Anchors:** `src/renderer/src/components/right-sidebar/FileExplorer.tsx:31-120` (root container), `src/renderer/src/components/right-sidebar/FileExplorerFilesTreePane.tsx:1-160` (virtualized tree viewport), `src/renderer/src/components/right-sidebar/FileExplorerRow.tsx:1-150` (file row & git decoration tokens).
- **Historical Tests:** `FileExplorerToolbar.test.tsx:1-90`, `FileExplorerNameFilter.test.tsx:1-110`, `useFileExplorerWatch.test.ts:1-80`.
- **Strategy:** **REUSE** FileExplorer React components and virtualized row projection. **REWRITE** filesystem traversal and watcher in Rust core (`notify`), eliminating Node.js `fs` calls.
- **Parity Acceptance:** Root tree loads lazily; name filter auto-expands matching ancestors; external file touches update tree via watcher without resetting scroll.

## 4. Source-Control / Checks
- **Source Anchors:** `src/renderer/src/components/right-sidebar/SourceControl.tsx:1-62`, `source-control/panel/panel.tsx:1-180` (staging file lists), `source-control/commit/commit-area.tsx:1-160` (commit input & shortcut), `ChecksPanel.tsx:1-192` (PR review header & CI run status).
- **Historical Tests:** `CommitArea.test.tsx:1-120`, `SourceControl.commit-drafts.test.ts:1-90`, `ChecksPanel.review-header.test.tsx:1-115`.
- **Strategy:** **REUSE** SourceControl, CommitArea, and ChecksPanel UI components. **REWRITE** Git command execution in Rust core adhering to Git 2.25+ baseline and bounded scans.
- **Parity Acceptance:** File edits appear under Changes; stage moves to Staged; `Cmd+Enter`/`Ctrl+Enter` commits locally; CI checks populate with status pips.

## 5. Harness Picker
- **Source Anchors:** `src/renderer/src/components/agent/AgentCombobox.tsx:35-180` (fuzzy cmdk popover), `src/renderer/src/lib/agent-catalog.tsx:19-150` (catalog schema & CLI probes), `src/shared/tui-agent.ts:1-40` (agent union), `DrogonQuickSession.tsx:12-39` (scratch folder session launch).
- **Historical Tests:** `AgentCombobox.test.tsx:1-130`, `agent-catalog-links.test.ts:1-75`, `DrogonQuickSession.test.tsx:1-85`.
- **Strategy:** **REUSE** AgentCombobox, agent catalog schemas, and Quick Session button. **REWRITE** PATH detection and process launching in the Rust service daemon.
- **Parity Acceptance:** Combobox filters agents; setting default persists across restarts; Quick Session provisions scratch directory and spawns harness.

## 6. Bots
- **Source Anchors:** `src/renderer/src/components/bots/BotsPage.tsx:1-150`, `BotCreationForm.tsx:10-120`, `src/shared/drogon-bot-contract.ts:1-120`, `src/main/bots/bot-service.ts:23-160` (L140 explicitly rejects reactive execution: disconnected adapters).
- **Historical Tests:** `BotsPage.test.tsx:1-140`, `drogon-bot-contract.test.ts:1-110`, `drogon-bot-prompt.test.ts:1-95`, `bot-reactive-dispatch.test.ts:1-120`.
- **Strategy:** **REUSE** BotsPage UI, character picker, and prompt synthesis. **REWRITE** bot persistence/scheduled service in Rust. **DEFER** reactive triggers pending event adapters.
- **Parity Acceptance:** Bot creation with character preset compiles system prompt; scheduled responsibility registers in automation scheduler.

## 7. Meetings
- **Source Anchors:** `src/renderer/src/components/meetings/MeetingsPage.tsx:41-129`, `MeetingTranscriptRow.tsx:1-110`, `src/shared/drogon-meeting-contract.ts:1-110`, `src/main/meetings/write-that-down-bridge.ts:55-180` (reads `~/Transcripts`).
- **Historical Tests:** `MeetingsPage.test.tsx:1-130`, `write-that-down-bridge.test.ts:1-120`, `write-that-down-ipc.test.ts:1-85`.
- **Strategy:** **REUSE** MeetingsPage UI and query workflows. **REWRITE** Markdown transcript scanner in Rust core.
- **Parity Acceptance:** Transcript Markdown files from `~/Transcripts` list with date and topic; "Open as Workspace" mounts folder in left sidebar.

## 8. Mentu Pane
- **Source Anchors:** `src/renderer/src/components/mentu/MentuPanel.tsx:27-180` (sidebar inspector), `RecipePane.tsx:1-150` (workbench tab), `recipe-pane-views.tsx:54-250` (DAG & Evidence view with retry folding), `.mentu/mentu-runtime-lock.json` (runtime v0.4.0).
- **Historical Tests:** `recipe-retry-evidence.test.tsx:1-252` (historical retry folding & unique key suite), `session-mentu-surface.test.tsx:1-150`.
- **Strategy:** **REUSE** MentuPanel, RecipePane, and retry folding UI. **REWRITE** execution spawner in Rust. **DEFER** Comparison v2 until upstream Qwen profile bug is fixed.
- **Parity Acceptance:** Step DAG renders dependencies; retried steps collapse prior attempts under `<details>`; "Open full tab" synchronizes state.

---

## 9. Comprehensive Subsystem Inventory Summary

| Subsystem | Primary Source Anchors | Historical Test Anchors | Keep / Reuse / Rewrite / Defer | Primary Dependencies | Rewrite Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Session Shell** | `App.tsx:35-105`<br>`AppWorkspaceShell.tsx:95-256`<br>`app-window-chrome.ts:1-75` | `shutdown-checkpoint-persist.test.ts:1-95`<br>`reconcile-hydrated-workspace-tab-models.test.ts:1-110` | **REUSE** renderer shell & CSS.<br>**REWRITE** persistence & IPC in Rust. | React 19, Radix UI, main.css | Functional in legacy source; pending Rust IPC bridge. |
| **2. Terminal / xterm** | `pane-dom-creation.ts:22-100`<br>`pane-lifecycle.ts:1-150`<br>`TerminalPane.tsx:1-120` | `pane-dom-creation.test.ts:1-85`<br>`terminal-tab-actions.test.ts:1-110` | **REUSE** xterm renderer & guards.<br>**REWRITE** backend PTY host in Rust. | `@xterm/xterm`, FitAddon | PTY spawner moving from Node.js to Rust daemon. |
| **3. Explorer** | `FileExplorer.tsx:31-120`<br>`FileExplorerFilesTreePane.tsx:1-160`<br>`FileExplorerRow.tsx:1-150` | `FileExplorerToolbar.test.tsx:1-90`<br>`useFileExplorerWatch.test.ts:1-80` | **REUSE** virtual tree UI.<br>**REWRITE** file scanner/watcher in Rust. | Radix ContextMenu, Lucide | File operations moving to Rust daemon. |
| **4. Source-Control / Checks** | `SourceControl.tsx:1-62`<br>`panel.tsx:1-180`<br>`ChecksPanel.tsx:1-192` | `CommitArea.test.tsx:1-120`<br>`ChecksPanel.review-header.test.tsx:1-115` | **REUSE** staging & checks UI.<br>**REWRITE** Git service in Rust. | Git binary (2.25+), Radix UI | Direct Node git exec moving to Rust capability cache. |
| **5. Harness Picker** | `AgentCombobox.tsx:35-180`<br>`agent-catalog.tsx:19-150`<br>`tui-agent.ts:1-40` | `AgentCombobox.test.tsx:1-130`<br>`DrogonQuickSession.test.tsx:1-85` | **REUSE** combobox & catalog UI.<br>**REWRITE** PATH detection & launch in Rust. | `cmdk`, Radix Popover, agent icons | Harness discovery moving to Rust service. |
| **6. Bots** | `BotsPage.tsx:1-150`<br>`BotCreationForm.tsx:10-120`<br>`bot-service.ts:23-160` | `BotsPage.test.tsx:1-140`<br>`bot-reactive-dispatch.test.ts:1-120` | **REUSE** UI & prompt compiler.<br>**REWRITE** scheduled service in Rust.<br>**DEFER** reactive triggers. | Character presets, automation scheduler | Scheduled service moving to Rust; reactive disconnected. |
| **7. Meetings** | `MeetingsPage.tsx:41-129`<br>`write-that-down-bridge.ts:55-180`<br>`drogon-meeting-contract.ts:1-110` | `MeetingsPage.test.tsx:1-130`<br>`write-that-down-bridge.test.ts:1-120` | **REUSE** UI & query workflow.<br>**REWRITE** transcript scanner in Rust. | `~/Transcripts` directory, Radix Input | File scanner moving to Rust core. |
| **8. Mentu Pane** | `MentuPanel.tsx:27-180`<br>`RecipePane.tsx:1-150`<br>`recipe-pane-views.tsx:54-250` | `recipe-retry-evidence.test.tsx:1-252`<br>`session-mentu-surface.test.tsx:1-150` | **REUSE** panel, tab & retry UI.<br>**REWRITE** execution in Rust.<br>**DEFER** Comparison v2 until Qwen fix. | `mentu-recipes` binary (0.4.0), Pi CLI | UI retry folding verified in source; engine moving to Rust. |

---

## 10. Implementation Sequence
1. **Preserve Visual Grammar:** Retain `src/renderer/src/assets/main.css`, Tailwind theme bindings, and existing component primitives without visual redesign.
2. **Implement Core Protocol v1:** Enforce typed, bounded IPC contracts between renderer and Rust core daemon over local domain sockets/named pipes.
3. **Prove Terminal & Workspace Slice:** Validate real workspace add/list, session create/read/write/resize/close, and connection failure/recovery before expanding to subsequent subsystems.
4. **Enforce Boundary Isolation:** Renderer communicates strictly via narrow typed preload bridge; no host execution, direct filesystem access, or Node APIs in renderer.
