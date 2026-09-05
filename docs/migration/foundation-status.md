# Foundation checkpoint — September 5, 2026

The rewrite goal is active. Implementation started around 19:20 UTC. This checkpoint is not migration acceptance and not a release announcement.

## Ownership

- Coordinator: protocol, integration, independent tests, root manifests/locks and desktop.
- Sonnet 5: initial core/service task returned 26 passing tests. Review found remaining blockers; correction task `task_e3db81d92da2`, dispatch `ctx_21121af2bfd1`, reuses the exact terminal with sole core/service ownership.
- GLM-5.3-Flash: CLI (`task_d4bc0d851ef5`, `ctx_0c8cbabf5228`), implementation in progress.
- AGY: inventory completed, desktop implementation interrupted by provider quota. Exact terminal closed with `ptyKilled:true`, dispatch released, task marked failed with evidence. Coordinator assumed desktop; no competing writer remains.

## Independently observed

- Protocol crate compiled and passed four initial envelope tests.
- Desktop typecheck, production build and 11 unit tests passed (trust boundaries, session projection and serialized/failure-fenced terminal input).
- Real isolated Electron connected to the new Rust service, registered a non-Git folder, spawned a shell, executed a command, retained the same session/incarnation and output after renderer reload, then closed that exact session.
- Repeatable `scripts/accept-desktop.mjs` passed at 19:44 UTC using Node 24, Electron 44.2.0 and the development Rust binary. Local report: `.preflight/acceptance/desktop-1788637477504-3db63f3f-8c20-4b97-98be-02fb16f909c3/report.json`. Owned sessions, desktop and service all reported exited at cleanup. Clear/dark/narrow captures were reviewed; no horizontal overflow at 760×600.
- Rendered acceptance passed again after the input-queue change: `.preflight/acceptance/desktop-1788638525976-afe9eb9c-5126-430d-88ce-48b49fa3ec1f/report.json`. The dark capture was visually inspected; owned processes and sessions exited in cleanup.
- Keyboard tab navigation, exact sibling close, and the session-loading guard subsequently passed typecheck, all 11 unit tests and the expanded six-check rendered acceptance: `.preflight/acceptance/desktop-1788638952228-cdc27752-2812-461f-abe4-0120158d3d5a/report.json`.
- The initial native IPC probe found socket mode 0755. After correction, independent core/CLI acceptance passed ten checks, including private permissions, authentication, malformed/oversized frame isolation, concurrent duplicate admission, real PTY input/output, stale-incarnation refusal and sibling-preserving cancellation. Report: `.preflight/acceptance/core-cli-1788638577033-304059c7-9c3d-4c7f-84fc-eef949d69779.json`. This is not acceptance of untested failure paths.

## Open review findings

Remaining core review blockers include locks held across blocking child reap, truthful terminal state after resize/stop, pending receipt behavior under persistence failure, idle-client expiry, malformed optional arguments and partial-spawn cleanup. CLI review requires transport failures to retain replay identity, safe timestamp/payload validation, client-relative path resolution and paged output reads. These are not excused by the positive walkthrough. Source reports are worker evidence; independent tests determine acceptance.

The expanded core/CLI suite intentionally raises the gate: real 1.2 MB PTY output, pagination, fast exit, retained stopped output, confirmed stdio closure before stop, second-owner refusal and actual service SIGKILL/restart after all children exited. Its first run reproduced the stopped-output failure (`core-cli-1788638761097-ffbbe495-eb3d-4634-a6cb-a5ff31902efe.json`); this expanded suite has **not passed yet**. New reports fingerprint both Rust binaries. Real live-child crash/remote recovery remains separate, unverified work. Clippy also currently fails on the core receipt return type complexity; that finding is with the core owner.

The foundation CI definition targets macOS/Linux checks and Windows compilation only. It has not run on GitHub and is not evidence of Windows runtime support or the final Linux glibc floor. No first-slice PR has been merged yet.

## Deliberate first-slice limits

Explicit service startup; no bundled installer yet. Only local native IPC is implemented so far; Windows service, SSH and mixed-host execution still require implementation and actual evidence. No Git operations beyond folder/repository registration, harness catalog, orchestration, skills integration, Mentu, Bots or Meetings are represented as working in the new UI. The migration note makes those unavailable features explicit.

The final goal still requires those agreed migration slices, cross-platform/SSH validation, package installation and dogfooding with Drogon's own CLI/runtime before resuming the pre-rewrite Mentu/Bots/Meetings handoff. Benchmark inference remains Pi + DGX Spark only. Orca Run/Task/Dispatch records carry current implementation provenance.

## Repeatable verification recipe

`.mentu/recipes/rewrite-foundation-verification.json` follows the official writing-recipes skill. Schema check passed and strict doctor scored 100 with no findings. It is **validated, not executed**. Its four sequential stages require a clean checkout, compile/test the workspace, exercise core/CLI failure boundaries, and run the rendered desktop acceptance. Do not execute it concurrently with editing workers because Mentu's change accounting/commits share the checkout. Passing this recipe accepts only this foundation slice, not deferred migration features or formal Commitment Protocol records.

## Repository preservation

`clioo/drogon` is independent/public. `clioo/drogon-orca` remains public because GitHub forbids changing a public fork's visibility. The standard fork-detachment action can lose PRs/issues and other metadata; it was not executed. No old checkout, user profile or old run evidence was deleted.
