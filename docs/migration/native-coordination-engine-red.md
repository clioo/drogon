# Native coordination engine: pre-implementation RED

Compiled, real `Engine::open`/`Engine::dispatch` integration tests for
`orchestration.run*`/`task*` against an isolated temp data dir — no mock
domain, no fake store, no `orchestration.*` method implemented. Owned
files this task: `crates/drogon-core/tests/orchestration_runs_tasks.rs`,
this document, and gitignored evidence under `.preflight/native-engine-red/`.

Source anchors: the accepted 59-test native coordination store baseline
(`docs/migration/native-coordination-store-baseline.md` and its
`source-test-to-contract-map.json`, root-accepted at `010f818`) and the
frozen params/error-code decisions in
`docs/migration/native-coordination-contract.md`. Neither is edited or
rerun here; only cited in each test's own doc comment for provenance.

## Correction: this is now a real RED suite, not a passing characterization of absence

A prior pass had one test assert `method_not_found` as a *passing*
outcome and left the nine behavioral tests `#[ignore]`d. Root rejected
that: an ignored test proves nothing, and asserting the absence itself as
"ok" is not RED. Corrected here: the absence-assertion test is deleted;
all nine behavioral tests are real, unignored `#[test]`s that assert the
actual desired outcome (`ok(...)` on `orchestration.runCreate`/`taskCreate`,
etc.) against the real, unimplemented `Engine`. Every one of them fails
today — genuinely, not by design-around — because `dispatch_inner` has no
match arm for any `orchestration.*` method yet
(`crates/drogon-core/src/lib.rs`).

**All nine fail for the identical single reason**, visible in the
transcript below: each test's first `ok(engine, "orchestration.runCreate", ...)`
call panics at the same line (`orchestration_runs_tasks.rs:36:5`) on the
same `RpcError { code: "method_not_found", ... }`. This is one proven fact
— the method does not exist — not nine independently-exercised bugs.
Whatever a given test asserts *after* that first call (replay identity,
`consumerGeneration`, dependency-pending status, `consumer_fenced`
takeover fencing, list/show durability) is specified for when the
method exists, but is not reached or exercised today; the panic happens
before any of it runs. Neither the failed count (9) nor the passed/ignored
count below should be read as a parity or coverage measurement — they
describe this one absent-capability fact, once, from nine call sites.

The tenth test, `engine_still_serves_status_and_workspace_control`, is a
positive control (mirrors `crates/drogon-core/tests/engine.rs`'s own
`workspace_register_is_idempotent_by_path`) proving `Engine::open`,
`status`, and `workspace.register` are unaffected — so none of the nine
failures above can be misread as "the engine itself is broken."

## Deleted: the empty ignored failed-prerequisite test

A prior pass had an empty, `#[ignore]`d test body for "a dependent task
never becomes ready when a prerequisite failed/blocked" — an empty
function is not a test, pretend or otherwise, and has been deleted
outright rather than kept as a placeholder. The obligation itself is real
and remains open: restates accepted `db-task-create-readiness.test.ts`'s
"does not unlock a dependent whose dependency is failed/blocked" case.
Exercising it needs a real failed worker report
(`orchestration.send`/`workerStart`+`workerStop`), out of this file's
runs/tasks-only scope — recorded here as a named gap, not as a test.

## Exact command and result

```
cd /Users/carlos/orca/workspaces/Drogon-rewrite/codex-native-coordination-store
cargo test --locked --offline -p drogon-core --test orchestration_runs_tasks
```

```
running 10 tests
test run_create_replays_same_run_for_same_request_id_and_payload ... FAILED
test task_create_dependent_task_is_pending_until_dependencies_complete ... FAILED
test task_create_refuses_cross_run_dependency_without_allocating_task ... FAILED
test task_create_refuses_missing_dependency_without_allocating_task ... FAILED
test run_and_task_list_show_survive_engine_reopen ... FAILED
test run_create_returns_run_id_and_consumer_generation_one ... FAILED
test task_create_root_task_without_dependencies_is_ready ... FAILED
test run_use_takeover_fences_old_coordinator_generation ... FAILED
test run_create_refuses_conflicting_payload_for_same_request_id ... FAILED
test engine_still_serves_status_and_workspace_control ... ok

test result: FAILED. 1 passed; 9 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
error: test failed, to rerun pass `-p drogon-core --test orchestration_runs_tasks`
```

Every one of the nine failures panics at the identical location with the
identical cause:

```
thread '<test name>' panicked at crates/drogon-core/tests/orchestration_runs_tasks.rs:36:5:
expected ok for orchestration.runCreate: Some(RpcError { code: "method_not_found", message: "Unknown method: orchestration.runCreate", retryable: false })
```

**Process exit code: 101** — Rust's own convention for "compiled cleanly,
tests ran, at least one failed" (not a compile error; `cargo check`
against the same target produces zero errors, only the three pre-existing,
unrelated `run_atomic`/`insert_done_receipt` dead-code warnings from the
not-yet-wired database-only receipt seam). Full stdout, exit code, UTC
timestamp, and exact HEAD commit are retained at
`.preflight/native-engine-red/cargo-test-orchestration_runs_tasks.stdout.txt`
and `...exit-code.txt` (gitignored).

## What each RED test restates

| Test | Restates |
| --- | --- |
| `run_create_returns_run_id_and_consumer_generation_one` | `orchestration-run-delivery-db.test.ts` first-creation `consumer_generation: 1` |
| `run_create_replays_same_run_for_same_request_id_and_payload` | `RequestLedger` replay (`requests.rs`) extended to a coordination method |
| `run_create_refuses_conflicting_payload_for_same_request_id` | existing `error::request_conflict()` (`requests.rs`) |
| `task_create_root_task_without_dependencies_is_ready` | `db-task-create-readiness.test.ts`, trivial zero-dependency case |
| `task_create_dependent_task_is_pending_until_dependencies_complete` | `db-task-create-readiness.test.ts` "promotes only after every dependency completes" |
| `task_create_refuses_missing_dependency_without_allocating_task` | `db-task-create-readiness.test.ts` "rejects missing dependencies without inserting a task"; verified via a following `taskList` |
| `task_create_refuses_cross_run_dependency_without_allocating_task` | same family, cross-run variant; asserts run A stays empty and run B retains only its original task |
| `run_and_task_list_show_survive_engine_reopen` | `orchestration-run-delivery-db.test.ts` reopen-durability pattern; exercises `runShow`+`runList`+`taskShow`+`taskList` after a real second `Engine::open`, matching the test's own name |
| `run_use_takeover_fences_old_coordinator_generation` | `orchestration-run-delivery-db.test.ts` "rebinds a Run by incrementing its consumer generation" + "fences an outstanding batch when the Run consumer changes" (source asserts `{code: 'consumer_fenced'}` exactly — used verbatim, not an invented code) |

Two params corrections from the prior pass, both applied above:
`taskShow` now carries `coordinatorId`/`consumerGeneration` (every
task inspection carries coordinator scope; run inspection permits host scope);
`runUse` takeover is now explicit
(`takeover: true` plus the caller's own known current
`consumerGeneration: 1`), not an implicit rebind triggered merely by a new
`coordinatorId`.

## What is explicitly not done here

- No `orchestration.*` method is implemented or wired into
  `dispatch_inner`.
- No production code, dependency, `Cargo.toml`, or shared runner/verifier
  script was edited.
- The accepted 59-test source baseline was not rerun.
- Windows behavior is not addressed (`#![cfg(unix)]`, matching
  `engine.rs`).
- `failed/blocked` prerequisite gating has no test at all right now (see
  "Deleted" above) — a named gap, not silently folded into the nine above.

Root independently reproduced the 1-pass/9-failure result. The transcript
above precedes formatting and the additional run-B assertion; its line
numbers are historical. This suite remains intentionally RED on the
feature branch, not accepted for merge to `main`. Full wire review and
runtime integration remain open; Engine reopen is not a separate-process
restart test.
