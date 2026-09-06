# UI surface reconciliation (14 cards, pointers only)

Checkpoint, not closure. Frozen source `c9790628` read-only.
Method: grep of `describe/it` declaration lines + `shasum -a 256`.
No body opened beyond declaration lines, no tests executed,
no screenshots. Declaration titles are NAMES, not proof of semantics.
Full hashes/titles: companion JSON. Bots/Mentu/Meetings 45 untouched.

Coordinator acceptance is limited to pointer reconciliation: independently
checked72 structured source paths,30 structured source fingerprints and187
named declaration anchors (within their recorded line plus four continuation
lines), with no mismatches. Another41 entries have line-only anchors, not
transcribed names. These checks do not execute or read assertion bodies.
All14 existing IDs map the six named gaps and five previously uncarded test
pointers; runtime/per-state obligations and the separate KEYS-002 link remain.

## Rows (all: pointers-located; closure-not-claimed)

| Card | Located pointers | Per-state body/runtime debt |
|---|---|---|
| PUI-ONBOARD-001 | OnboardingFlow (7 titles), flow-persistence test (4 titles) | relaunch no-reshow; skip-confirm persist effect |
| PUI-FEATURETIPS-001 | gate test (7 named + 7 line-only), CmdJ dialog (4) | tour resume-after-restart; per-tip siblings |
| PUI-PLUGINCATALOG-001 | browser (5), consent (9 titles) | malformed-capability fail-closed; rollback restore |
| PUI-NOTIF-001 | fanout (8), NotificationStep (8) | force re-probe; focus suppression; NotificationsPane |
| PUI-WEBMODE-001 | composition (2), runtime-client (7 named + 10 line-only) | per-domain projection (~29 files); degradation msg |
| PUI-PETS-001 | agent-state (7 named + 7 line-only), bundle (8) | symlink/oversize rejection bodies unlocated |
| PUI-STATS-001 | StatsPane located; getSummary shape read; async-save (7) | pane render; IPC round-trip; RED-GREEN |
| PUI-SPARSE-001 | section (1), repos-sparse (5), worktree sparse (8) | settings-vs-worktree consistency; add/edit/delete UI |
| PUI-QUICKCMD-001 | pane (5), tab-bar trigger (7 named + 4 line-only) | cross-surface scope-visibility; menu list render |
| PUI-CONN-001 | SshTargetForm (9); 3 startup test files located | startup bodies; passphrase/destructive dialogs |
| PUI-CONN-002 | environments (11); 2 pairing test files located | pairing end-to-end; access grants |
| PUI-KEYS-001 | catalog copy (2); groups/visibility/filter siblings | rebind-persist bodies; catalog re-count |
| PUI-FILEEXP-001 | filter widget (2); projection (2); row-actions (8) | row/tree bodies + RED-GREEN |
| PUI-PORTS-001 | scanner (10); panel (11); port-sections (2) | SSH-forward dialog (no located test); pickers |

PUI-KEYS-002 (Shortcut settings UI, `ShortcutsPane.tsx:51` + 7 sibling
components) stays SEPARATELY linked under KEYS-001, never merged,
never closed by catalog-copy declarations.

## Corrections to the prior revision

- Path: `RuntimePairingUrlGenerator.test.ts` -> `.test.tsx`
  (hash verified against the `.tsx` file).
- Hash typo fixed: `file-explorer-name-filter-projection.test.ts`.
- Tier: `repos-sparse-presets.test.ts` path-existence-only ->
  assertion-titles-read (5 declaration names observed).
- Presence (files confirmed, semantics NOT proved by names):
  `StatsPane.tsx` exists; 3 startup SSH test files exist;
  2 pairing test files exist; 20+ `file-explorer-*.test` files exist;
  `PortsPanel.test.tsx` + port-sections test exist.
- Language: `assertionsObserved` replaced by `testDeclarationAnchors`;
  "coverage is stronger" and all 14 `named-surface-closed` verdicts
  removed. Titles transcribed verbatim where seen; `title:null`
  means line-located only, no semantic claim.
- SSH docs read: `ssh-execution-boundary.md` (live/unverifiable/exited),
  `ssh-reconnect-source-recovery.md`, `remote-wire-compatibility.md`.

## Gap/test-pointer map

6 gaps -> 14 IDs: gap0 onboard/tips/plugins/notif (4 cards),
gap1 webmode, gap2 pets/stats/sparse/quickcmd (4),
gap3 conn (2), gap4 keys (KEYS-001 + KEYS-002 link),
gap5 fileexp/ports (2). 5 test pointers ->
CONN-001, CONN-002, KEYS-001, FILEEXP-001, PORTS-001.

## Debt explicit (not blockers)

Bodies, RED-GREEN (T1-T3), rendered journeys, SSH/remote/version-skew
proof (T4) remain owed per gate-ledger E1. Missing receipts are
execution debt, never proof of non-enumeration.
