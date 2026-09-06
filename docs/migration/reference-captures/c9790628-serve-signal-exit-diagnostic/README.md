# Original foreground serve signal baseline

12 unchanged original cases passed, zero failed/skipped, on Node24.19.0 / Vitest4.1.11 / macOS arm64. Source c97906287bb7a390b25e2025b600d9fb3c25d9c3; exact manifest SHA256 d574a091ef2105a1f4b0c4eea1f4217429b454045845fdacdec24c2372b186d7.

Manifest: tests/parity/baseline-capsules/serve-signal-exit-diagnostic.json. Stage: .preflight/parity-baseline/audit-serve-signal-exit-S4VtXo. Archived receipt/results preserve actual runner evidence. Full runtime closure reviewed before execution; original bytes and LICENSE verified against checkout and pinned Git.

These are fake-child EventEmitter/timer cases plus one owned temporary-directory write failure, not pure functions despite the runner's generic disclaimer. Process events do not send OS signals. No actual child/Electron/user session killed; no network, model or installation. Simulated Linux/Windows properties are not native platform evidence. One real mkdtemp directory is created then removed by its original test.

Asserts force-kill grace35s, Windows no initial kill, Linux HUP listener cleanup, graceful forwarded INT, retained numeric errors, contextual diagnostics and no kill of an exited child after a late handoff write failure. Four update-replacement assertions in launch.test.ts were read separately, not executed here.

Only this source test file passed; full suite, installed updates, launchd, SSH, real signals, candidate behavior and version-skew acceptance remain unproven. No assertions/imports/mocks were rewritten. Execution exit0 and strict count evaluation accepted12/12. The original source and installed preview were not changed.
