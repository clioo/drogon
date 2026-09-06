# Flat audit wave: coordinator review queue

Base c2cb4d2; source c97906287bb7a390b25e2025b600d9fb3c25d9c3.
Audit remains open. Worker completion is not coordinator acceptance.
No new worktree, implementation wave or nested lead was launched here.

All three exact dispatches in run_d97e86c69c2e reported succeeded and were
processed/released. Orca retained their pre-existing terminals with
`external_terminal`; no process action occurred and no worker owns a new
assignment. Deliveries5e2ee17815b8 and1a1a4b95b048 were acknowledged after
release decisions. Do not treat retained terminals as active writers.

| Scope / files under docs/migration | Task / dispatch | Model |
| --- | --- | --- |
| parity-settings-field-routing.json/.md | task_3511363cecc2 / ctx_aa6c8bbf2b3f | Claude Sonnet5 medium |
| parity-cli-workspace-contracts.json/.md | task_a3b252be24ff / ctx_7ff13cf9a6a1 | GLM5.3Flash |
| parity-ui-surface-reconciliation.json/.md | task_10bce38f2cc1 / ctx_44ffc68128b4 | MuseSpark1.3Contributor |

The six deliverables remain uncommitted drafts pending review; do not use
their classifications or closure labels to close E1/E2/E4. Coordinator owns
their acceptance now; any new correction dispatch must explicitly transfer
only its two files. The old task_4eea43d17c1b ready label does not imply a live
worker: ctx_065fb345b12b was failed/operator-closed with capability revoked and
its terminal absent. Historical task_a7ae05f3dc15 is the controlled-cancellation
blocked test, not a current audit writer.

## Independent checks and concrete corrections needed

- Settings: 214 unique rows exactly match canonical names, no missing/extra.
  This proves allocation only. The report counts four UI/seven listed cohort
  fields inconsistently (JSON says four/six; listed names imply seven/three).
  More importantly, `keybindings` cites App.tsx:29: that is an import of
  `useGlobalKeybindings`, not a read of GlobalSettings.keybindings. Substring
  name matches cannot establish authority/consumer identity. Reuse the
  previously accepted ten traces and SP01-SP13, then correct routing with
  genuine field-use evidence or mark unresolved; do not force zero unknowns.
  No direct-source fingerprints accompany the additional references; bind
  accepted corrections to actual files/anchors, not merely input-JSON hashes.
- UI: 14 unique existing IDs; checked29 structured path/hash pairs. One path
  is wrong: RuntimePairingUrlGenerator.test.ts must end in .tsx; the recorded
  hash matches the actual .tsx file. “Bodies read” in the summary conflicts
  with the final method/testExecution labels (title-only) and rows retaining
  unread test debts. `assertionsObserved` locations are frequently test
  declarations, not assertion-body proof. Correct evidence tiers and retain
  narrower existing-ID pointers without accepting all14 closure verdicts.
- CLI: 13 unique commands, all31 structured file/hash pairs checked match.
  No full handler/assertion-body independent acceptance yet. Review defaults,
  flag conflicts, host/folder path behavior and output shapes from actual
  bodies. Hash equality alone does not establish the proposed semantics.

This queue is finite review work, not a demand to repeat every prior census.
Accepted coordinator work in the same turn is separate:
parity-bridge-import-factory-correction.md, regenerated scanner artifacts,
37 scanner tests and two unchanged original usage-provider test cases.

After bounded E1-E5 reconciliation and audit acceptance, use the authorized
Astra → Sol domain leads → disjoint leaf worktrees/PRs. A lead plans its test
ports against the accepted common base before implementing features. No
additional approval is required for that already-authorized arrangement.
