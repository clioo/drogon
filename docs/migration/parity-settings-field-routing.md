# Settings field routing — correction wave (source enumeration, not runtime parity)

Corrects `docs/migration/parity-settings-field-routing.json` per
`docs/migration/parity-audit-wave-review.md`. Frozen source
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`, read-only; checkout `d0ec650`.
The checked-in JSON is authoritative; its revision includes coordinator corrections.
No source module imported, no original test executed, no product/personal
state changed. 214 unique rows, unchanged from the prior wave; corrections
are to classification, citation and count accuracy only.

## 1. Corrections applied

- **`keybindings` false-positive citation fixed.** Prior anchor `App.tsx:29`
  was `import { useGlobalKeybindings } from './app-shell/use-global-keybindings'`
  — a substring hit on the *import path string*, not a `GlobalSettings.keybindings`
  read. Re-inspected the two other candidate sites: (a)
  `ShortcutsPane.tsx:58`/`use-settings-store-model.ts:36` read
  `state.keybindings` from `src/renderer/src/store/slices/keybindings.ts:12`
  (`KeybindingsSlice`), populated via `window.api.keybindings.*` IPC calls to
  the dedicated `KeybindingService`, not `GlobalSettings.keybindings`; (b)
  `browser-manager-bindings.ts:36/58` reads `this.settingsResolver?.().keybindings`,
  where `settingsResolver` is set at `main-process-account-services.ts:121`
  to `() => ({ keybindings: state.keybindings?.getOverrides() })` — `state.keybindings`
  there is `main-process-state.ts:89`'s `KeybindingService | null`, again the
  file-backed service. Both are genuine name collisions with the declared
  field (`KeybindingOverrides`, no builder default,
  `src/shared/global-settings-types.ts:272`). No code path reading/writing
  `GlobalSettings.keybindings` through the settings load/save pipeline was
  found. **Reclassified `internal-authority`** (dedicated non-settings-pipeline
  authority — the file-backed `KeybindingService`, not forced to `ui-consumer`),
  consistent with the original scanner's no-observed-reference result and the
  accepted `parity-settings-unobserved-contracts.md` narrative.
- **`defaultRepoSelection` citation fixed.** Prior anchor
  `use-task-page-repo-selection.ts:46` was a `// Why:` comment mentioning the
  field name, not code. Classification stands (`ui-consumer`) but the anchor
  now points to the genuine read, `const persisted = settings?.defaultRepoSelection`
  at line 52 (also used in the effect dependency array at line 61); genuine
  writes also exist at `task-page/github/ModeControls.tsx:83,97` and
  `task-page/gitlab/Filters.tsx:66,80`.
- **Counts recomputed programmatically from the final 214 rows**, not
  hand-typed. Corrected unobserved-cohort split: **6 reclassified ui-consumer**
  (`dismissedSkillFreshnessNudges`, `agentsSidebarIntroShown`,
  `agentsSidebarMigratedFromExperimental`, `experimentalAgentDashboardShowIdle`,
  `experimentalCompactWorktreeCards`, `browserSshWorkspaceRoutingProbeSkippedTargetIds`)
  / **4 held internal-authority** (`experimentalSidekick`, `gitlabProjects`,
  `tabSwitchKeybindingSeed`, `keybindings` — the last moved back into this
  bucket by the correction above). Prior wave's JSON hard-coded "4" reclassified
  and separately listed 7 names (the review's "four/seven... four/six... seven/three"
  inconsistency); the corrected, JSON-derived number is 6/4.
- **26 prefilter-miss citations inspected** (all fields whose only ui-consumer
  evidence came from a direct-name grep, i.e. missed by the
  GlobalSettings-token prefilter): **25 confirmed genuine** member-access
  reads/writes on a settings-shaped receiver (each cited with the exact
  code line and a one-line semantic quoted in the row's `note`, not asserted
  from the grep hit alone); **1 false positive** (`keybindings`, corrected
  above).

## 2. Evidence tiers (now explicit per row, field `evidenceTier`)

- `directly-read-verified` (**26 fields**): this wave (or the prior wave's
  prefilter-miss trace, re-checked here) opened the cited file and confirmed
  a genuine settings-shaped member access, not a name/import/comment/string
  substring match. Includes the 25 confirmed prefilter-miss fields plus the
  corrected `keybindings`.
- `reused-accepted-narrative` (**8 fields**): the remaining unobserved-cohort
  fields, classified from the coordinator-reviewed
  `parity-settings-unobserved-contracts.md` narrative, not independently
  re-read this wave beyond the direct-name grep cross-check already reported.
- `base-census-inherited` (**180 fields**): classification is a mechanical
  partition of `parity-settings-consumers.json`'s existing non-test reference
  paths (`src/renderer/**` → `ui-consumer`, `src/main`|`src/shared`-only →
  `internal-authority`); no source body was independently opened this wave
  or the prior one for these rows. This is reused base-census evidence, not
  a verified-body claim — do not read it as equivalent to the 26
  directly-read rows.

## 3. Counts (from final JSON, not asserted)

Total **214**; `ui-consumer` **185**; `internal-authority` **29**;
`unresolved` **0**. Evidence tiers: directly-read-verified **26**,
reused-accepted-narrative **8**, base-census-inherited **180**.

## 4. Zero unclassified rows does not mean zero uncertainty

Every one of the 214 rows carries at least one of: (a) a directly-read,
verified member-access citation, (b) a coordinator-accepted narrative
citation (unobserved-contracts.md), or (c) a non-test reference path from
the accepted `parity-settings-consumers.json` census. None of the 214 rows
lacked all three — the "unknown" risk this task warned against would be a
row with *no* located pointer in any tier; none exists here. This is not a
claim of zero unresolved semantics or a proof that a field is safe to remove.
The 180
base-census-inherited rows are the honest residual: their classification is
correct only to the confidence of the reused census pass (bounded AST
routing, not independently re-read), and any future wave should treat that
tier — not the whole file — as the remaining verification surface. Next
pointer for that tier: re-run the same direct-read spot-check used here
against the25 `internal-authority` base-census rows, since
that is exactly where this wave found its false positive and its 25
confirmed misses.

## 5. Fingerprints

`sourceFingerprints` in the JSON records sha256 for the 22 distinct source
files carrying a `directly-read-verified` citation (the 26 fields resolve to
22 distinct files since several share a file, e.g.
`use-terminal-workspace-foundation.ts` covers 4 fields). Reused base-census
input file hashes remain in the prior wave's `inputFiles` block, unchanged.

## 6. Reused by reference, not repeated

`docs/migration/parity-settings-persistence-contracts.json` (SP01–SP13) and
`docs/migration/parity-settings-unobserved-contracts.md` (10 reviewed
traces) are unchanged and reused by reference. This document does not claim
214-field semantic/behavioral closure, does not run any original test, and
does not close the E1/E2/E4 gates named in `parity-audit-wave-review.md`.

Coordinator independently verified all214 canonical names, the26 direct
citation neighborhoods,22 raw source fingerprints and the final tier counts.
The accepted scope is located field routing and the corrected service-vs-field
distinction. The180 inherited rows retain their lower evidence tier.
