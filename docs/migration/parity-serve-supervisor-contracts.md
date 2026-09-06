# Foreground serve supervisor — G7-U1

Coordinator source review at rewrite0204b8a; original c9790628 read-only. **Bounded contract characterized; audit open, candidate unproven.** Full mapping and11 source fingerprints: companion JSON.

## SUP01

Foreground mac app-bundle launch only gets handoff path and IPC stdio; recipe JSON bypasses supervisor handoff. Existing install-requested file resumes via bundle version wait, without comparing stale servingPid to a new child.

Source: src/cli/runtime/launch.ts:123, src/cli/runtime/launch.ts:144.

## SUP02

Darwin-only .app inference from executable ancestors. Info.plist short version regex, exact string target;120s wait,250ms polling plus stable-parent watcher; watcher failure retains polling. No signature/actual executable version proof in this function.

Source: src/cli/runtime/mac-app-update-bundle.ts:7, src/cli/runtime/mac-app-update-bundle.ts:17.

## SUP03

After normal child exit, only install-requested matching its pid (if pid defined) enters replacement. Bundle timeout records failed but still spawns current executable with expectedHandoff=null. Matching installed version requires replacement runtime readiness. No generic child-crash retry policy; unrelated/missing handoff returns numeric exit or signal diagnostic.

Source: src/cli/runtime/serve-update-supervisor.ts:34, src/cli/runtime/serve-update-supervisor.ts:84.

## SUP04

Expected replacement has60s readiness deadline. Only parsed orca:serve-ready with exact targetVersion and nonempty runtimeId is accepted. Mismatch/deadline mark failed, persist, SIGTERM then35s SIGKILL fallback. Early exit without verified readiness records failed and returns1; invalid/unexpected/duplicate messages ignored.

Source: src/cli/runtime/serve-update-supervisor.ts:167, src/cli/runtime/serve-update-supervisor.ts:216.

## SUP05

Ready message sets verified then starts completion write; exit waits stateWrite. Completion write rejection changes failed and terminates only if child not settled. It does not kill an already-exited child. Error event attempts failure recording before rejection and removes exit listener.

Source: src/cli/runtime/serve-update-supervisor.ts:177, src/cli/runtime/serve-update-supervisor.ts:224.

## SUP06

POSIX SIGINT/SIGTERM forwarded and remembered; Linux alone registers SIGHUP. Windows console branch does not child.kill initial signal or add forwarded signal, relying on shared-console delivery. First signal starts one35s kill timer (10s renderer+20s teardown+5s margin); repeated signals do not reset it. Exit cleanup removes handlers/timers.

Source: src/cli/runtime/serve-update-supervisor.ts:158, src/cli/runtime/serve-update-supervisor.ts:208, src/shared/quit-teardown-deadline.ts:1.

## SUP07

Numeric child exit code preserved, including nonzero. Exit signal matching caller-forwarded set with null code returns0. Unforwarded/no-code/no-signal throws runtime_serve_failed. Darwin SIGABRT explains window-server issue as likely, never proven; other platforms/signals plain diagnostic.

Source: src/cli/runtime/serve-update-supervisor.ts:89, src/cli/runtime/serve-signal-exit-diagnostic.ts:5.

## SUP08

Handoff schema1, phase membership, nonempty from/target, positive integer servingPid, string reason forfailed, nonempty runtimeId forcompleted. Supervisor IPC exacttype andnonemptyversion/runtimeId. Extra fields retained, no semver/signature/host identity validation. State phase membership uses String(value.phase) then returns original object; do not upgrade this to strict runtime schema evidence.

Source: src/shared/serve-update-handoff.ts:41, src/shared/serve-update-handoff.ts:64.

## SUP09

Read/parse errors become null. Writes JSON to handoffPath.pid.tmp mode0600 then rename. No fsync/directory-sync or symlink/lock protocol here; mode not enforcement on preexisting temporary file. Complete writes completed then unlink; unlink errors swallowed and completedfile may remain. Never call this durability equivalent to reviewed durable-write contract.

Source: src/cli/runtime/serve-update-supervisor.ts:241, src/cli/runtime/serve-update-supervisor.ts:259, src/cli/runtime/serve-update-supervisor.ts:286.

## Evidence and remaining work

12 unchanged original signal/late-write cases passed in an isolated capsule with Node24.19.0/Vitest4.1.11, zero skips. This includes fake Linux/Windows platform branches, not native execution. See reference-captures/c9790628-serve-signal-exit-diagnostic/README.md.

Four original replacement cases in launch.test.ts:106-329 were read fully but **not executed**: bundle swap, version mismatch, spawn error and readiness timeout. launch.test.ts beyond520 was not read. launch.ts was read fully, but its unrelated dependency closure was not cleared for execution.

WP-ENG-CLI + WP-ENG-INSTALL retain update producer/readiness sender, whole launch baseline, installed bundle/launchd recovery and real OS signal tests. WP-ENG-SHARED retains explicit decisions/tests for parser coercion and temp-file/durability hardening; no silent compatibility changes. SSH/version skew and candidate ports remain required. G7-U2/U3 are not covered by this review.
