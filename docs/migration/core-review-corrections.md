# Core review corrections — 2026-09-05

Implementation pass after the read-only foundation review
(`docs/migration/foundation-review.md`). Owned files touched:
`crates/drogon-core/**`, `crates/drogond/**`, and this document. The
coordinator-validated findings were implemented; rejected/downgraded claims
were not acted on (no speculative JSON-depth change, panic-hardening left as a
documented follow-up).

## Correction 1 — transient accept errors no longer end drogond

`crates/drogond/src/server.rs`

- The `for incoming in listener.incoming() { let Ok(stream) = ... else { break } }`
  loop was replaced by `run_accept_loop`, which classifies every accept error:
  fatal (`EBADF`/`EINVAL`/`ENOTSOCK`/`EOPNOTSUPP` — the listener itself is
  unusable) returns immediately; everything else (`EMFILE`/`ENFILE`,
  `ECONNABORTED`, `EINTR`, `EAGAIN`, `ENOBUFS`, kind-only transient errors) is
  retried with exponential backoff (`DEFAULT_ACCEPT_ERROR_BACKOFF` = 10 ms,
  doubled per consecutive failure, capped at 500 ms).
- Bounded: after `DEFAULT_MAX_CONSECUTIVE_ACCEPT_ERRORS` (8) consecutive
  transient failures the loop returns the last error instead of retrying
  forever — a persistently broken listener fails the service honestly
  (`serve` propagates `ServeError::Io`, `main` exits FAILURE) rather than
  silently stop serving.
- Signatures: `accept_loop`/`accept_loop_with_limits` now return
  `std::io::Result<()>`; new testable entry point
  `run_accept_loop(accept: impl FnMut() -> io::Result<UnixStream>, …,
  accept_error_backoff, max_consecutive_accept_errors)` accepts any accept
  source so tests inject deterministic errors.
- Tests (`crates/drogond/tests/server.rs`):
  - `transient_accept_errors_do_not_end_the_service` — deterministic
    error-then-valid sequence: an injected `EMFILE` and an injected
    kind-only `ConnectionAborted` failure, then a genuinely queued client is
    served (`after-errors` round-trip ok), then a second client proves the
    loop keeps accepting (`still-alive`).
  - `fatal_accept_listener_failures_are_returned_not_swallowed` — an `EBADF`
    -shaped accept source surfaces as `Err` with the original raw code.
- Also fixes the P1's secondary claim: `main` previously returned `Ok(())`
  after a dead loop; it now exits FAILURE with the error printed.

## Correction 2 — native PTY resources are released after exit + drain

`crates/drogon-core/src/session.rs`

- `SessionHandle.master`/`.writer` merged into `native: Mutex<Option<NativePty>>`
  plus a `reader_done: AtomicBool` set by the reader thread when the PTY read
  side reached EOF or an unrecoverable read error.
- `try_release_native` drops the master/writer pair exactly once, and only
  when BOTH facts hold: the child's exit was positively observed (reaped exit
  status in `exit_code`) and the reader finished draining. Called from all
  three observation points — the reader thread's end, the poller thread after
  a successful `persist_exit`, and both success paths of `stop` — so whichever
  fact lands last triggers the release. Release takes each lock only for the
  instant of a check or `take()`; the DB and session-map locks are never held
  during release.
- Retained output is untouched: the ring buffer is in-memory and independent,
  so `session.read` keeps serving the retained tail after release. No
  descendant cleanup is claimed, attempted, or implied (the poller/reader
  threads exit; descendants holding the slave keep it open and simply delay
  release by staying alive, which is correct).
- `write`/`resize` handle the released state explicitly (`unverifiable
  "session already exited…"`) for the narrow race window between their reap
  check and the native lock; their pre-existing reap checks are unchanged, so
  no race with `stop` is introduced.
- Not done, per instructions: memory retirement or durable output retention
  policy (see follow-ups).
- Test (`crates/drogon-core/tests/native-release.rs`):
  `repeated_short_sessions_bound_fds_and_keep_retained_output` — after a
  2-session warm-up baseline, six sequential short-lived (`echo …; exit 0`)
  sessions must return the process's open-descriptor count to the baseline
  (slack +2 for unrelated churn; a leaking implementation holds ≥6 extra)
  within a bounded 5 s window, and every session's retained output
  (`SHORT-LIVED-n`) must still be readable afterwards.

## Correction 3 — child environments are stripped of both runtimes' control context

`crates/drogon-core/src/session.rs:166-180` (`spawn_pty`)

- The env-removal loop now strips variables prefixed `ORCA_*` **and**
  `DROGON_*` (case-insensitive), so inherited control identity — including
  `DROGON_DATA_DIR`, the documented client→service binding — cannot point a
  child at this or another service by accident. The service injects no
  credentials; fresh scoped identity injection remains a future coordination
  concern (noted in the contract doc, not invented here).
- Test (`crates/drogon-core/tests/engine.rs`):
  `child_environment_is_stripped_of_runtime_control_context` — the test
  process exports `ORCA_TEST_CONTROL` and `DROGON_DATA_DIR`, spawns
  `/bin/sh -c` probe printing `CLEAN`/`LEAKED`, and asserts `CLEAN`.

## Correction 4 — never-existing vs prior-instance session identities are distinguished, and incarnation checks are consistent

`crates/drogon-core/src/lib.rs` (`require_session_with_incarnation`)

- When no retained handle exists, the engine now consults the persisted row
  (the same logic `session.stop` already used, via `session_row_as_value`):
  - unknown id → `not_found("session not found")`;
  - existing row, wrong incarnation → `stale_incarnation` (previously only
    `stop` fenced this way);
  - existing row, correct incarnation → `unverifiable("session exists but has
    no active handle in this service instance")`.
- Applies uniformly to `session.read`, `session.write`, and `session.resize`;
  `session.stop` behavior is unchanged (it already had the fallback).
- Test (`crates/drogon-core/tests/engine.rs`):
  `unknown_session_ids_are_not_found_while_recovered_ones_are_unverifiable` —
  never-existing id → `not_found` on all four methods; recovered prior-instance
  row with correct incarnation → `unverifiable`; with a wrong incarnation →
  `stale_incarnation` on all four methods.

## Explicitly not done (per instructions)

- No JSON-recursion change: `serde_json 1.0.151` enforces its 128-level
  recursion limit; the review claim was rejected by the coordinator.
- No panic-hardening of the request ledger (waiter completion on leader
  panic) — explicit follow-up.
- No memory/durable-output retirement policy for long-dead sessions — would
  need a new contract segment; listed as follow-up, not invented.
- No changes outside `crates/drogon-core/**`, `crates/drogond/**`, and this
  document; no dependency, lockfile, CLI, desktop, script, or Git changes.

## Follow-ups for coordination (from the review's NIT list, unchanged)

1. Panic-safe completion of request waiters (catch_unwind or panic-hook based
   slot completion).
2. Bounded retained-output memory and a retirement/retention contract
   (requires coordinator-owned contract text).
3. Storage-failure retry resource limits for the exit-persistence poller.
4. Deterministic `created_at` ordering (sub-second timestamps or a sequence
   column).
5. Real live-child crash-recovery evidence (current test models crash by
   dropping `Engine`; a real process-death fixture is stronger).

## Verification evidence (exit codes checked explicitly, no pipe masking)

```
cargo fmt --package drogon-core --package drogond              → exit 0
cargo fmt --package drogon-core --package drogond -- --check   → exit 0
cargo test -p drogon-core -p drogond --locked --offline        → exit 0
  48 tests passed, 0 failed (4 unit drogond + 16 engine + 3 database-path
  + 2 exit-observation + 2 harness_catalog + 1 native-release + 2
  session-persistence + 2 workspace-path-safety [linux-gated, 0 run here]
  + 9 drogond server + 9 drogon-core unit)
cargo clippy -p drogon-core -p drogond --all-targets --locked --offline
  -- -D warnings                                               → exit 0
cargo build -p drogon-core -p drogond --offline --release      → exit 0
```

## Files modified

- `crates/drogond/src/server.rs`
- `crates/drogond/src/lib.rs`
- `crates/drogond/tests/server.rs`
- `crates/drogon-core/src/session.rs`
- `crates/drogon-core/src/lib.rs`
- `crates/drogon-core/tests/engine.rs`
- `crates/drogon-core/tests/native-release.rs` (new)
- `docs/migration/core-review-corrections.md` (this document)

## Platform limits

- Descriptor-count enumeration uses `/dev/fd` (macOS) or `/proc/self/fd`
  (Linux); the fd-growth test is unix-gated like the rest of the suite.
- Windows remains unimplemented and unclaimed (`ServeError::UnsupportedPlatform`);
  the accept-loop fix is unix-only code, consistent with the existing slice.
