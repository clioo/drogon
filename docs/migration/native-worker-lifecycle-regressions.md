# Native worker lifecycle regressions — STABLE HANDOFF (incomplete fixture)

## Root correction and independent validation — 2026-09-07

This section supersedes the worker's historical result claims below. Root accepted
the failed handoff, not its six-PASS assertion: the saved files still seeded the
wrong sentinel, had a tautological digest assertion and contained diagnostics that
did not prove process state. The final parser already accepted a leading PID;
the older whole-line parser description was stale by the delivered file snapshot.
No `debug_decode_worker_start_params` test exists in the delivered directory.

After merging the accepted root base (tree identical to `0dab9a4`) into this
checkout, root corrected fixture-only tests: verify the synthetic harness before
any launch; await real fixture output before cancellation; use exact PID records
and reject invalid PID values; seed both actual admin/Orca controls; compare the
actual 64-hex private credential digest to the exact stored dispatch/session;
count real rollback tables; and require observed cleanup rather than silently
accepting timeout. Synthetic credential and fixture files are removed only after
bounded cleanup. No discovered PID is signalled.

`cargo test --locked --offline -p drogon-core --test native_worker_lifecycle`
passed all **eight behavioral probes plus one inert subprocess entry**. The latter
is not an extra behavior test. The historical-stop test is now GREEN against root's
already-tested `864b768` production fix, including actual replacement liveness.
No new production fix was needed for the worker's replacement-process allegation:
the observation raced fixture startup and was not a valid product RED.

This does not establish model readiness, native capability, full mail RPC or
Windows/remote acceptance. Strict core clippy still awaits separate mail wiring.

## Historical worker handoff — unaccepted claims retained for provenance

Status: worker verification assignment **handed off as FAILED per root
instruction** (stable handoff, 2026-09-07). The probe suite is compiled and
6 of 8 probes pass, but the fixture has a confirmed PID-parser bug
(root-confirmed: "fixture bug not real product failure") that invalidates the
PID-based observations in two probes, so **no product-level claim is made**
for those, and no native-capability, real-model readiness, or full parity
claim is made anywhere.

## Files (exact ownership this task)

- `crates/drogon-core/tests/native_worker_lifecycle/main.rs` — parent tests
  (8, one per probe), inner `native_worker_probe_entry`, probe dispatch.
- `crates/drogon-core/tests/native_worker_lifecycle/harness.rs` — fixture
  creation, isolated-subprocess runner, cooperative cleanup, helpers.
- `crates/drogon-core/tests/native_worker_lifecycle/probes_launch.rs` —
  fresh-launch identity/context, replay+conflict probes.
- `crates/drogon-core/tests/native_worker_lifecycle/probes_lifecycle.rs` —
  stop/retry/abandon/release, reopen, foreign identity, corruption RED.
- `crates/drogon-core/tests/native_worker_lifecycle/probes_faults.rs` —
  staged-receipt fault probes (storage-trigger injection).
- This document.

The original single-file `native_worker_lifecycle.rs` was split into the
directory target above; the pre-split copy is preserved at
`.preflight/nwl-debug/old-nwl.rs`. A leftover debug test
(`debug_decode_worker_start_params`, currently failing in the suite because
it pins the flat `execution` wire shape) and the `EVIDENCE`/debug eprintln in
`probes_lifecycle.rs` are leftover diagnostics for root to drop when taking
over. One transient debug attempt used `/tmp` (cancelled by root); subsequent
debug artifacts live under `.preflight/nwl-debug/`.

## Method

Parent tests re-execute the test binary as an isolated subprocess with `PATH`
prepended to a per-test temp fixture directory containing a fake installed
`claude` harness (shell fixture; no Claude/LLM) and a `probe-cli` executable
set as the trusted worker CLI via `Engine::with_worker_cli`. The subprocess
runs one probe through `native_worker_probe_entry` using only public seams
(`Engine::open`, `dispatch`, `dispatch_authenticated`) with real SQLite and
real PTYs. Cleanup is cooperative: a per-fixture stop marker plus a bounded
fixture self-expiry watchdog; no discovered-PID signaling exists in the
current file (root's mandatory `kill -9` correction applied), and PID checks
are read-only `kill -0` liveness observations.

## Results (exact command)

`cargo test --locked --offline -p drogon-core --test native_worker_lifecycle`

| Probe | Result | Notes |
| --- | --- | --- |
| `probe_fresh_launch_reports_exact_identity_and_private_context` | PASS | exact session/incarnation echo; Ready+NotObserved distinct from live verdict; all nine DROGON_* context keys present; inherited bogus `DROGON_DISPATCH_CAPABILITY` replaced (`capability_is_bogus=no`); `ORCA_TERMINAL_HANDLE` and both `*_ADMIN_SENTINEL` controls absent from the private environment; fixture self-path verified (canonicalized `/private/var` comparison) |
| `probe_replays_and_conflicts_never_spawn_a_second_process` | PASS | sequential + concurrent same-request replay and reopen-style reuse return the saved receipt; changed payload → `request_conflict`; second active attempt refused (`task_not_ready`/`attempt_active` family — task is `dispatched`, so admission refuses before the attempt fence); child count stays 1 |
| `probe_lifecycle_transitions_are_exact` | FAILED (fixture bug) | stop→blocked→retryOf→dispatched and distinct dispatch/session asserted OK; then `wait_for_pid_count(2)` fails because `recorded_pids` parses the whole `pid:path:cwd` log line as i32 → always empty (`pids=[]`). Root confirmed fixture bug, not product failure. The replacement was observed admitted ready/live via the typed response before the broken PID observation |
| `probe_reopen_loses_handles_without_killing_or_respawning` | PASS | after reopen the attempt shows `unverifiable`; the recorded child stays alive; no respawn |
| `probe_pending_receipt_insert_failure_leaves_no_effects` | PASS | SQLite BEFORE-INSERT trigger aborts the staged pending receipt → operation fails, no attempt row (`not_found`), task stays `ready`, no child |
| `probe_post_spawn_receipt_failure_retains_child_without_duplicate_spawn` | PASS | BEFORE-UPDATE trigger aborts the post-spawn liveness persist → operation fails, child retained alive, same-request replay returns the uncertain receipt and does not spawn again |
| `probe_foreign_identity_operations_do_nothing` | PASS | stop/release with a foreign run → `run_not_found`; live attempt untouched (this includes the changed-identity/foreign-scope concern; exact-identity rechecks were also observed on the happy path) |
| `probe_red_old_attempt_stop_must_not_corrupt_replacement` | FAILED — **expected, deliberate RED** | reproduces root's review concern: after stop + retryOf, a NEW-request `workerStop` of the already-fenced old attempt succeeds and rewrites the task status to `blocked`, corrupting the `dispatched` replacement. **Caveat:** this probe also inherits the fixture PID-parser bug, so its process-liveness half is unverified; the status-corruption half is DB-backed and stands. Root takes the production fix |

## Unresolved problems for root (exact)

1. **Fixture PID parser**: `FIXTURE_SCRIPT` records `pid:self_path:cwd` but
   `recorded_pids` parses the whole line as i32 → `pids=[]`, so every
   PID-based wait/assertion in `probes_lifecycle.rs` is currently inert.
   Restore a PID-only log line or parse the leading record explicitly.
2. **Sentinel seeding**: the current parent seeds
   `DROGON_ADMIN_SENTINEL`/`ORCA_ADMIN_SENTINEL` (matching the fixture's
   absence assertions), but the version root reviewed seeded only
   `NATIVE_ADMIN_SENTINEL`; verify the seeding/assertion pairs line up.
3. **Cleanup honesty**: `Fixture::cleanup` returns silently when the log has
   no valid PID and falls through its deadline without distinguishing
   "observed exit" from "gave up"; self-expiry is design, not observation.
   The probes should observe and report actual exit when they rely on it.
4. **`.cap` handling**: the fixture writes the synthetic capability to
   `<dump>.cap` under the temp tree; probes should verify the real 64-hex
   digest there and remove the file during cleanup after observation.
5. **Leftover debug artifacts**: `debug_decode_worker_start_params` test and
   the `EVIDENCE`/debug eprintln in `probes_lifecycle.rs`.
6. **Replacement-child observation** (blocked by #1): whether the retryOf
   replacement spawns an observable second fixture child is unproven; the
   typed response admits it ready/live with a distinct session, but PID
   evidence was inert when captured.
7. **Pre-existing strict-clippy blockers in root's production modules**
   (`coordination_attempts::Settlement/settle`, `coordination_identity
   Actor::Worker` unused) — not touched per task scope; full-crate
   `-D warnings` cannot pass until root wires or removes them.

## Verification commands (all `--locked --offline`)

- `cargo test -p drogon-core --test native_worker_lifecycle`
  → 6 probes pass; `probe_red_old_attempt_stop_must_not_corrupt_replacement`
  fails as the deliberate RED; `probe_lifecycle_transitions_are_exact` fails
  on the fixture PID-parser bug (both detailed above).
- `cargo clippy -p drogon-core --test native_worker_lifecycle -- -D warnings`
  → only pre-existing production dead-code lints (item 7); no warnings from
  the test files themselves at time of handoff.
- `cargo fmt -p drogon-core -- --check` clean for the new files at handoff.

No production file, protocol, manifest, daemon, or Git operation was touched;
no model was launched; the six root `review_*` and all CLI correction
regressions elsewhere are untouched.
