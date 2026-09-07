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

## Packaged dependencies

Dependency versions are fixed in Cargo.lock and pnpm-lock.yaml. Their licenses must accompany redistributed artifacts. Geist is consumed from `@fontsource-variable/geist` with its bundled SIL Open Font License. No Game of Thrones artwork is redistributed in this foundation.
