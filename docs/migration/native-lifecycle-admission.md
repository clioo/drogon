# Native lifecycle admission — correction evidence (2026-09-06)

## Root verification after worker settlement

Root independently ran the full Rust workspace: **231 passed, 0 failed,
1 ignored probe entry** (the parent test invokes that marker-gated entry).
Strict workspace/all-target Clippy passed. Linux and Windows execution are
still not proven by this macOS run.

Root also corrected the final release order: binding the removed master to
`_released_master` retained it until function scope exit, including while
waiting for the writer mutex. Explicit `drop(...)` now releases the master
before acquiring the writer lock, matching the stated ownership invariant.
This is a Rust lifetime correction, not a claim of reproduced macOS blocking.

Direct depth-1 leaf work in worktree
`codex-desktop-lifecycle-packaging` (branch `codex/desktop-lifecycle-packaging`,
base `main14cfc74`), under root task `task_d140cca59849` /
dispatch `ctx_2b0ed332be0f`. Inputs: root-transferred drafts documented in
`worktree-desktop-transfer.json`, `core-review-corrections.md`,
`foundation-review.md`, and the admission findings in
`native-foundation-admission-followup.md`. Historical documents were preserved
verbatim; all new evidence is in this file. Transferred implementation was
reused, not replaced; prior authorship is not claimed here.

Host: macOS arm64 (Darwin), rustc/cargo 1.98.0, pinned libc 0.2.189.
All cargo commands ran `--locked --offline` with `CARGO_BUILD_JOBS=2` and the
worktree-local target directory.

## Correction 1 — fatal accept errno classification now uses host libc constants

`crates/drogond/src/server.rs::is_fatal_accept_error` previously matched the
numeric list `9 | 22 | 88 | 45` on every Unix host. That list is not portable:
with pinned libc 0.2.189 on this Apple host, `ENOTSOCK=38`, `ENOTSUP=45`,
`EOPNOTSUPP=102`; on Linux GNU x86_64, `ENOTSOCK=88`, `EOPNOTSUPP=95`,
`EL2NSYNC=45`. The old list missed Apple ENOTSOCK/EOPNOTSUPP entirely and its
45 means ENOTSUP only by coincidence of platform.

Fix: classification now compares `raw_os_error()` against the host constants
`libc::EBADF`, `libc::EINVAL`, `libc::ENOTSOCK`, `libc::ENOTSUP`,
`libc::EOPNOTSUPP` (chained equality, so the Linux ENOTSUP==EOPNOTSUPP aliasing
cannot create a duplicate pattern). Kind-only errors (no errno) stay transient.
Retry/backoff, the consecutive-error budget (`DEFAULT_MAX_CONSECUTIVE_ACCEPT_ERRORS`),
healthy-accept counter reset, connection cap and idle deadline are unchanged.

Comment corrections: `run_accept_loop`'s doc comment no longer says transient
errors "never end the service" (the retry budget bounds them and then returns
the error); `drogond/src/lib.rs::serve` no longer says "only a genuinely broken
listener surfaces here" (an exhausted transient budget surfaces too, and both
must fail the process honestly).

### Tests (deterministic, on-host)

Unit (`crates/drogond/src/server.rs` `#[cfg(all(test, unix))]`):

- `fatal_accept_classification_uses_host_errno_constants` — all five fatal
  constants must classify fatal. RED captured against the old numeric list on
  this host: `errno 38 must classify as fatal` (Apple ENOTSOCK; EOPNOTSUPP=102
  would fail next). GREEN after the fix. ENOTSUP=45 passed even before the fix
  on Apple (it was in the old list) — recorded, not hidden.
- `transient_accept_classification_stays_retryable` — EINTR, EAGAIN, EMFILE,
  ENFILE, ENOBUFS, ECONNABORTED and a kind-only error stay transient.

Integration (`crates/drogond/tests/server.rs`, via `run_accept_loop` injection):

- `consecutive_transient_accept_errors_exhaust_the_budget_and_surface` — a
  persistent EMFILE source with budget 3 returns the last error with its
  original errno.
- `a_successful_accept_resets_the_consecutive_error_budget` — deterministic
  call-index injection schedule (errors on calls 1–2, real accept on 3, errors
  on 4–5, real accept on 6, fatal EBADF on 7 so the loop thread ends
  deterministically). Mutation check: with the counter reset removed the test
  fails (loop dies on call 4, second client never served); with the reset
  present it passes. The fatal tail-call also gives the test's listener thread
  an exact, bounded exit instead of blocking in accept forever.
- `fatal_accept_listener_failures_are_returned_not_swallowed` now uses
  `libc::EBADF` instead of the literal 9.
- Pre-existing main hardening kept: connection-cap reclamation and the
  timeout-not-closure sensitivity test
  (`frame_rejection_does_not_accept_a_read_timeout`).

Platform limits: all fatal categories are tested on this macOS host only.
No Linux execution was available; Linux classification is verified by
construction (same constants resolve per-host at compile time) but is
**unexecuted** there, and macOS is not Linux proof.

## Correction 2 — environment isolation in the PTY probe test

`crates/drogon-core/tests/engine.rs::child_environment_is_stripped_of_runtime_control_context`
no longer mutates the process-wide environment (the transferred draft's
`unsafe { set_var/remove_var }` blocks are gone; the file now contains no
`unsafe` and no env mutation). The parent test re-invokes the same test binary
into an exact isolated entry — `--exact child_environment_probe_entry --ignored
--nocapture` — an owned `std::process::Command` whose environment is built
entirely before spawn (`env_clear` + explicit canaries):

- `ORCA_TEST_CONTROL=…` and `DROGON_DATA_DIR=…` must be **absent** in the real
  PTY grandchild (`orca=unset`, `drogon=unset` in the probe output);
- `PROBE_KEEP_ME=inherited-canary` (not a control variable) must be
  **preserved**, proving only control context is stripped;
- the probe entry is marker-gated (`PROBE_CHILD_MODE=1`) so a plain
  `cargo test -- --ignored` never executes it outside its explicit environment.

Bounded completion: the parent polls `try_wait` on the exact owned child
handle with a 20 s deadline and, if exceeded, kills that exact handle (never a
shared name or arbitrary PID). The entry stops its own fixture session through
its session identity before exiting.

Adjudication note: the product stripping logic in
`crates/drogon-core/src/session.rs::spawn_pty` already covered both prefixes in
the transferred draft, so no product RED exists for this correction — the fix
is the harness (no parent-process mutation race). No product code was changed
for this correction.

## Correction 3 — simulated-recovery fixture orphans fixed with exact cleanup

Two engine tests started a `sleep 30` fixture child and then dropped the only
Engine that held its handle, leaving the child to linger (relying on
platform PTY-hangup behavior to end it). Both now retain the original engine
for the whole test and stop the fixture child through it — exact, owned
cleanup by session identity, never a name/PID kill:

- `crash_then_restart_marks_prior_sessions_unverifiable_and_never_respawns`
  was renamed to
  `handle_loss_then_reopen_marks_prior_sessions_unverifiable_and_never_respawns`:
  what it actually models is a second Engine finding rows whose in-memory
  handles it does not have. Comments now state explicitly that this is NOT
  real process death and not crash-recovery proof (real live-child crash
  recovery remains open, as already listed in the transferred follow-ups).
- `unknown_session_ids_are_not_found_while_recovered_ones_are_unverifiable`
  got the same retained-handle + exact cleanup treatment.

All original assertions (unverifiable verdicts, not-found vs
stale-incarnation vs unverifiable distinctions across read/write/resize/stop,
never-respawn) are unchanged and passing. A `SessionGuard` drop-guard in
engine.rs stops the fixture exactly even if an assertion fails mid-test.

## Correction 4 — writer/master lock coupling review (root msg_d56075fa35d2)

Root asked whether `NativePty` combining writer and master under one mutex
lets an indefinitely blocked `write_all` stall `resize` and
`try_release_native`, and asked for an owned bounded reproduction or a
documented adjudication.

Reproduction attempt (transient probe, since deleted): engine session running
`exec sleep 30` (never reads stdin), `session.write` of 8 KiB / 64 KiB /
1 MiB, and a resize dispatched 20 ms into an in-flight 1 MiB write.

Measured on this macOS arm64 host:

- 8 KiB write: ok, ~1–2 ms.
- 64 KiB: first attempt failed (`ok=false`) in ~4.5–4.8 ms; a later 64 KiB
  write succeeded in ~12 ms.
- 1 MiB: failed in ~70–80 ms, or succeeded in ~100–166 ms depending on prior
  queue state.
- `session.resize` during the in-flight 1 MiB write: ok in ~0.3 ms.

Adjudication: **no indefinite write block is reproducible on this host** —
BSD tty input handling does not back-pressure the master writer the way the
hypothesis requires; large writes fail or complete quickly, so the single
mutex produced no observable stall (the test below was GREEN against the old
code too). This is NOT evidence about Linux: with n_tty flow control a master
write into a full slave input queue can block, and that case is unexecuted
here. The structural coupling was real regardless: any future blocking write
would have serialized `resize` and release behind it, where the pre-transfer
implementation kept master and writer independent.

Fix applied (preservation requirement, not a bug claim):
`SessionHandle::writer` is now its own `Mutex<Option<Box<dyn Write + Send>>>`
separate from `native: Mutex<Option<NativePty>>` (master only). `session.write`
locks only the writer; `session.resize` locks only the master;
`try_release_native` takes the master first, then the writer, so a blocked
write can delay at most its own release, never master operations. A blocked
write now costs only other writes, as before the transfer.

Regression test kept (bounded, owned):
`crates/drogon-core/tests/engine.rs::a_large_write_to_a_stalled_child_does_not_stall_resize`
— 1 MiB `session.write` in flight against a never-reading child, `session.resize`
must complete within 3 s, exact `session.stop` cleanup (plus drop-guard), write
thread must return within 5 s of the stop. On hosts where writes can block
indefinitely this test has teeth; on macOS it locks the measured bounded
behavior. Avoids unbounded threads/processes: every thread is joined via a
bounded channel receive.

## Verification (this worktree, exit codes observed, no pipe masking)

```
cargo fmt --package drogon-core --package drogond -- --check   → exit 0
cargo clippy -p drogon-core -p drogond --all-targets --locked --offline
  -- -D warnings                                              → exit 0
cargo test -p drogon-core -p drogond --locked --offline        → exit 0
  102 passed, 0 failed, 1 ignored (the marker-gated probe entry; it runs via
  the parent test's re-invocation): 4 drogon-core unit + 9 bot-input
  + 39 claim-identity + 3 database-path + 16 engine (+1 ignored probe entry)
  + 2 exit-observation + 2 harness-catalog + 1 native-release
  + 2 session-persistence + 0 workspace-path-safety (linux-gated, none run)
  + 11 drogond unit + 12 drogond server
cargo build -p drogon-core -p drogond --locked --offline --release → exit 0
```

Descriptor-release/retained-output (`native-release.rs`), exit-observation,
session-persistence, normal close/reload server behavior and
stale-incarnation distinctions all pass unchanged with real PTYs and
temporary stores.

## Files modified by this leaf (on top of the transferred drafts)

- `crates/drogond/src/server.rs` — errno classification + comments + unit tests
- `crates/drogond/src/lib.rs` — serve() comment correction
- `crates/drogond/tests/server.rs` — host-constant fatal test, threshold and
  reset regressions, deterministic loop-thread exit
- `crates/drogon-core/tests/engine.rs` — env-probe rewrite (owned subprocess,
  isolated entry, no parent env mutation), orphan-fixture exact cleanup +
  honest renaming/comments, write/resize independence regression
- `crates/drogon-core/src/session.rs` — writer lock split only (Correction 4)
- `docs/migration/native-lifecycle-admission.md` — this file

Untouched by this leaf, per scope: `crates/drogon-core/src/lib.rs` (the
transferred `require_session_with_incarnation` identity correction stands as
delivered and is covered by the passing recovered/unknown identity tests) and
all other crates/manifests. No Git, packaging, UI, install, service or
provider actions were performed.

## Open gaps (honest)

- Linux (and other Unix) execution: not available here; errno constants and
  tty blocking semantics are per-host and Linux is unexecuted, not proven.
- Windows: remains unimplemented/unclaimed (`ServeError::UnsupportedPlatform`).
- Real live-child crash recovery (process death fixture) remains open, as
  already recorded in the transferred follow-up list.
- The write/resize independence split is validated behaviorally only on
  macOS; the Linux blocking case that motivates it is unexecuted.
