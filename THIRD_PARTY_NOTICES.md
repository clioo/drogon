# Third-party notices

## Orca

The Rust provider-session record/handle model and transition in
`crates/drogon-core/src/session_authority/`, its migrated tests, and its frozen
source-oracle cases derive from the same pinned Orca revision identified below.
Source paths, hashes and case mappings are recorded under
`tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/`.
The original MIT notice is retained below and in `tests/parity/ports/LICENSE.orca`.

The selected tokens in `apps/desktop/src/renderer/src/assets/main.css` and the Button/Input adaptations in `apps/desktop/src/renderer/src/components/ui/` derive from Orca's corresponding renderer files at source revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. The source migration inventories document additional behavior used as reference. Drogon does not include Orca's telemetry, update service, account credentials or runtime as an execution dependency.

The native Bot/Automation record and storage ports in
`crates/drogon-core/src/{bots,automations}` and their parity tests adapt the
same pinned Orca implementation. Source paths, hashes and remaining behavioral
gaps are recorded in `tests/parity/ports/WP-CAP-BOTS/native-state/case-map.json`
and `docs/migration/sol-wave/cap-bots/native-state.md`. The locale comparator
uses the ICU4X dependencies already pinned in Cargo.lock; their redistribution
licenses must be included in packaged dependency notices.

The command palette in `apps/desktop/src/renderer/src/components/command-palette/`
ports focus-restore, section render-cap and result-ranking logic from Orca's
`src/renderer/src/components/cmd-j/{palette-focus-restore-target,palette-section-render-cap,palette-query-tokens,palette-results}.ts`
and the `.jump-palette-item[data-selected='true']` recipe from
`src/renderer/src/assets/main.css`, all at the pinned source revision above.
Each ported file keeps the MIT notice in its header comment.

The bottom status bar in `apps/desktop/src/renderer/src/components/status-bar/`,
its usage readers in `apps/desktop/src/main/usage/` and the contract in
`apps/desktop/src/shared/usage-contract.ts` port Orca's
`src/renderer/src/components/status-bar/{StatusBarSurface,InlineProviderUsage,CaffeinateStatusSegment,PortsStatusSegment,ResourceUsageStatusSegment}.tsx`,
`resource-memory-metric-copy.ts`, `icons.tsx`, `tooltip.tsx`,
`src/renderer/src/lib/window-label-formatter.ts`, `settings/agent-awake-copy.ts`,
`src/shared/{rate-limit-types,rate-limit-reset-format,usage-percentage-display,claude-statusline-rate-limits}.ts`,
`src/main/rate-limits/{claude-usage-window,claude-oauth-credentials,claude-oauth-usage-request,codex-auth-presence,codex-rpc-rate-limit-probe,codex-rate-limit-window-classification,codex-rate-limit-window-mapper,codex-pty-status-parser}.ts`,
`src/main/codex-cli/codex-read-only-app-server-args.ts` and
`src/main/macos-system-sleep-assertion.ts`, all at the pinned source revision
above. Each ported file keeps the MIT notice in its header comment.

The shell sidebar, project/worktree cards and agent-state tab bar in
`apps/desktop/src/renderer/src/features/shell/` port Orca's
`src/renderer/src/components/{AgentWorkingSpinner,AgentStateDot,AgentQuestionIcon}.tsx`,
`components/sidebar/{SidebarNav,index,SidebarSettingsHelpMenu,SidebarHeader,worktree-card-surface,worktree-card-header}.tsx`,
`components/tab-bar/SortableTab.tsx` and the worktree-card/agent-spinner CSS
recipes. The Settings surface in `apps/desktop/src/renderer/src/features/settings/`
ports `components/settings/{SettingsSidebar,SettingsSection,SettingsFormControls,ShortcutRowsList}.tsx`.
All at the pinned source revision above; each ported file keeps the MIT notice.

The Bots page in `apps/desktop/src/renderer/src/features/bots/` and the operating
prompt composer in `crates/drogon-core/src/bots/prompt.rs` port the Drogon fork's
`src/renderer/src/components/bots/{BotCharacterPicker,BotCreationForm,BotsPage}.tsx`
and `src/shared/{drogon-bot-characters,drogon-bot-prompt}.ts` (fork revision
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Character artwork was not
copied; avatars are initials on a disc. The Tasks page in
`apps/desktop/src/renderer/src/features/tasks/` follows the structure of Orca's
`src/renderer/src/components/task-page/**`. Each ported file keeps the MIT notice.

MIT License

Copyright (c) 2026 Lovecast Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The session environment and `drogon-cli` shims in
`crates/drogon-core/src/session_env.rs` port the shape of Orca's
`src/main/daemon/pty-subprocess/spawn-environment.ts`,
`src/main/cli/{linux-terminal-orca-cli-shim,bundled-cli-launcher-path,linux-bare-orca-dispatcher}.ts`
and `config/scripts/dev-cli-terminal-wrapper.mjs`, with DROGON_* names and
TERM_PROGRAM=Drogon. The Mentu runtime, recipe and run-record handling in
`crates/drogon-core/src/mentu/` and the panel in
`apps/desktop/src/renderer/src/features/mentu/` adapt the Drogon fork's
`src/main/mentu/{mentu-cli-process,mentu-session-launch,mentu-run-parsing,mentu-runtime-identity,mentu-recipe-files}.ts`
and `src/renderer/src/components/mentu/{MentuPanel,RecipePaneHeader}.tsx`
(fork revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported
file keeps the MIT notice in its header comment.

The Bots responsibility cards, forms and detail flow in
`apps/desktop/src/renderer/src/features/bots/{BotResponsibilityCard,BotsPageForms,BotsPanel}.tsx`
port the Drogon fork's `src/renderer/src/components/bots/{BotResponsibilityCard,BotsPageForms,BotsPage}.tsx`
and `use-bots-page-controller.ts`; the native responsibility RPCs in
`crates/drogon-core/src/bot_mutation_rpc.rs` and `bots/storage.rs` adapt
`src/shared/drogon-bot-contract.ts` and `src/main/bots/bot-service.ts` (fork
revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, MIT). Each ported file
keeps the MIT notice in its header comment.

The right sidebar activity bar and host in
`apps/desktop/src/renderer/src/features/right-sidebar/`, the tab strip and
its static create menu in `features/shell/{TabBar,TabCreateMenu,tab-chrome}.tsx`
and the browser strip tab in `features/browser/BrowserStripTab.tsx` port Orca's
`src/renderer/src/components/right-sidebar/{activity-bar-buttons,index,right-sidebar-top-activity-bar}.tsx`,
`right-sidebar-width.ts`, `use-right-sidebar-activity-items.ts`,
`src/renderer/src/store/right-sidebar-route.ts`,
`src/renderer/src/components/tab-bar/{TabBar,tab-bar-surface,tab-bar-static-create-menu,SortableTab,BrowserTab,drop-indicator,tab-width-rules}.tsx`
and the sidebar chords of `src/shared/keybindings/definitions-core-1.ts`, all at
the pinned source revision above. Each ported file keeps the MIT notice.

## Bundled fonts

Both fonts bundled under `apps/desktop/src/renderer/src/assets/fonts/` are licensed under the SIL Open Font License, Version 1.1; the full license texts ship next to the files.

- `Geist-Variable.woff2` — Geist, Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font). License: `apps/desktop/src/renderer/src/assets/fonts/Geist-OFL.txt`.
- `SymbolsNerdFontMono-Regular.woff2` — Symbols Nerd Font Mono, Copyright (c) 2014, Ryan L McIntyre (https://ryanlmcintyre.com). License: `apps/desktop/src/renderer/src/assets/fonts/SymbolsNerdFontMono-OFL.txt`.

## Packaged dependencies

Dependency versions are fixed in Cargo.lock and pnpm-lock.yaml. Their licenses must accompany redistributed artifacts. Geist is bundled directly as `Geist-Variable.woff2` under the SIL Open Font License (see "Bundled fonts" above). No Game of Thrones artwork is redistributed in this foundation.
