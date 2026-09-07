Vertical / scope / base SHA / head SHA / branch / worktree:
V1 (motor/CLI). Native dogfood only, per `five-vertical-handoff.md` §6 V1
"primeras entregas" item 3. Base = head: `596ddbd9e8b6fdc5d5fa26616479e910b34ba604`
(merge of `codex/native-coordination-contract`, PR9). Branch
`codex/vertical-01-runtime-cli`, worktree
`/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-01-runtime-cli`.
Working tree was clean before this task; no other files were touched.

Capabilities and original contract/test IDs:
`orchestration.native.v1` (18 native entry points from PR9): `status`,
`workspace.register`, `orchestration.runCreate`, `orchestration.taskCreate`,
`orchestration.taskShow`, `orchestration.workerStart`,
`orchestration.workerShow`, `orchestration.workerRelease`,
`orchestration.send` (worker + coordinator actor). WP-ENG-RUNTIME /
WP-ENG-CLI / WP-ENG-DAEMON. No existing automated test in this repo
previously drove a *real* `drogond` process end to end through the compiled
`drogon-cli` binary; existing `orchestration_commands.rs` /
`orchestration_auth.rs` suites are CLI-argument-mapping tests against an
in-process mock transport (`tests/common/mod.rs::MockService`), explicitly
documented there as "NOT native engine parity."

Changed paths; shared-file patch requested:
Only the two files this task authorized:
`crates/drogon-cli/tests/native_dogfood.rs` (new),
`docs/migration/verticals/V1/dogfood-evidence.md` (new, this file). No shared
file (Cargo.toml/.lock, drogon-protocol, lib.rs/db.rs, registries, .github)
touched. No commit/push made.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Studied `crates/drogond/src/{server.rs,endpoint.rs,lib.rs}`,
`crates/drogon-core/src/{coordination_launch.rs,coordination_workers.rs,
coordination_worker_control.rs,session_admission.rs,coordination_attempts.rs,
coordination_mail_rpc.rs,coordination_access.rs,harness.rs}`,
`crates/drogon-harness/src/{discovery.rs,launch.rs,lib.rs}`, and
`crates/drogon-cli/src/{commands.rs,cli.rs,orchestration_cli.rs,
orchestration_commands.rs,credential.rs,paths.rs,error.rs}` to learn the real
admission/spawn/report/retry/release path (not just the CLI's argument
mapping). Before this test existed, no automated coverage exercised that
path with a real daemon process; running the new test file against the
current tree is therefore itself the first RED→GREEN cycle for this
capability (no prior "port an existing failing test" baseline applied here,
since the assignment is a fresh dogfood test, not a source port).

`cargo test -p drogon-cli --test native_dogfood --locked` — GREEN, exit 0,
1 passed / 0 failed / 0 ignored, ~1.1-1.8s wall (plus a one-time
`cargo build --locked -p drogond` the test performs itself, since `drogond`
is a sibling crate's binary not otherwise reachable via `CARGO_BIN_EXE_*`
from `drogon-cli`). Re-ran 8+ consecutive times after fixing one initial
race (see below) with no failures. Also ran, scoped to this new file only:
`cargo fmt -p drogon-cli -- --check` (clean) and
`cargo clippy -p drogon-cli --test native_dogfood --locked -- -D warnings`
(clean, 0 warnings). Did not run the full workspace `cargo test --workspace`
gate; that is a broader closure than this dogfood checkpoint and is left to
whoever integrates this with the rest of V1's remaining families.

One real RED caught and fixed during iteration: the first version polled for
the *existence* of `first-report.json`/`late-report.exit` as the "worker
finished" signal, but a shell `>` redirect creates/truncates the file the
instant it is opened, before the redirected command has produced any bytes —
so the test intermittently observed an empty file mid-write (failed 4 of the
first 6 runs with `EOF while parsing a value`). Fixed by having the fixture
script `touch done` as its unconditionally-last, strictly-sequential action
and polling for that marker instead; 8/8 clean runs afterward.

What the test actually does (`native_daemon_and_cli_run_a_fixture_task_end_to_end`):
1. Builds the real `drogond` binary (`cargo build --locked -p drogond`) into
   the same `target/debug` directory as the already-built `drogon-cli`
   binary, matching `configure_worker_cli`'s sibling-executable discovery.
2. Writes a fixture "harness" executable named `claude` (matching
   `drogon_harness::HarnessId::Claude::executable()`) and prepends its
   directory to `drogond`'s own `PATH`, so `drogon_harness::discover` (run
   inside the daemon process) finds it exactly as it would a real Claude
   Code install — no real model/provider/network is used anywhere.
3. Spawns the real `drogond --data-dir <ephemeral tmp>` as an OS child
   process and polls for its Unix socket + `auth.token` file, then a real
   `status` round trip, before proceeding.
4. Drives everything else exclusively through the compiled `drogon-cli`
   binary (never the library directly): `status`, `workspace add` (two
   separate registered workspace directories), `orchestration run-create`
   (with an explicit `--host` pinned against the daemon's own identity),
   `orchestration task-create`.
5. `orchestration worker-start --harness claude --model fixture-fail
   --permission-mode unattended`: a fresh real spawn under the real
   admission/session-reservation path. The fixture process writes an
   on-disk artifact file naming its own dispatch id and mode, then calls
   back into the *same* `drogon-cli` binary (via the daemon-injected
   `$DROGON_CLI_COMMAND`/`$DROGON_DATA_DIR`/`$DROGON_DISPATCH_CAPABILITY`
   env) to send a real `orchestration send --kind final-report --outcome
   failed`. The test inspects the produced artifact bytes on disk, confirms
   `worker-show` reports `assignmentState: failed, outcome: failed`, and
   `task-show` reports the task `failed`.
6. `orchestration worker-start --retry-of <dispatch-1> --model
   fixture-succeed`: an explicit retry of the failed attempt (exercising the
   real `task_not_ready`→retry-allowed gate in
   `coordination_launch.rs::prepare_coordination_launch`), producing a new
   dispatch id, a new on-disk artifact, and a real `outcome: succeeded`
   final report (`worker-show`/`task-show` confirm `completed`).
7. From inside that same successful worker process (same dispatch
   credential, after its own attempt already settled), a second, genuinely
   conflicting `orchestration send --kind final-report --outcome failed` is
   issued for real. The daemon's `commit_send` refuses it with
   `report_conflict` / "Attempt already reported a different outcome." — a
   real RPC failure (`ok:false`, exit code 1), captured to disk and asserted
   by the test. This is the late-report-after-completion refusal the
   assignment required; it is not simulated or mocked.
8. `orchestration worker-release` on both dispatch ids: both are `settled`
   attempts, both processes had already exited, so both releases return
   `disposition: released` for real (`control_worker_process` observes the
   exited PTY and the store marks the session resource released).
9. Teardown: the `Daemon` guard `kill()`s and `wait()`s the real `drogond`
   child (reaping it, never leaving a zombie or an orphaned live process),
   then the ephemeral data/workspace tempdirs are removed.

Integrated/rendered/platform evidence; exact package identity if applicable:
macOS (Darwin 25.6.0, arm64/host toolchain per `rustc 1.98.0`/`cargo 1.98.0`).
Unix-only test (`#![cfg(unix)]`), matching every other native suite in this
crate. No packaged/installed build touched; this is a source-tree dogfood
test only, not a packaging or release artifact.

Unverified, missing, source defects, deliberate approved deltas:
- Deliberate: the "model" is a fixture bash script, not a real installed
  harness/model, per this task's explicit "fixture-backed task" scope (the
  handoff's "una tarea real... con un modelo aprobado" full dogfood, with a
  real approved model, is out of this bounded task and remains open).
- Deliberate: `--reuse-session`/`--reuse-incarnation` worker-start execution
  is not exercised, because it is not yet implemented
  (`coordination_launch.rs::plan_coordination_launch` returns
  `unsupported_feature` for any non-Fresh execution today) — confirmed by
  reading the source, not assumed.
- Not exercised here (left to the remaining V1 families, not this
  checkpoint): `orchestration ask/reply/check`, `worker-stop`/`worker-abandon`
  signal paths, ledger/receipt replay of a retried request id, Windows named
  pipes, and the 26 additional catalog harness ids beyond the 4 launchable
  ones.
- The `cargo build --locked -p drogond` step inside the test takes a
  variable, occasionally multi-minute amount of time on a cold target
  directory (compiling `drogon-core` and its dependents); this is expected
  and bounded by the test's own 300s guard, not a defect.
- One untracked file, `crates/drogon-cli/tests/argument_parity.rs`, appeared
  in this shared worktree during this task (timestamped just before this
  work started) that this task did not create and did not touch, per the
  read-only-outside-scope instruction; flagging it here for the coordinator
  since it is not part of this delivery.

Dependencies requested; next bounded checkpoint:
None blocking. Next bounded checkpoint (not started here): close the
remaining V1 "primeras entregas" items — cancellation/mail/receipts
concurrent+rollback+reopen tests, then the remaining command/harness
families — without re-declaring product-wide parity from this one dogfood.

Owned processes: session/incarnation/host, settlement/release receipts:
All processes/sessions are owned exclusively by this test's own ephemeral
`--data-dir` (a fresh `tempfile::tempdir()` per run, never a shared/user data
directory). Two dispatches created and released within the test:
dispatch-1 (failed, retried) and dispatch-2 (succeeded, its retry), each with
its own session id/incarnation minted by the daemon; both explicitly
`orchestration worker-release`d (disposition `released`) before the daemon
process itself is killed and reaped by the test's `Daemon::drop`. No process
or handle survives the test.

Rollback; data/credentials/privacy check:
Nothing durable was created outside the test's own tempdir (removed on
drop). No credentials, tokens, or real provider secrets were used anywhere;
the only "credential" involved is the daemon-minted, per-attempt dispatch
capability, scoped to its own ephemeral data dir and never logged. No
rollback needed; nothing was committed, pushed, or installed.

Ready for independent review: yes.

---

## Checkpoint 2 (follow-up): real approved-model leg

Vertical / scope / base SHA / head SHA / branch / worktree:
V1, same worktree/branch as above, same base SHA
`596ddbd9e8b6fdc5d5fa26616479e910b34ba604` (no new commits by this task
either). Follow-up to Checkpoint 1: extend the GREEN fixture dogfood with one
bounded *real* approved-model execution through the native daemon path, per
the explicit follow-up assignment. Edited only the two files this task
authorized (both already owned by Checkpoint 1):
`crates/drogon-cli/tests/native_dogfood.rs`,
`docs/migration/verticals/V1/dogfood-evidence.md`.

Real-model verdict: **a real path is executable here and was exercised for
real.** All four of the CLI harness binaries `drogon_harness::HarnessId`
knows about are actually installed on `PATH` on this host:
`claude` (`/Users/carlos/.local/bin/claude`, Claude Code 2.1.263),
`opencode` (`/Users/carlos/.opencode/bin/opencode`, 1.18.29, with 10 stored
provider credentials per `opencode auth list`: OpenCode Go, OpenAI oauth,
Kimi For Coding, MiniMax, OpenRouter, OpenCode Zen, Cerebras, Z.AI Coding
Plan, Z.AI, Alibaba Token Plan), `pi` (`/opt/homebrew/bin/pi`), and `agy`
(`/Users/carlos/.local/bin/agy`). `claude --print` was chosen as the probe:
it is explicitly listed as an accepted option in the assignment, it is a
genuine one-shot non-interactive completion (exits on its own — no
`--dangerously-skip-permissions`/agentic loop needed for a trivial prompt,
which is what makes a *tight* bounded timeout possible for something that
reaches the real network), and it authenticates via the same
already-provisioned Anthropic credentials this very Claude Code session runs
under (macOS Keychain entry `Claude Code-credentials`) — nothing was
written, copied, or provisioned by this task.

Direct-shell probe (no daemon, sanity check before wiring into the daemon
path), run twice, both real network calls:
```
$ claude --print --output-format json \
    "Reply with exactly this text and nothing else: DROGON-REAL-MODEL-OK"
```
Run 1: plain `--print`, `DROGON-REAL-MODEL-OK`, 8.4s wall (cold start).
Run 2: `--output-format json`, `result:"DROGON-REAL-MODEL-OK"`,
`modelUsage.claude-haiku-4-5-20251001` (`canonicalModel: claude-haiku-4-5`,
`provider: firstParty`), `duration_api_ms: 2395`, `total_cost_usd: 0.0200211`,
5.77s wall. These two direct-shell calls cost a real, small amount
(~$0.02 each) — accounted for below, not hidden.

Daemon-wired test added: `real_model_probe_reaches_a_daemon_spawned_session`
in `native_dogfood.rs`. It documents the exact daemon→model wiring with real
output bytes inspected (the assignment's second, lower-risk accepted option,
chosen over a full `orchestration.workerStart` run — see rationale below):
1. Builds the real `drogond` binary exactly as Checkpoint 1 does, but starts
   it with `Daemon::start(.., None)` — **no** fixture bin dir prepended to
   `PATH`, so the daemon's environment is exactly what this test process
   inherited and any harness/binary lookup finds what is genuinely installed.
2. Registers a fresh, real, ephemeral workspace directory via the compiled
   `drogon-cli` (`workspace add`), same as Checkpoint 1.
3. Runs, through the compiled `drogon-cli` against the real daemon:
   `terminal create --workspace <id> -- claude --print --output-format json
   "Reply with exactly this text and nothing else, no other words, no
   punctuation added: DROGON-REAL-MODEL-OK"`. `terminal create` calls the
   daemon's `session.start`, which reserves and spawns via
   `session_admission::reserve`/`launch_reserved` -> `spawn_pty` — the
   identical spawn engine `harness.start` and `orchestration.workerStart`
   both build on for a fresh launch (`do_harness_start` literally calls
   `self.do_session_start(...)` with the resolved harness command/args); this
   test exercises that shared engine directly with a real subprocess and a
   real model on the other end, without also needing the model to
   autonomously complete an agentic loop and call back into
   `orchestration send` (that report/retry/refusal wiring is already
   real-exercised by the fixture leg in Checkpoint 1, deliberately isolated
   from real model non-determinism/cost).
4. Polls `terminal read` (bounded 60s, generous above the ~2-9s observed
   locally) until the daemon reports the session's own `verdict: exited`,
   base64-decodes the real `dataBase64` bytes from that read, and asserts
   the decoded text contains the requested marker.

GREEN result (rerun immediately before finalizing, `--nocapture`):
```
session_id: bf50c0d0-67c2-4335-ab74-fd1718aee0f7
incarnation: 22faf375-0d16-41c9-962a-45cb40a56e73
daemon-observed exit code: 0
wall latency (session create -> observed exited verdict): 5.622814667s
output bytes: 1802 (base64-decoded from the real daemon session read)
```
The decoded bytes are the real `claude --print --output-format json` result
envelope: `"result":"DROGON-REAL-MODEL-OK"`, `"is_error":false`,
`"subtype":"success"`, `modelUsage.claude-haiku-4-5-20251001`
(`canonicalModel: claude-haiku-4-5`, `provider: firstParty`,
`costUSD: 0.0221489`), `duration_api_ms: 2342`, `num_turns: 1`, plus a
trailing `\r\n\x1b[?25h` (an ordinary PTY cursor-show escape, not part of the
model's output) — proving the bytes really passed through a real PTY, not a
pipe. Total real spend across all probe/test runs this session: 4 real
`claude` completions (~$0.02-0.03 each per the `total_cost_usd` fields
above), roughly $0.09 total.

Why gated, not run by default: this test reaches the real network, spends
real (small) provider tokens, and its pass/fail depends on host-local
credentials this suite must never provision, copy, or persist itself (per
the read-only-credentials constraint). It is gated behind an explicit
`DROGON_DOGFOOD_REAL_MODEL=1` opt-in env var; without it, the test prints why
it is skipping and passes (not fails, not silently absent), so a routine
`cargo test -p drogon-cli --test native_dogfood --locked` — including the
exact command this task's gate requires — never silently spends money or
flakes on network/credential availability on another host or CI runner.

GREEN commands + exit codes/counts:
- `cargo test -p drogon-cli --test native_dogfood --locked` (default, no
  opt-in env var): exit 0, **2 passed / 0 failed / 0 ignored**
  (`native_daemon_and_cli_run_a_fixture_task_end_to_end` fully GREEN as in
  Checkpoint 1; `real_model_probe_reaches_a_daemon_spawned_session` prints
  its skip reason to stderr and passes). Re-ran 3 more times after the fmt
  fix below with no failures.
- `DROGON_DOGFOOD_REAL_MODEL=1 cargo test -p drogon-cli --test native_dogfood
  --locked real_model_probe_reaches_a_daemon_spawned_session -- --nocapture`:
  exit 0, 1 passed / 0 failed / 1 filtered out, real network round trip,
  ~5.3-6.4s wall across two runs (one before, one after the clippy fix).
- `cargo fmt -p drogon-cli -- --check`: one diff found and applied
  (`cargo fmt -p drogon-cli`), then clean.
- `cargo clippy -p drogon-cli --test native_dogfood --locked -- -D warnings`:
  one `clippy::cmp_owned` finding (`Value::from("exited")` where a bare
  `"exited"` string comparison suffices), fixed; then clean, 0 warnings.

Unverified, missing, source defects, deliberate approved deltas:
- Deliberate: did not route the real model through a full
  `orchestration.workerStart` fresh launch (which would run `claude` with
  `--dangerously-skip-permissions` and no `--print`, i.e. as a persistent
  interactive agentic session with no natural exit) — that mode has no
  built-in bounded completion signal to poll for without either an arbitrary
  wall-clock cutoff-and-declare-success or the real model autonomously
  choosing to call back into `orchestration send --kind final-report` within
  the timeout, which is real-agent non-determinism this bounded checkpoint
  should not gate on. Documenting the daemon→model wiring via `terminal
  create` (the exact same underlying spawn engine) with real bytes inspected
  was the assignment's own explicitly accepted alternative for exactly this
  situation.
- Deliberate: did not probe `opencode run`/`pi`/`agy` beyond confirming their
  binaries and (for opencode) credentials exist; one working real-model path
  was sufficient per the assignment ("ONE bounded real approved-model
  execution"), and minimizing real provider spend/time across probes was
  preferred once `claude --print` was confirmed working on the first try.
- Not verified: whether `opencode run`/`pi`/`agy` would behave the same way
  (one-shot vs. persistent-session semantics differ per harness/CLI); left
  for a future checkpoint if a different provider becomes the priority.
- The real spend (~$0.09 across this session's probes/runs) is real money,
  not simulated; it is small and bounded, but is a genuine cost of this
  checkpoint's evidence, not zero.

Dependencies requested; next bounded checkpoint:
None blocking. If a future checkpoint wants the *full* handoff-described
dogfood ("una tarea real coordinada mediante Drogon... con un modelo
aprobado", i.e. a real model autonomously completing an
`orchestration.workerStart` fresh launch end to end including its own
final-report), that is a materially larger, non-deterministic, real-cost
undertaking and should be its own explicitly scoped, explicitly costed
checkpoint — not silently assumed satisfied by this bounded `terminal
create` probe.

Owned processes: session/incarnation/host, settlement/release receipts:
One additional real session per real-model test run, owned by that run's own
ephemeral `--data-dir` (ids above); the daemon observes its own `exited`
verdict once the real `claude --print` process exits on its own, and the
test's `Daemon` guard kills/reaps the daemon process afterward exactly as in
Checkpoint 1. No `orchestration` dispatch/credential is minted for this leg
(plain `session.start` via `terminal create`, not `workerStart`), so there is
nothing to release/revoke beyond the session itself, which the daemon
process's own teardown already owns.

Rollback; data/credentials/privacy check:
No credentials were written, copied, or persisted by this task anywhere;
`claude --print` used this host's own pre-existing, already-provisioned
Anthropic credentials (Keychain), read only by the real `claude` binary
itself, never by the test or by drogon-cli/drogond. Nothing durable created
outside the test's own removed tempdir. Real provider tokens were spent
(see cost figures above) — the only "cost" of this checkpoint that isn't
free — but this is expected and bounded, not a privacy or credential leak.
No rollback needed; nothing committed, pushed, or installed.

Ready for independent review: yes.

---

## Checkpoint 3 (task_ad7c01bbd957): dogfood review corrections — hardening the real-model leg

Scope: `crates/drogon-cli/tests/native_dogfood.rs` only (+ this section).
One change per ROOT review; the frozen fixture leg is untouched.

### Correction verdicts

1. **Exact-value opt-in gate + negative tests — DONE.**
   `real_model_opted_in()` now requires `DROGON_DOGFOOD_REAL_MODEL` to be
   the exact string `1` (`matches!(std::env::var(...).as_deref(), Ok("1"))`).
   New test `real_model_leg_skips_without_spending_unless_opt_in_is_exactly_one`
   re-executes the real test binary as a subprocess four times — unset, `0`,
   empty, and a non-`1` word — asserting each: exit 0, printed skip note,
   and a fast return (<30s bound proves no 300s build, no daemon, no session,
   no spend). Subprocesses keep the parent's env free of process-global
   mutation; the default suite run therefore spends nothing.
2. **Strict envelope parsing instead of `contains(MARKER)` — DONE.**
   The decoded PTY bytes must be exactly one `claude --print --output-format
   json` envelope, tolerating only trailing whitespace plus the single PTY
   cursor-show escape (`ESC[?25h`); anything else fails loudly with the raw
   bytes. Asserted: `is_error == false`, `result` EXACTLY
   `"DROGON-REAL-MODEL-OK"` (no contains), and daemon-observed `exitCode`
   `0` before parsing.
3. **Session tracked, closed, and end-observed before shutdown — DONE.**
   The session/incarnation are tracked from creation in a `SessionGuard`
   whose `Drop` performs a best-effort non-panicking `terminal close` during
   any unwind (assertion failure or timeout), while the daemon is still
   alive; the happy path calls an explicit close and asserts the daemon
   observes `verdict: "exited"` BEFORE `Daemon` shutdown — a leaked live PTY
   session is impossible on every path.
4. **`build_drogond` drains cargo stdio concurrently — DONE.** Both pipes
   are drained by reader threads from spawn; the timeout loop polls only the
   child status. Compiler output can no longer fill a pipe buffer and fake
   the 300s build timeout.

### Commands run and outcomes

- `cargo test -p drogon-cli --test native_dogfood --locked` (default):
  **3 passed / 0 failed** — fixture leg green, real-model leg skipped with
  note, negative gate test green. No spend.
- `cargo fmt -p drogon-cli -- --check`: clean.
- `cargo clippy -p drogon-cli --test native_dogfood --locked -- -D warnings`:
  clean.
- `DROGON_DOGFOOD_REAL_MODEL=1 cargo test -p drogon-cli --test
  native_dogfood --locked real_model_probe_reaches_a_daemon_spawned_session
  -- --nocapture`: **GREEN, run twice** (see spend disclosure): second run
  `test result: ok. 1 passed`, whole test 6.22s.

### Evidence (second, fully captured run)

- daemon session_id: `d32ae189-15f3-4d74-a370-87a8a70a6f23`
- incarnation: `766df9eb-e048-41ed-ac02-069ee1ea61e4`
- daemon-observed exit code: `0`; close-observed verdict: `exited`
- wall latency (session create -> observed exited verdict): 5.289s
- claude envelope: `type: result`, `subtype: success`, `is_error: false`,
  `result: "DROGON-REAL-MODEL-OK"` (exact), `duration_ms: 1964`,
  `total_cost_usd: 0.0203`, claude-side `session_id`
  `97321838-976a-4dc3-aa2e-e0fc3c9c3044`
- full log retained at
  `/var/folders/8g/w9x4n8ws4mx6vxjhmnrnwy640000gn/T/opencode/dogfood-evidence-run.log`

### Spend disclosure (honest deviation noted)

Two opted-in invocations occurred, not one. The first run was GREEN
(6.52s) and the strict parsing passed on the first try, but the coordinator
evidence block was truncated by the operator's own `tail` capture and the
ephemeral data dir was already removed, so its session id/latency were
unrecoverable. A second, fully captured run was performed rather than
reporting incomplete evidence. Total real spend: two trivial completions
(~2s API each; second one metered at $0.0203, first similar — dominated by
cache reads). All default/negative runs spent nothing.

What remains: nothing for this checkpoint; both corrections' gates are
green (`cargo test -p drogon-cli --locked` full-suite result recorded
below in the final gate run).

---

## Checkpoint 4 (task_71f48cb1b328): ROOT final-review fixes — no paid rerun

Scope: `crates/drogon-cli/tests/native_dogfood.rs` only (+ this section).
No opted-in run was performed (`DROGON_DOGFOOD_REAL_MODEL` never set); the
only real-model spend remains Checkpoint 3's two disclosed calls.

1. **Honest SessionGuard::Drop — DONE.** The unwind-path close now inspects
   its outcome: closure is reported as proven only when the CLI exited
   successfully AND the daemon observed `exited`; any other outcome prints
   an explicit "unverifiable/cleanup-failed" warning including the CLI exit
   flag, observed verdict, stdout and stderr. The false
   "leaked live PTY session must be impossible" comments were replaced with
   the accurate best-effort semantics (the drop path cannot assert — a
   panic in drop would abort the process — so it reports rather than
   guarantees).
2. **Approved model lane pinned — DONE.** The real-model `terminal create`
   child argv now carries `--model claude-sonnet-5` before `--print`, so the
   bounded test cannot drift onto an unapproved or default model lane and
   stays repeatable.
3. **Shared helpers reused, no new shared code — DONE.** The happy-path
   close keeps `coordinator_call`/`assert_ok`; the unwind path uses the
   file's existing `run_cli`/`stdout`/`stderr` helpers (it cannot use
   `coordinator_call` there because a panic during unwinding would abort).
   An interim extracted helper was removed again rather than ship new shared
   code; no scope widened.

### Commands run (no opted-in run)

- `cargo test -p drogon-cli --test native_dogfood --locked`:
  **3 passed / 0 failed** (fixture leg green; real-model leg skipped with
  note; negative gate test green). Zero spend.
- `cargo test -p drogon-cli --locked`: all 9 targets green (lib 53, main 0,
  argument_parity 22, integration 49, native_dogfood 3, orchestration_auth
  6, orchestration_commands 52, parser 7, doc 0).
- `cargo clippy -p drogon-cli --all-targets --locked -- -D warnings`: clean.
- `cargo fmt -p drogon-cli -- --check`: clean.

What remains: combined verification (including a fresh opted-in real-model
pass under the pinned `claude-sonnet-5` lane) is explicitly deferred to
ROOT's later dispatch, per this checkpoint's no-paid-rerun constraint.

---

## Checkpoint 5 (task_cba1294c6ccf): closure review — exact diff of the held files vs HEAD, zero code changes

Read-only closure review; no hunk was provably wrong, so neither held file's
content was modified by this checkpoint (this appendix is the only addition).

### Exact-diff hunk verdicts

`crates/drogon-cli/tests/native_dogfood.rs` (4 hunks, +50/−21 vs HEAD —
Checkpoint 3's changes are already in HEAD; this delta is exactly the
Checkpoint 4 fix set):

| Hunk | Content | Verdict |
| --- | --- | --- |
| 1 | `--model claude-sonnet-5` inserted into the real-model `terminal create` child argv (after `claude`, before `--print`, inside the post-`--` passthrough) | **accept** — the approved lane pin from the final review; position is correct (it is the child's own flag) and matches Checkpoint 4's recorded evidence |
| 2 | Test-body comment rewritten: the false "leaked live PTY session must be impossible" claim replaced with the accurate best-effort wording (guard reports proven/unverifiable, cannot assert) | **accept** — now consistent with the actual `Drop` behavior in hunk 4 |
| 3 | `SessionGuard` struct doc rewritten with the same honest close/drop split | **accept** — documentation-only, accurate |
| 4 | `Drop` rewrite: early-return when already closed; unwind-safe close via the file's existing `run_cli`; closure PROVEN only on CLI success + daemon-observed `exited`; otherwise a WARNING carrying cli-exit flag, observed verdict, stdout and stderr | **accept** — matches the review requirement (inspect, report, never claim), never panics during unwind (parse failures are `.ok()`-handled), reuses existing helpers, no new shared code |

`docs/migration/verticals/V1/dogfood-evidence.md` (1 hunk, +43):

| Hunk | Content | Verdict |
| --- | --- | --- |
| 5 | Checkpoint 4 appendix (per-fix verdicts, commands, gates, deferred paid pass) | **accept** — every recorded number was re-verified against this checkpoint's fresh runs (identical counts) and the spend disclosure is consistent with Checkpoint 3 |

### Fresh gate results (this checkpoint's own runs)

- `cargo test -p drogon-cli --test native_dogfood --locked`:
  **3 passed / 0 failed** (fixture leg, real-model leg skipped with note,
  negative gate test) — skip path, zero spend, 1.75s.
- `cargo test -p drogon-cli --locked`: all 9 targets green — lib 53, main 0,
  argument_parity 22, integration 49, native_dogfood 3, orchestration_auth
  6, orchestration_commands 52, parser 7, doc 0. **0 failed.**
- `cargo fmt --all -- --check`: **exit 0**.
- `cargo clippy -p drogon-cli --all-targets --locked -- -D warnings`:
  **exit 0**.

### Spend confirmation

`DROGON_DOGFOOD_REAL_MODEL` was NOT set at any point in this checkpoint;
the fresh runs exercised only the skip path and the fixture leg. Real-model
spend attributable to the dogfood work remains exactly Checkpoint 3's two
disclosed calls (second metered at $0.0203).

### Commit-readiness verdict for ROOT

Both held files are **commit-ready**: the delta vs HEAD is exactly the
reviewed Checkpoint 4 fix set, every hunk is accepted, every gate is green
on fresh runs, the evidence appendix is consistent with the recorded runs,
and nothing was changed by this closure review beyond this appendix. The
final paid-model pass under the pinned `claude-sonnet-5` lane remains
ROOT's own deferred step, as recorded in Checkpoint 4.

---

## Unwind note (task_22d0ad414c4e): ROOT 4837f84 review — Drop unwind-panic fix

Scope: `crates/drogon-cli/tests/native_dogfood.rs` only (+ this note).
No opted-in run; `DROGON_DOGFOOD_REAL_MODEL` never set.

**Finding (accepted):** the Checkpoint 4 `SessionGuard::Drop` delegated to
`common::run_cli`, whose spawn path is `command.output().expect("spawn
drogon-cli")` (`tests/common/mod.rs:217`) — a CLI spawn failure during
unwind would have panicked inside `Drop` and aborted the process, making
the "never panics" claim false.

**Fix shape:** `Drop` now calls a minimal OWNED local adapter,
`best_effort_close(cli, data_dir, session_id, incarnation)`, used ONLY by
the Drop path. It replicates `run_cli`'s spawn setup (the built binary +
`DROGON_DATA_DIR`) but is fallible end-to-end with no `expect`/`unwrap`
and no broad panic catching: spawn io::Error, non-zero CLI exit, unparsable
output, refused (`ok:false`) envelope, and missing verdict all map to
reported `Err` reasons; `Ok(verdict)` is returned only for a fully proven
observation, and `Drop` reports proven vs unverifiable/cleanup-failed
exactly as before. `tests/common` was deliberately NOT edited — that scope
belongs to another owner; the "never panics" claim is now literally true of
the code.

**Corrected claims:** Checkpoint 4's item 3 ("the unwind path uses the
file's existing `run_cli`/`stdout`/`stderr` helpers") described the
pre-fix state and is superseded by this note: the unwind path now uses the
owned fallible adapter precisely BECAUSE the shared helpers can panic on
spawn failure; `coordinator_call`/`assert_ok` remain on the happy path.

**Deterministic test:** `unwind_close_adapter_maps_spawn_failure_to_
unverifiable_without_panicking` passes a bogus argv0 (inside a nonexistent
directory) and asserts the adapter returns `Err` naming the spawn step —
no panic, uid-independent.

### Gates (targeted, per this checkpoint)

- `cargo test -p drogon-cli --test native_dogfood --locked`:
  **4 passed / 0 failed** (fixture leg; real-model leg skipped with note;
  negative gate test; new adapter regression test). Zero spend.
- `cargo fmt --all -- --check`: **exit 0**.
- `cargo clippy -p drogon-cli --test native_dogfood --locked -- -D
  warnings`: exit 0 (hygiene, beyond the required gate).

What remains: nothing for this checkpoint; the final paid-model pass under
the pinned `claude-sonnet-5` lane remains ROOT's own deferred step.
