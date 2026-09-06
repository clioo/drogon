# Parity UI: Remaining Named-Surface Cards (bounded enumeration checkpoint)

Machine-readable record: `docs/migration/parity-ui-remaining-surface-cards.json`
(schema `drogon.audit.parity-ui-remaining-surface-cards.v1`).

Coordinator review boundary: these are named-surface checkpoints, not complete
capability proof. Each `missingInvariant` is an obligation to characterize the
original behavior before deciding the assertion; proposed expectations do not
authorize new product behavior. Missing filenames do not prove global absence
of coverage. Two unread parameterized-table notes were removed from the quoted
assertion count (113 → 111) and retained as structure notes in the JSON.

This document closes the **named-surface enumeration omissions** listed in
`docs/migration/parity-ui-capability-cards.json`'s `remainingGapsNotCarded` and
`testFilesVerifiedButNotCarded` fields (that file is **read-only input** to
this document and was **not modified**; nor were `parity-ui-audit.md` or
`parity-ui-journeys.md`, which served as pointers). It does **not** claim
complete capability-state proof for any of the 14 surfaces below — each
card names its own remaining gaps and `missingInvariants` explicitly.

- Legacy source: `/Users/carlos/Documents/Drogon-mentu-session` (read-only)
- Legacy pinned HEAD: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
- No test/app/harness was executed to produce this document. No source
  module was imported or evaluated. No writes were made outside this
  document's own JSON/MD pair.

## Scope of this pass

All **14** named surfaces are covered, each with `migrationClass:
legacy-required-during-migration` — **none received a scope-in/out decision
or DEFER**, including web-mode, per this task's explicit instruction:

| # | Card ID | Title |
| --- | --- | --- |
| 1 | `PUI-ONBOARD-001` | First-run onboarding flow |
| 2 | `PUI-FEATURETIPS-001` | Contextual feature-tip system |
| 3 | `PUI-PLUGINCATALOG-001` | Plugin marketplace catalog, consent, rollback/remove |
| 4 | `PUI-NOTIF-001` | Native notification delivery, permission probing, mobile fanout |
| 5 | `PUI-WEBMODE-001` | Web-mode preload shim (browser deployment target) |
| 6 | `PUI-PETS-001` | Status-bar pet segment, bundle import, agent-state animation |
| 7 | `PUI-STATS-001` | Stats settings pane and collector |
| 8 | `PUI-SPARSE-001` | Sparse-checkout presets (per-repo settings + worktree-creation-time) |
| 9 | `PUI-QUICKCMD-001` | Quick commands (Settings definition + tab-bar trigger) |
| 10 | `PUI-CONN-001` | SSH target management |
| 11 | `PUI-CONN-002` | Remote Orca servers / runtime environments |
| 12 | `PUI-KEYS-001` | Static keybinding catalog + shortcut settings UI (covers PUI-KEYS-001/002) |
| 13 | `PUI-FILEEXP-001` | File explorer (right-sidebar tree, name filter, row context menu) |
| 14 | `PUI-PORTS-001` | Local & SSH port forwarding panel + workspace port scanner |

## Methodology

Each card was built from three sources, never conflated:

1. **The existing journey/audit-document pointer** for that surface
   (`parity-ui-journeys.md` §7/§8, `parity-ui-audit.md` §5/§7/§9).
2. **A fresh read of the primary entry-point source file(s)** at exact line
   anchors, each with an **independently computed SHA-256**
   (`shasum -a 256`, not reused from any prior document without cross-check).
3. **A fresh grep+read of that surface's concrete test file(s)** to quote
   actual `describe`/`it` assertion titles with line numbers.

A path/file/directory census (e.g. "12 files present") is **explicitly not
treated as observable-surface proof** anywhere in this document. Several
cards state directly that most of a component subtree's files have **no**
verified test coverage identified this pass (e.g. `PUI-FILEEXP-001`: only 1
of 12 files has a found test; `PUI-PORTS-001`: only the data layer, not the
panel UI, is covered).

Three evidence tiers, matching the sibling capability-cards document's own
discipline:

- **`path-existence-only`** — file confirmed to exist, body not opened.
- **`assertion-titles-read`** — file opened, specific `it()`/`describe()`
  titles quoted with line numbers. This is inspection of test **text**, not
  proof a test currently passes.
- **`executed`** — a test was actually run. **Never used in this document.**

WP allocation for each cited test file was resolved by looking up that exact
path in `parity-test-work-packages.json`'s `packages[].files[]` manifest — a
file not found there is recorded as such (`NOT-IN-ANY-WP-PACKAGE`), not
guessed.

## Counts

- **14** cards, covering **14** named surfaces (100% of this pass's scope).
- **13** cards `grounded-partial`; **1** (`PUI-STATS-001`) remains
  `proposal-not-dispatchable` — its only test file
  (`stats-title-detection-independence.test.ts`) verifies an architectural
  import-isolation invariant, not the pane's actual functional behavior.
- **21** original test files cited: **20** `assertion-titles-read`, **1**
  `path-existence-only` (`repos-sparse-presets.test.ts`), **0** `executed`.
- **111** individual assertion titles quoted with line numbers
  across those 21 files.
- **19** `missingInvariants` recorded across all 14 cards (every card has at
  least one named, unverified obligation — none claims closure).
- **14** of 14 cards have `implementationStrategy:
  implementation-strategy-undecided` — this pass establishes evidence, it
  does not make reuse/rewrite decisions.

## Cross-check against the owning document

Every entry in `parity-ui-capability-cards.json`'s `remainingGapsNotCarded`
and `testFilesVerifiedButNotCarded` arrays is now carded:

- Onboarding/Feature Tips/Plugin Catalog/Notifications → 4 cards.
- Web-mode preload shim → 1 card, **not** scope-decided, **not** deferred.
- Pets/Stats/Sparse-checkout/Quick-commands → 4 cards (Stats is the one
  `proposal-not-dispatchable` card, per its thin evidence — not because its
  migration requirement is in question).
- PUI-CONN-001 (SSH targets) / PUI-CONN-002 (runtime environments) → 2 cards.
- PUI-KEYS-001/002 (keybinding catalog + shortcut UI) → 1 combined card
  (they share one entrypoint file and one test file).
- File explorer / Ports panel / WorkspacePortScanner → 2 cards
  (`PUI-FILEEXP-001`, `PUI-PORTS-001`).

## Notable findings surfaced this pass

- **`PUI-STATS-001`** has the weakest evidence of any card in this
  document: its one identified test file proves stats code doesn't import a
  title-based agent detector — an architectural boundary, not a behavioral
  proof of what the pane actually shows. The pane's own component file was
  not located this pass.
- **`PUI-WEBMODE-001`**: only 2 of roughly 30 `web-preload-api-*.test.ts`
  files were opened. The "every Electron-path capability has some web
  projection" claim from `parity-ui-journeys.md` §8 remains a carried-forward
  claim, not independently re-verified per domain here.
- **`PUI-CONN-001`** (SSH): the add/edit form has strong (9-assertion)
  dialog-lifecycle coverage, but the **startup reconnect-or-degrade-to-
  `unverifiable`** path — the surface's most AGENTS.md-relevant behavior — has
  no verifying test identified at all.
- **`PUI-PORTS-001`**: the scanner **data layer** has unusually precise
  11-assertion coverage (throttle rules, stale-data handling, focus
  supersession, atomic pruning), but the **panel UI** itself — including the
  actual SSH-forward add/remove action — has no verified test file
  identified this pass. Coverage of the data layer must not be read as
  coverage of the panel.
- **`PUI-PLUGINCATALOG-001`**: `PluginRollbackDialog.tsx` and
  `PluginRemoveDialog.tsx` — the two dialogs whose separate existence proves
  rollback is a first-class, distinct capability — have **no** test files at
  all (confirmed by direct `find` search, not just "not opened").

## What this document does not claim

- It does not claim all-state proof for these 14 surfaces — this is
  enumeration closure only. Each card's `gaps`/`missingInvariants` are the
  next bounded task, not silently implied as closed by this document.
- It does not claim, and did not need, ownership of or changes to
  `docs/migration/parity-ui-capability-cards.json`'s own 28 existing cards.
- `components/settings/`'s ~600 top-level files remain almost entirely
  unopened, unchanged by this pass — still the single largest named gap in
  the whole UI audit trail (per `parity-ui-audit.md` §6).
