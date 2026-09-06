# E5 — reconcile the existing G1–G20 platform register

Coordinator review from rewrite `43e90035`, against frozen source
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`. The JSON companion preserves
all twenty historical identifiers, scope, existing work-package owners,
evidence, remaining enumeration and concrete acceptance obligations.
Owners are responsibility allocations, **not live worker assignments**.

This replaces the old register as the current disposition of these IDs.
The original `parity-platform-audit.md` is an unaccepted local draft; its
names are retained in the committed JSON so handoff does not depend on that
untracked file. Its old partial-reading counts are not current totals.

## What changes the next action

| Disposition | IDs | Next action |
| --- | --- | --- |
| Bounded registry already present | G1–G4, G11, G15, G16 | Do not repeat censuses; carry semantic and execution obligations into owned contracts/test ports. |
| Enumerated with explicit attribution unknowns | G5, G6 | Keep factories/dynamic paths and legacy producer unknowns explicit; complete payload/state contracts under E3. |
| Bounded source contract characterized, owned followups remain | G7, G9, G10, G12, G20 | Preserve config/trust/serve, upload/consent, OS tray and parser/error distinctions; not a live runtime acceptance. G7 U1–U4 name remaining reviews. |
| Partial pointers, missing bounded contract reconciliation | G13, G14, G17–G19 | Read the specific dispatcher/client/state-machine bodies; unrelated registry counts cannot close these. |
| Source review still needed for this register | G8 | Resolve deployment/assets from actual entrypoints and packaging. No feature-absence inference. |

These categories total 20 IDs, not 20 product defects. E1–E4 still own their
broader contracts, and journey/capture reconciliation remains outside this
twenty-ID register. The audit is **not closed**, no hierarchy is launched,
and full tests-first/feature/installed-product gates are unchanged.

G12 now has a separate complete parser review in
`parity-orcad-launch-contract.md`: five ordinary options and one executable
smoke probe. The historical data-root flag premise was false; environment
selection and the distinct `orca serve` parser must remain separate.

Follow-up at6339736: G9/G10 source review accepted separately in
parity-diagnostic-tray-contracts.json/.md. The two diagnostic upload lanes
are distinct; the tray explicitly does nothing on Linux. Two unchanged mocked
HTTP cases pass; full redaction, server and native tray/package proof remain.
The baseline below is historical. Subsequent G7 coordinator review at129598f
adds33 unchanged serve parser cases: current total151 cases/15 capsules.
G7 v2 distinguishes23 direct reads from leaf assertion summaries;28 unique
fingerprints match both source checkout and pinned Git blobs. Its U1–U4
remain owned source/test-port obligations; config build entrypoints remain in scope.

## G16 source cross-check: management is not the stream bridge

Read both complete files below. The accepted bridge census already records
ten preload stream/UI methods and the following nineteen runtime RPC names:

`emulator.list`, `attach`, `tap`, `gesture`, `type`, `button`, `rotate`,
`exec`, `kill`, `shutdown`, `listSimulators`, `availability`, `listDevices`,
`install`, `launch`, `permissions`, `ax`, `logcat`, `unregisterActive`
(the emulator prefix applies to every listed suffix).

Every runtime-table handler delegates to the corresponding runtime method.
That is source routing, not proof that a device action succeeds. Schemas
include normalized tap coordinates; 2–64 gesture points; constrained rotation;
absolute install path; positive integer log lines; optional selectors; and
permissions grant/revoke requiring package+permission, reset rejecting truthy
package/permission. Empty strings are not universally rejected by these schemas.
Do not silently tighten original acceptance while porting.

| Source-relative file | SHA-256 |
| --- | --- |
| src/preload/api/emulator-bridge.ts | 52f0101e2f6f8eea41eaf4f02d038905ade986cf544c2bf16279b880ffa1add4 |
| src/main/runtime/rpc/methods/emulator.ts | 6fb458a3bd9806ae82a8e028027d4b90870a6becef183b84ed6053961076c3e2 |

No emulator, server, source module or original test was executed in this
review. Baseline remains 116 distinct original cases in 12 isolated capsules.
No product changes were integrated or installed by this documentation pass.

## Mentu upstream route remains part of implementation

If faithful integration needs a Mentu change, prepare a minimal upstream PR
in English with rationale, reproduction and tests. Discuss material scope
expansions; do not silently lower the product requirement or add a parallel
local workaround. Build/test the pinned PR revision locally without waiting
for merge. Keep local/upstream revisions and evidence in the handoff.

The demanding with/without Mentu comparison still uses Pi + DGX Spark only
for experimental inference, measuring real tokens. No inference_budget
enforcement requirement is introduced. A PR or agent success message is not
integration evidence. Recipes changed later still require the official skill
and check/doctor validation; this reconciliation does not edit a recipe.
