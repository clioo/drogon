# Stage-close verification — 2026-09-07

This records narrow integration acceptance, not complete product parity.

## Settings dialog

Integrated V2 panel/App proposal from `83e5e28` and probe `8406e02`,
preserving ROOT's existing Files/Bots admission and registry wiring.
ROOT strengthened the real-CDP probe to assert every Tab/Shift-Tab step,
require a real background control and capture the open dialog in both themes.

The first visual inspection found the dialog at the left edge. A new right-edge
geometry assertion failed on that implementation; fixed positioning passed the
same probe. A separate padding-click regression failed 1/20 unit tests before
the bounds-based backdrop check and passed after it. Dialog padding must not
be treated as the backdrop merely because the target is the dialog element.

Final independent local checks: 40 desktop test files / 495 tests passed,
desktop typecheck and production build passed. Node24 real Electron/CDP passed
12 named interaction checks plus owned desktop/daemon exit observations.
ROOT viewed both open-panel captures (1440x1000 light and 760x600 dark) under
`.preflight/settings-dialog-1788795768516/`.

Probe: `docs/migration/verticals/V2/probes/settings-dialog-cdp.mjs`.
It uses an isolated folder and owns its desktop/daemon children. Its SIGTERM
teardown is not evidence of authenticated runtime shutdown or native Quit.
The fixture is retained. This probe is not packaged-install acceptance.

## Cross-platform auth token generation

V1 explicitly released file ownership in `msg_467324d0fe0e`: no auth editor
or child task had started. ROOT replaced the Unix-only token generator with
the workspace's already-fixed `getrandom = "=0.4.3"`; Cargo.lock adds only
the drogond dependency edge. OS entropy failure still returns before any token
file write; there is no weak fallback or empty-token success path.

The existing Windows CI failure was the unsupported-platform error. The
strengthened token test checks 32 decoded bytes, 43 URL-safe encoded characters,
freshness across starts and exact persisted bytes. It passed on macOS before
and after the implementation; that local pass is not a fabricated RED.
Independent `cargo test -p drogond --offline`: 56 passed, zero failed.
Windows runtime acceptance still requires the Windows CI result.

## Final combined gates

On `9c1b51d`, independent local `cargo test --workspace --locked`, strict
workspace/all-targets clippy, rustfmt, 70 packaging tests, 72 renderer-contract
tests and renderer-contract typecheck all exited zero. Test counts are not
measured line/branch coverage; these checks do not certify 90% parity.

CI run `34140146360`: macOS passed; Windows passed, including actual daemon
26 unit + 4 transport tests, plus 27 JS pipe-fixture tests (one skipped).
The Windows auth regression now passes on Windows. These are not full Windows
Electron/install or cross-process cancel/reap acceptance.

Linux failed the copied executable fixture at `coordination_access.rs:55`
with OS error 26, `ExecutableFileBusy` / `Text file busy`. ROOT serialized
only executable copy + spawn with a test-local mutex (`7122c66`), preventing
another fixture fork from inheriting the copy's writable FD until exec.
Daemon interactions remain concurrent; all six assertions remain unchanged.
The six tests pass locally, strict clippy/fmt pass; Linux rerun is required.
