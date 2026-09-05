# Foundation checkpoint — September 5, 2026

The rewrite goal is active. Implementation started around 19:20 UTC. This checkpoint is not migration acceptance and not a release announcement.

## Ownership

- Coordinator: protocol, integration, independent tests, root manifests/locks and desktop.
- Sonnet 5: core/service (`task_8c3c18613f2c`, `ctx_8f76a12f5c5d`), implementation and corrections in progress.
- GLM-5.3-Flash: CLI (`task_d4bc0d851ef5`, `ctx_0c8cbabf5228`), implementation in progress.
- AGY: inventory completed, desktop implementation interrupted by provider quota. Exact terminal closed with `ptyKilled:true`, dispatch released, task marked failed with evidence. Coordinator assumed desktop; no competing writer remains.

## Independently observed

- Protocol crate compiled and passed four initial envelope tests.
- Desktop typecheck, production build and four trust-boundary unit tests passed.
- Real isolated Electron connected to the new Rust service, registered a non-Git folder, spawned a shell, executed a command, retained the same session/incarnation and output after renderer reload, then closed that exact session.
- Repeatable `scripts/accept-desktop.mjs` passed at 19:44 UTC using Node 24, Electron 44.2.0 and the development Rust binary. Local report: `.preflight/acceptance/desktop-1788637477504-3db63f3f-8c20-4b97-98be-02fb16f909c3/report.json`. Owned sessions, desktop and service all reported exited at cleanup. Clear/dark/narrow captures were reviewed; no horizontal overflow at 760×600.
- Native IPC security probe failed because the socket had mode 0755 rather than the required private mode. Directory/token were private. The failure was sent to the core owner; this gate remains unaccepted pending fixes and retest.

## Open review findings

Core owner is addressing socket permissions, bounded client concurrency/timeouts, exclusive startup ownership, symlink-safe state/token handling, durable receipt failures and fast-exit persistence races. These are not excused by the positive UI walkthrough. CLI acceptance has not run yet. Source reports are worker evidence; independent tests determine acceptance.

## Deliberate first-slice limits

Explicit service startup; no bundled installer yet. Only local native IPC is implemented so far; Windows service, SSH and mixed-host execution still require implementation and actual evidence. No Git operations beyond folder/repository registration, harness catalog, orchestration, skills integration, Mentu, Bots or Meetings are represented as working in the new UI. The migration note makes those unavailable features explicit.

The final goal still requires those agreed migration slices, cross-platform/SSH validation, package installation and dogfooding with Drogon's own CLI/runtime before resuming the pre-rewrite Mentu/Bots/Meetings handoff. Benchmark inference remains Pi + DGX Spark only. Orca Run/Task/Dispatch records carry current implementation provenance.

## Repeatable verification recipe

`.mentu/recipes/rewrite-foundation-verification.json` follows the official writing-recipes skill. Schema check passed and strict doctor scored 100 with no findings. It is **validated, not executed**. Its four sequential stages require a clean checkout, compile/test the workspace, exercise core/CLI failure boundaries, and run the rendered desktop acceptance. Do not execute it concurrently with editing workers because Mentu's change accounting/commits share the checkout. Passing this recipe accepts only this foundation slice, not deferred migration features or formal Commitment Protocol records.

## Repository preservation

`clioo/drogon` is independent/public. `clioo/drogon-orca` remains public because GitHub forbids changing a public fork's visibility. The standard fork-detachment action can lose PRs/issues and other metadata; it was not executed. No old checkout, user profile or old run evidence was deleted.
