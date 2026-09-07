//! Independent native-worker lifecycle verification through the PUBLIC engine
//! seams only: `Engine::open` + `with_worker_cli` + `dispatch` /
//! `dispatch_authenticated` against real SQLite and real PTYs.
//!
//! Determinism without process-global env mutation: each parent test
//! re-executes this test binary as an isolated subprocess with `PATH`
//! prepended to a temp fixture directory containing a fake installed `claude`
//! harness (a shell fixture, no Claude/LLM) and a `probe-cli` executable used
//! as the trusted worker CLI. The subprocess runs exactly one probe through
//! `native_worker_probe_entry`; every probe asserts it actually used the
//! fixture harness and keeps all effects under its temp directory.
//!
//! Cleanup safety (no discovered-PID signaling, ever): the fake harness
//! self-expires through a bounded watchdog loop and exits cooperatively when
//! the per-fixture stop marker appears; cleanup touches that marker and waits
//! a bounded time for observed self-exit. The engine-owned sessions are
//! stopped only through `orchestration.workerStop` (the production
//! exact-handle path), and `Child::kill` is used only on the exact retained
//! probe-subprocess handle after its timeout. PID checks are read-only
//! `kill -0` liveness observations.
//!
//! These tests verify the candidate integration through public seams only.
//! They are not a native-capability, real-model readiness, or full parity
//! claim, and they prove nothing about Windows: `cfg(unix)` scopes the PTY
//! subprocess coverage rather than faking a Windows pass.

#![cfg(unix)]

mod harness;
mod probes_faults;
mod probes_launch;
mod probes_lifecycle;

use harness::Fixture;

#[test]
fn probe_fresh_launch_reports_exact_identity_and_private_context() {
    let fixture = Fixture::new("p1");
    let run = fixture.run("fresh_launch_context");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn probe_replays_and_conflicts_never_spawn_a_second_process() {
    let fixture = Fixture::new("p2");
    let run = fixture.run("replay_and_conflicts");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn probe_lifecycle_transitions_are_exact() {
    let fixture = Fixture::new("p3");
    let run = fixture.run("lifecycle_transitions");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn probe_reopen_loses_handles_without_killing_or_respawning() {
    let fixture = Fixture::new("p4");
    let run = fixture.run("reopen_unverifiable");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn probe_pending_receipt_insert_failure_leaves_no_effects() {
    let fixture = Fixture::new("p5");
    let run = fixture.run("pending_insert_fault");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn probe_post_spawn_receipt_failure_retains_child_without_duplicate_spawn() {
    let fixture = Fixture::new("p6");
    let run = fixture.run("post_spawn_persist_fault");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

#[test]
fn probe_foreign_identity_operations_do_nothing() {
    let fixture = Fixture::new("p7");
    let run = fixture.run("foreign_identity_no_effect");
    assert_eq!(
        run.exit_code, 0,
        "stdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

/// Historical stop must preserve both replacement task state and its live process.
#[test]
fn probe_old_attempt_stop_preserves_replacement() {
    let fixture = Fixture::new("p8");
    let run = fixture.run("old_attempt_stop_corruption");
    assert_eq!(
        run.exit_code, 0,
        "Stopping an already-fenced old attempt corrupted the \
         replacement task state.\nstdout:\n{}\nstderr:\n{}",
        run.stdout, run.stderr
    );
}

/// Inner entry: the parent re-executes this binary filtered to this test with
/// `NATIVE_PROBE` selecting exactly one probe.
#[test]
fn native_worker_probe_entry() {
    let Ok(probe) = std::env::var("NATIVE_PROBE") else {
        return; // Ordinary suite run: the parent tests drive the probes.
    };
    let env = harness::ProbeEnv::from_parent_env();
    // Cooperative cleanup on success or panic: the stop marker ends the
    // fixture loop; its bounded watchdog ends everything else.
    let _guard = harness::StopMarkerGuard::new(&env);
    match probe.as_str() {
        "fresh_launch_context" => probes_launch::fresh_launch_context(&env),
        "replay_and_conflicts" => probes_launch::replay_and_conflicts(&env),
        "lifecycle_transitions" => probes_lifecycle::lifecycle_transitions(&env),
        "reopen_unverifiable" => probes_lifecycle::reopen_unverifiable(&env),
        "foreign_identity_no_effect" => probes_lifecycle::foreign_identity_no_effect(&env),
        "old_attempt_stop_corruption" => probes_lifecycle::old_attempt_stop_corruption(&env),
        "pending_insert_fault" => probes_faults::pending_insert_fault(&env),
        "post_spawn_persist_fault" => probes_faults::post_spawn_persist_fault(&env),
        other => panic!("unknown probe {other}"),
    }
}
