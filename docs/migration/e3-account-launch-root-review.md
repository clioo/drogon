# E3 account launch preparation — root review

Root accepts **AL-C01 through AL-C10 as finite source contracts**, subject to the distinctions below. This is not whole E3/E5 acceptance or an account/provider/native test result. Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Frozen candidate digests, reproduction command, exact reads and lifecycle receipts are in [the JSON review](e3-account-launch-root-review.json).

## Verification

Root verified72 pinned files/75 inclusive ranges, nine frozen input hashes, six whole-package pointers, twelve inherited pointers and four accepted-contract pointers. Contract evidence and13 original assertion-group associations resolve to unchanged source and package records. The9037 original files/46 packages remain allocated.

Root read all ten contract narratives, findings, residuals and assertion summaries, then independently inspected ten full source files and four explicit ranges across entrypoints, selection, actual settings storage, restore and WSL execution. This does not claim a personal full reread of every source file. **No tests or product actions ran in this review.**

## Implementation-critical distinctions

- **Stale host selection is source-backed:** when an existing host account is invalid/unowned, Claude clears the legacy ID but can retain the runtime map ID. The actual store shallow-merges that update; selection prefers the surviving map. Preparation can consequently still say managed and strip auth variables. A missing account follows a different branch clearing both fields. Reproduce this exact case with synthetic state before applying the separate desired correction.
- **Local serialization is not end-to-end account fencing:** Claude projects preparation after awaited sync; Codex WSL retains a home captured before awaited drain. These are race exposures, not proof that an upstream-guarded launch actually uses the wrong account. Keep RRT-J01 and test the complete route.
- **Drain completion is not implied:** the public drain Promise resolves void for both complete and pending. Failed apply can recover to pending. Timeout at the inspected WSL boundary can settle without confirming guest writer exit, and its projection loses output-truncation information. Preserve recovery and uncertain outcomes.
- **Test bodies outrank titles:** three inspected “restore/retain” examples instead assert unchanged stale auth and cleared legacy selection. Their original assertions remain required; stronger desired restoration needs separate named tests.
- **A returned home is not readiness:** missing service/temporary ownership refusal can reject, while managed hook failures warn and return a path. Real-home null means no managed-home injection. Neither outcome proves complete history, credentials or provider authorization.

Credential rotation, snapshot/file/Keychain partial effects and conservative external-auth preservation retain the candidate's explicit tests and limitations. No real credentials, providers, Keychain or WSL guest were accessed.

## Cross-owner closure and parallel follow-ups

The raw-provider side of AL-SR01 is already accepted in2ba025e. This review supplies finite account-side evidence for PI-JOIN-LAUNCH and the two generation methods in integrations; root still needs to accept the integrations caller contracts.

The remaining AL-SR02/03/04 parser/history/initialization dependencies and PI runtime/request-guard dependencies have fresh, disjoint, direct audit-only Astra Tasks. They must first reuse concrete existing evidence, inspect only actual missing local boundaries, and never recensus the accepted ten/thirteen contracts. No child delegation or implementation is authorized.

Publication/provenance delivered and was officially released without process action; its report awaits root review. Two finite audit assignments are now active, not five newly launched leads. All original baseline/faithful-port/behavioral RED–GREEN and real platform/SSH/WSL/folder/mixed-version requirements remain.

Audit remains **10/12=83.3%, delta0, medium-low confidence**, with no defensible ETA and high flexible24-hour risk. Actual Sol leads/workers start only after the complete source gate; no audit-only preview replacement was performed.
