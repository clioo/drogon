# Complete persisted renderer contracts

Root architecture/ownership decision, 2026-09-06. This is the next integration
prerequisite after accepted renderer checkpoint policies, not permission to
redefine the full model around the current thin desktop shell.

## Required result

Port the complete pinned `WorkspaceSessionState`, `PersistedUIState`, their
referenced type closure, and the host-qualified checkpoint staging envelope.
Preserve source unions, optional/null distinctions, persisted legacy fields,
folder and execution-host identities, editor drafts and disk signatures,
terminal layouts/tombstones/incarnations/resume provenance, browser ownership
and deferred close intents, UI navigation and existing Drogon/Mentu state.
Do not simplify into generic records, `any`, `unknown`, or JSON blobs as a
replacement for a known source type. Preserve source-authored generic types
where those are actually the contract; do not change semantics for convenience.

Start with the pinned source files:

- `src/shared/workspace-session-state-types.ts`
- `src/shared/persisted-ui-state-types.ts`
- `src/main/ipc/renderer-shutdown-checkpoint.ts`
- their actual imported type declarations, traced proportionately.

Read-only reference pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` under
`/Users/carlos/Documents/Drogon-mentu-session`. Execute only in the rewrite or
its approved nonce capsules; preserve MIT provenance and never stage private
data, user profiles, credentials, telemetry destinations or asset bytes.

Reuse existing candidate types where they are genuinely equivalent; compare
their full structure first. In particular, the current process `Session` is
not the source renderer workspace snapshot and cannot stand in for it.
Type-only extraction from modules with unrelated runtime implementations is
permitted with exact declaration provenance and preserved transitive type
semantics; do not copy entire services merely to resolve a type import.

## Delegation and exclusive ownership

Sol-UI must delegate implementation, type-closure preparation and validation
to one approved OpenCode GLM leaf. Root explicitly transfers creation of these
new contract files to that leaf, retaining architecture and final admission:

- `apps/desktop/src/shared/persistence-contracts/**`
- `apps/desktop/src/renderer/src/lib/updater-beforeunload.ts`
- `tests/parity/ports/WP-UI-PRELOAD/persisted-renderer-contracts/**`
- the existing shutdown-checkpoint restart-lifecycle test, solely to replace
  its inline updater module with an import of the real candidate module.

Sol owns only `docs/migration/sol-wave/ui-preload/persisted-renderer-contracts.md`
and `.json`. No other current leaf owns these paths. Root retains existing
shared files, manifests, IPC, Rust, production callers, commits and installation.
No extra descendants, provider changes, dependency installs or services.

## Tests before admission

Produce source-to-candidate declaration/field mapping, hashes and full closure
boundaries. Typecheck the complete candidate closure without skip/error ignores
that hide missing imports or broaden types. Preserve every original field;
compile representative source-faithful full snapshots and UI patches covering
local/SSH/runtime, folder workspaces, dirty editors, browser close intent,
terminal authority and Mentu. Add negative compile cases for discriminated
unions and malformed identities; distinguish declared type compatibility from
runtime validation or durable round-trip evidence.

Port the actual `updater-beforeunload` lifecycle implementation and applicable
source tests. Remove the faithful inline copy from the earlier test and rerun
the unchanged lifecycle assertions against the real candidate implementation.
Reuse admitted source capsules; do not rerun for attribution alone. Missing
imports/type setup failures are not behavioral RED, and no artificial defect
may be introduced for that label. Report any inaccessible closure before
substituting weaker types.

The returned complete envelope must be suitable for binding the generic policy
factory without payload filtering. This block does not implement serialization,
database ownership, runtime admission, cloud services, updater feeds, or real
checkpoint persistence; those remain explicit next integration gates.
