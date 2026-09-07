# Native quiescent shutdown — root acceptance

Root validation, 2026-09-07. This accepts the native contract for integration;
it is not a packaged-desktop, installed-app, Windows-runtime or full-parity claim.

## Final source checks

- `cargo test --workspace --locked --offline --quiet`: **406 passed, 0 failed,
  1 pre-existing ignored probe entry**. Its owning test explicitly invokes
  that entry; no new ignored case was added.
- `cargo fmt --all -- --check`: passed.
- `cargo clippy --workspace --all-targets --locked --offline -- -D warnings`:
  passed.
- `cargo build --workspace --locked --offline`: passed.

These run after root's final corrections: retain admission through receipt
persistence/freeze, release the private test-hook mutex before invocation,
keep racing test children alive until explicitly stopped, propagate accepted
stream configuration failure, and refuse untrackable connection handlers.
Scoped worker and root test counts overlap this suite; do not add them together.

## Actual service and CLI proof

Root launched newly built debug `drogond` and `drogon-cli` in a temporary
data directory, using the real packaged-cleanup consumer from local commit
`757ff085044ebaa1ea47c929bec6ee12d2b46b04` and its existing kernel observer.
The six checks passed:

1. Authenticated status advertises the capability and the directly owned
   child's actual process ID.
2. Shutdown refuses a real live PTY session with `runtime_busy`, leaving it
   live instead of stopping work on the caller's behalf.
3. The consumer stops the exact session, requests fenced shutdown and observes
   kernel exit. The directly owned daemon independently exits **0, no signal**.
4. A replacement reacquires the same directory lock, retaining host identity
   and creating a new service identity.
5. Both the old consumer handle and old native shutdown fences refuse the
   replacement; it remains responsive.
6. The replacement also shuts itself down with kernel proof and exits **0,
   no signal**. Final cleanup finds both children already exited, without force.

The private local receipt and reproducible diagnostic are retained at
`/tmp/drogon-native-quiescence.FNj3oO/report.json` and its sibling `probe.mjs`.
They are not public build artifacts. The probe used no model inference or
user data; generated sessions and services were positively closed.

## Remaining gates

Review/CI and merge this native producer, integrate it with the packaged
consumer, build/sign/seal a clean production artifact, run full Electron
acceptance (including detached bootstrap and reopen), then install and verify
that exact artifact. Keep the previous installed build and user data intact.
Native coordination, complete Orca UX, SSH/Windows and later Mentu experiments
remain part of the unchanged full rewrite goal.
