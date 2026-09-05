# Foundation checkpoint — September 5, 2026

The rewrite goal is active. Implementation started around 19:20 UTC. This checkpoint is not migration acceptance and not a release announcement.

## Ownership

- Coordinator: protocol, integration, independent tests, root manifests/locks and desktop.
- Sonnet 5: core/service correction task settled and was released. Coordinator owns that code now and fixed further independently reproduced failures. Sonnet's current task `task_c9a9e4fe678b`, dispatch `ctx_c925b537603b`, owns desktop source and its harness report only.
- GLM-5.3-Flash: CLI correction task `task_42a71168f819`, dispatch `ctx_4ea3f8ca9c21`, settled and was released. Its 90 tests, formatting and strict Clippy passed independently. Next assigned task `task_94273ee24abd` adds native harness CLI commands; it owns only CLI source and its report.
- AGY: inventory completed, desktop implementation interrupted by provider quota. Exact terminal closed with `ptyKilled:true`, dispatch released, task marked failed with evidence. Coordinator assumed desktop; no competing writer remains.

## Independently observed

- Protocol crate compiled and passed four initial envelope tests.
- Desktop typecheck, production build and 11 unit tests passed (trust boundaries, session projection and serialized/failure-fenced terminal input).
- Real isolated Electron connected to the new Rust service, registered a non-Git folder, spawned a shell, executed a command, retained the same session/incarnation and output after renderer reload, then closed that exact session.
- Repeatable `scripts/accept-desktop.mjs` passed at 19:44 UTC using Node 24, Electron 44.2.0 and the development Rust binary. Local report: `.preflight/acceptance/desktop-1788637477504-3db63f3f-8c20-4b97-98be-02fb16f909c3/report.json`. Owned sessions, desktop and service all reported exited at cleanup. Clear/dark/narrow captures were reviewed; no horizontal overflow at 760×600.
- Rendered acceptance passed again after the input-queue change: `.preflight/acceptance/desktop-1788638525976-afe9eb9c-5126-430d-88ce-48b49fa3ec1f/report.json`. The dark capture was visually inspected; owned processes and sessions exited in cleanup.
- Keyboard tab navigation, exact sibling close, and the session-loading guard subsequently passed typecheck, all 11 unit tests and the expanded six-check rendered acceptance: `.preflight/acceptance/desktop-1788638952228-cdc27752-2812-461f-abe4-0120158d3d5a/report.json`.
- The initial native IPC probe found socket mode 0755. After correction, independent core/CLI acceptance passed ten checks, including private permissions, authentication, malformed/oversized frame isolation, concurrent duplicate admission, real PTY input/output, stale-incarnation refusal and sibling-preserving cancellation. Report: `.preflight/acceptance/core-cli-1788638577033-304059c7-9c3d-4c7f-84fc-eef949d69779.json`. This is not acceptance of untested failure paths.

## Review corrections and current gate

Core corrections cover nonblocking child observation, retained stopped output, receipt persistence uncertainty, idle-client expiry, malformed optional arguments, lock symlink refusal and child admission cleanup. The coordinator added a regression proving direct-child exit is observed even while a descendant keeps the PTY open. CLI corrections retain the caller's request ID on transport failure, validate timestamps and typed payload invariants, resolve paths on the client and page output; close succeeds only for an observed `exited` verdict. Source reports are worker evidence; independent tests determine acceptance.

The expanded suite first reproduced stopped-output and malformed-null failures, then passed all 16 checks: `.preflight/acceptance/core-cli-1788639686854-c3473760-0137-45b4-98a8-63bdf6d07e6c.json`. It exercises real 1.2 MB PTY output, pagination, fast exit, retained stopped output, confirmed stdio closure before stop, second-owner refusal and service SIGKILL/restart after all children exited. Reports fingerprint the tested binaries. Real live-child crash/remote recovery remains separate, unverified work.

The native harness extension subsequently passed 47 core/service/harness tests. The 19-check optional installed-Pi acceptance passed at 20:30 UTC: `.preflight/acceptance/core-cli-1788640220268-a8f85732-08cb-4fa0-b1ac-16d4b87f12ae.json`. It launched the actual Pi TUI through Drogon's service, verified repeat admission returns the same session, and confirmed exact stop. Pi configuration was isolated in the temporary fixture; no prompt or inference request was sent. Another check verifies child processes do not inherit Orca runtime authority. This proves neither model authentication nor DGX connectivity. The updated CLI's 90 tests, strict Clippy and debug build passed independently afterward; full rendered harness acceptance is next.

The foundation CI definition targets macOS/Linux checks and Windows compilation only. It has not run on GitHub and is not evidence of Windows runtime support or the final Linux glibc floor. No first-slice PR has been merged yet.

## Deliberate first-slice limits

Explicit service startup; no bundled installer yet. Only local native IPC is implemented so far; Windows service, SSH and mixed-host execution still require implementation and actual evidence. Native harness discovery/launch exists, but its typed CLI and UI are in progress. No Git operations beyond folder/repository registration, orchestration, skills integration, Mentu, Bots or Meetings are represented as working in the new UI. The migration note makes unavailable features explicit. Bounded session resource retirement and additional persistence-failure cases still need review before release.

The final goal still requires those agreed migration slices, cross-platform/SSH validation, package installation and dogfooding with Drogon's own CLI/runtime before resuming the pre-rewrite Mentu/Bots/Meetings handoff. Benchmark inference remains Pi + DGX Spark only. Orca Run/Task/Dispatch records carry current implementation provenance.

## Repeatable verification recipe

`.mentu/recipes/rewrite-foundation-verification.json` follows the official writing-recipes skill. Schema check passed and strict doctor scored 100 with no findings. It is **validated, not executed**. Its four sequential stages require a clean checkout, compile/test the workspace, exercise core/CLI failure boundaries, and run the rendered desktop acceptance. Do not execute it concurrently with editing workers because Mentu's change accounting/commits share the checkout. Passing this recipe accepts only this foundation slice, not deferred migration features or formal Commitment Protocol records.

## Repository preservation

`clioo/drogon` is independent/public. `clioo/drogon-orca` remains public because GitHub forbids changing a public fork's visibility. The standard fork-detachment action can lose PRs/issues and other metadata; it was not executed. No old checkout, user profile or old run evidence was deleted.
