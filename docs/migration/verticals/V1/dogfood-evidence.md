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

---

## Checkpoint 6 (task_2d8438b86712): coordinated-journey opt-in leg — code delivered, NOT run

Scope: `crates/drogon-cli/tests/native_dogfood.rs` only (+ this section), per
ROOT seq 3282's follow-up assignment to the GREEN fixture dogfood. **No
opted-in run was performed. `DROGON_DOGFOOD_REAL_MODEL` was never set by this
task. Real-model spend attributable to this checkpoint is exactly zero** —
per the assignment's explicit "you must not invoke any model yourself"
instruction, this delivers reviewed code plus a bounded invocation proposal
for ROOT to run once, not a self-executed paid pass.

### What this closes

This is the follow-up Checkpoint 2 explicitly deferred: *"a real model
autonomously completing an `orchestration.workerStart` fresh launch end to
end including its own final-report... should be its own explicitly scoped,
explicitly costed checkpoint."* That checkpoint is this one.

### Design summary

New third test, `real_model_coordinated_journey_creates_and_reports_an_owned_artifact`,
behind the exact same `DROGON_DOGFOOD_REAL_MODEL=1` opt-in gate as the
existing `real_model_probe_reaches_a_daemon_spawned_session`. Unlike that
probe (a single non-agentic `claude --print` completion via plain `terminal
create`), this drives the **exact same native path the fixture leg
exercises**: `orchestration task-create` -> `orchestration worker-start`,
with a genuinely installed `claude` harness (pinned `--model
claude-sonnet-5`, same approved lane as the probe leg) in `--permission-mode
unattended` (`--dangerously-skip-permissions`) instead of the fixture's
static stand-in script.

1. **Task instructions as the model's real prompt.** Reading
   `coordination_launch.rs::plan_coordination_launch` confirmed the daemon
   wraps `task-create --instructions` text into the actual harness prompt
   (fixed preamble + non-secret context + `TASK INSTRUCTIONS:\n{instructions}`),
   and that fixed preamble already says "send exactly one orchestration send
   --kind final-report." The new test's instructions text
   (`real_model_journey_instructions`) explicitly overrides that default for
   this one verification task, since proving late-report refusal requires a
   second, deliberately conflicting report.
2. **One fully specified script, one tool call.** The instructions hand the
   model a literal, copy-paste shell script (`REAL_MODEL_JOURNEY_SCRIPT`) and
   ask for exactly one bash tool call to run it verbatim — real tool-using
   model autonomy, but scripted execution, not open-ended task
   interpretation. The script:
   - writes `artifact.txt` with `DROGON-REAL-ARTIFACT dispatch=<dispatch>
     task=<task>\n`, substituting the worker's own env vars
     (`DROGON_DISPATCH_ID`/`DROGON_TASK_ID`, injected by
     `session_admission::WorkerEnvironment::apply_to_command` — the same
     mechanism the fixture harness script already exercises for real);
   - sends a real `orchestration send --kind final-report --outcome
     succeeded` via `$DROGON_CLI_COMMAND` (auto-authenticated through
     `DROGON_DISPATCH_CAPABILITY`, never handled explicitly by the
     model/script);
   - immediately sends a second, deliberately conflicting `--outcome failed`
     final report from the same now-settled credential (captured to
     `late-report.json`/`late-report.exit`) — this is the late-report-refusal
     proof, exercised for real by the worker itself, exactly mirroring how
     the fixture leg already proves it;
   - `touch done` as the last, strictly-sequential action (same
     done-marker-polling fix Checkpoint 1 already established, reused as-is).
3. **Exact artifact bytes/provenance.** The test reads `artifact.txt` and
   asserts **exact string equality** (not `contains`) against
   `DROGON-REAL-ARTIFACT dispatch={dispatch_id} task={task_id}\n`, using the
   dispatch/task ids the test itself obtained from `worker-start`/`task-create`
   responses.
4. **Late-report refusal validated for real**, identically to the fixture
   leg: `late-report.exit` trimmed `== "1"`, `late-report.json` parses to
   `ok:false`, `error.code == "report_conflict"`.
5. **Bounded caps, explicit in code:**
   - `REAL_MODEL_JOURNEY_TIMEOUT` = 180s wall-clock cap on the test's own
     `done`-marker poll loop (the daemon's `worker-start --timeout-ms` is
     passed too, but is documented in the protocol itself as "a budget hint,
     not a kill deadline," so the poll loop is the real enforcement);
   - turn budget is capped in the **prompt**, not a CLI flag — the harness
     launch-plan builder (`drogon-harness/src/launch.rs::plan_launch`, read,
     not edited) has no `--max-turns`-shaped passthrough for any harness, so
     "exactly ONE tool call" is stated explicitly in the instructions text,
     the only lever available through this native path;
   - `REAL_MODEL_JOURNEY_READ_LIMIT` = 200 entries caps the one diagnostic
     `worker-read` this leg performs (evidence/panic-context only, never a
     pass/fail assertion — mirrors the probe leg's `--limit-bytes 65536` cap
     on `terminal read`).
6. **Exact release, no leaked process/handle.** The real `claude` process,
   once launched without `--print`, is a **persistent interactive session
   with no natural exit** once it finishes responding — confirmed by reading
   `drogon-harness/src/launch.rs` (the `--` positional prompt path, not
   `--print`) and consistent with Checkpoint 2's own recorded rationale for
   why it avoided this exact mode originally. So this leg never relies on
   natural exit: a new `DispatchGuard` (mirroring `SessionGuard` exactly,
   not touching it) always calls `orchestration worker-stop` (fence +
   force-signal; safe/idempotent even if the process already exited) before
   `orchestration worker-release`, polling `worker-show` for
   `processVerdict != live` (bounded `STOP_OBSERVATION_TIMEOUT` = 15s) before
   releasing, and asserts `disposition == released` with a non-`live`
   `processVerdict`. `SessionGuard` itself is untouched — this task's
   "retain the exact SessionGuard cleanup" requirement is satisfied by
   leaving it byte-for-byte as Checkpoint 4/the unwind note left it, and by
   mirroring its exact non-panicking-Drop idiom for this new resource type.
   `DispatchGuard::drop` uses a new owned fallible adapter,
   `best_effort_stop_and_release` (modeled 1:1 on `best_effort_close`: no
   `.expect`/`.unwrap`, every failure mapped to a reported `Err`, `Ok` only
   for a fully proven `released` outcome), with its own regression test
   `unwind_stop_release_adapter_maps_spawn_failure_to_unverifiable_without_panicking`,
   mirroring `unwind_close_adapter_...` exactly.
7. **Negative gate extended, not duplicated.** The existing skip-path test
   was renamed `real_model_legs_skip_without_spending_unless_opt_in_is_exactly_one`
   and now loops over **both** real-model test names x all 4 opt-out values
   (unset/`0`/empty/`yes`) = 8 subprocess runs, each asserting exit 0, the
   printed skip note, and a <30s fast return (no build/daemon/session/spend).
8. **Labeling discipline.** Both the module doc comment and the new test's
   own doc comment are explicit that this leg exercises **genuine model
   tool-use autonomy** (bounded/scripted, not open-ended interpretation) —
   distinct from the fixture leg's static shim and from the probe leg's
   single non-agentic completion. No claim of model autonomy is implied by
   the fixture leg anywhere in this file.

### Why NOT run by this task

The assignment is explicit: "YOU MUST NOT INVOKE ANY MODEL YOURSELF... the
real-model test must skip by default... and you must NOT run the opted-in
leg." `DROGON_DOGFOOD_REAL_MODEL` was never set during this checkpoint's
work; every command below was run without it. **Spend incurred by this
checkpoint: $0.00.**

### Exact bounded invocation proposal for ROOT to run once

```
DROGON_DOGFOOD_REAL_MODEL=1 cargo test -p drogon-cli --test native_dogfood \
  --locked real_model_coordinated_journey_creates_and_reports_an_owned_artifact \
  -- --exact --nocapture
```

- **Model id:** `claude-sonnet-5` (the same approved lane Checkpoint 4 pinned
  for the `--print` probe leg; hardcoded in the test as
  `REAL_MODEL_JOURNEY_MODEL_ID`, not overridable without editing the test).
- **Harness/mode:** native `claude` CLI discovered on `PATH`, launched via
  `orchestration worker-start --harness claude --permission-mode unattended`
  (`--dangerously-skip-permissions`) — a real, unattended, tool-using agent
  session, not a one-shot `--print` completion.
- **Turn cap:** exactly 1 tool call, enforced only by explicit prompt
  instruction (no CLI-level max-turns lever exists on this native path today
  — see design note 5 above); a model that ignores this instruction is a
  real, disclosed risk of this leg, bounded only by the wall-clock cap below
  and the explicit force-stop in `DispatchGuard`.
- **Wall-time cap:** 180s poll loop (`REAL_MODEL_JOURNEY_TIMEOUT`) for the
  `done` marker, plus a 15s bounded stop-observation window before release;
  the whole test process itself has no additional externally-imposed
  timeout, so a wedged real agent would make the test run up to roughly
  180s + 15s + teardown before failing loudly (never hang silently, never
  leak the process — `DispatchGuard` force-stops regardless of pass/fail).
- **Output cap:** one diagnostic `worker-read --limit 200` (entries, not
  bytes) — evidence only.
- **Network/credentials:** uses this host's own already-provisioned Anthropic
  credentials (macOS Keychain `Claude Code-credentials`), read only by the
  real `claude` binary itself, exactly as the existing probe leg already
  does; nothing is provisioned, copied, or persisted by the test.
- **Expected spend ceiling:** one bounded agentic turn (read instructions,
  issue one bash tool call, receive its result, stop) is comparable in scope
  to the probe leg's single `--print` completion but with tool-use overhead;
  expect low tens-of-cents at most (the probe leg's single completions
  metered $0.02-0.03 each per Checkpoint 2/3's disclosed figures) — ROOT
  should treat any run costing meaningfully more, or requiring more than a
  couple of the retries, as a signal the prompt needs tightening rather than
  a routine result.
- **Non-determinism disclosure:** unlike the fixture leg (deterministic
  shell script) and the probe leg (single completion, no tool use), this
  leg's pass/fail genuinely depends on the real model correctly following
  the "exactly one tool call, run this exact script, then a required second
  conflicting report" instructions. A first run failing due to the model
  deviating from the literal script (not a code defect) is a plausible,
  disclosed outcome — ROOT should inspect the diagnostic `worker-read`
  output included in any failure's panic message before assuming a bug in
  this test.

### Commands run (all default/skip-path, zero spend)

- `cargo test -p drogon-cli --test native_dogfood --locked`: **6 passed / 0
  failed** (fixture leg; probe leg skipped with note; coordinated-journey leg
  skipped with note; negative gate test covering both legs x4 variants = 8
  subprocess checks; both unwind-adapter regression tests). Re-ran after the
  fmt/clippy fixes below with no failures, ~1.2-1.9s wall.
- `cargo fmt -p drogon-cli` then `cargo fmt --all -- --check`: one diff
  applied (import/line-wrap reflow from the new code), then clean.
- `cargo clippy -p drogon-cli --test native_dogfood --locked -- -D
  warnings`: one `clippy::cmp_owned` finding
  (`show["result"]["processVerdict"] == Value::from("live")` where a bare
  `"live"` comparison suffices, same class of finding Checkpoint 2 already
  fixed once), corrected; then clean, 0 warnings. Also fixed one
  `unused_assignments` compiler warning (an initial `last_show` value that
  was always overwritten before being read) by restructuring the poll loop
  to `break` its result directly instead of pre-seeding a variable.
- `cargo test -p drogon-cli --locked`: all 9 targets green — lib 53, main 0,
  argument_parity 22, integration 49, native_dogfood **6**, orchestration_auth
  6, orchestration_commands 52, parser 7, doc 0. **0 failed.**
- `cargo clippy -p drogon-cli --all-targets --locked -- -D warnings`: clean.
- `git status --short` before and after: only
  `crates/drogon-cli/tests/native_dogfood.rs` (this task's file) touched by
  this task; `crates/drogond/src/endpoint.rs` and
  `docs/migration/verticals/V1/windows-transport-evidence.md` are the
  concurrent sibling leaf's disjoint files, confirmed untouched by this
  checkpoint's edits.

### Owned processes: session/incarnation/host, settlement/release receipts

No process, session, or dispatch was created by this checkpoint's own work
(the opted-in leg was never run). The default/skip-path runs above spawn only
the real `drogond` daemon for the fixture leg and the negative-gate
subprocesses, all of which are reaped by the existing, unmodified
`Daemon::drop`/subprocess-`.output()` mechanics already covered in prior
checkpoints.

### Rollback; data/credentials/privacy check

Nothing durable was created; no credentials were touched, provisioned, or
read (the skip path returns before any daemon, session, or credential lookup
happens). No commit, push, or install was made. Real-model spend
attributable to this checkpoint: **$0.00** — the two prior real completions
disclosed in Checkpoints 2/3 remain the only real spend this dogfood family
has incurred to date.

### What remains

The exact bounded invocation above, run once by ROOT, is the only remaining
step to close this checkpoint's real-model verification. If that run
surfaces a prompt-following gap (the model not executing the literal script
verbatim), the fix is a prompt/instructions adjustment to this same test
file, not a new design.

---

## Checkpoint 7 (task_d3cc61d647b6): ROOT review of Checkpoint 6 — HOLD corrections

Scope: `crates/drogon-cli/tests/native_dogfood.rs` only (+ this appendix). No
opted-in run was performed (`DROGON_DOGFOOD_REAL_MODEL` never set, confirmed
absent from this shell's environment before and after); ROOT's real
invocation of `real_model_coordinated_journey_creates_and_reports_an_owned_artifact`
remains explicitly ON HOLD. **Spend incurred by this checkpoint: $0.00.**

### Correction verdicts

1. **`stop_and_release` accepted any non-`live` verdict as cleanup proof —
   FIXED.** The happy-path guard's bounded observation loop and both of its
   post-loop assertions previously used `processVerdict != "live"`, so
   `unverifiable`, a missing field, or any unrecognized string all passed as
   if they proved the process exited. Both the loop's break condition and
   the two `assert!`s (before release, and on the release response itself)
   now require the new `is_proven_exited(verdict)` helper — an exact
   `verdict.as_str() == Some("exited")` check, mirroring `SessionGuard`'s
   own idiom rather than inventing a new rule. A verdict that never becomes
   `exited` within `STOP_OBSERVATION_TIMEOUT` now fails the test loudly
   (`assert!` panic) instead of silently proceeding to claim the guard
   settled — this is the fail-closed behavior the correction asked for; a
   held/unproven state is retained as a loud test failure, never quietly
   accepted.
2. **`best_effort_stop_and_release` checked only `disposition`, no verdict
   at all — FIXED.** The Drop-path adapter previously called `worker-stop`
   then `worker-release` back to back and returned `Ok(disposition)` purely
   from the release response's `disposition` string, never inspecting
   `processVerdict`. It's renamed to a parameterized
   `best_effort_stop_and_release_bounded` (the public
   `best_effort_stop_and_release` now delegates to it, fixed to the real
   `STOP_OBSERVATION_TIMEOUT`) and now: (a) polls `worker-show` in a bounded
   loop between stop and release, exactly mirroring `stop_and_release`'s own
   poll; (b) returns `Err` (evidence retained in the message, surfaced by
   `DispatchGuard::drop`'s existing `WARNING` print) if the observed verdict
   never becomes `exited` within the bound; (c) additionally requires the
   release response's own `processVerdict` to be `exited` before returning
   `Ok(disposition)`. `disposition == "released"` is necessary but no longer
   sufficient on its own.
3. **Docs overstated a force-signal-alone never-leak guarantee — FIXED.**
   The module doc comment for
   `real_model_coordinated_journey_creates_and_reports_an_owned_artifact`
   previously ended with "so no live process/handle can survive the test on
   any path," implying the `worker-stop` force-signal itself was sufficient
   proof. It now states the honest bound: cleanup is asserted only after an
   explicit `exited` verdict is observed within
   `STOP_OBSERVATION_TIMEOUT`; `unverifiable` (lost contact) never counts as
   proof of exit; and if the verdict never resolves, this leg fails closed
   (the happy path fails the test loudly, the unwind path reports
   unverifiable/cleanup-failed) rather than claiming success. An orphaned
   process is now an explicit, disclosed possible outcome when the verdict
   never resolves to `exited` — not implied away. (Checkpoint 6 §6's header
   "Exact release, no leaked process/handle" and its "never leak the
   process" phrasing in the bounded-invocation proposal section are this
   same overstatement, now corrected by this appendix rather than by editing
   that frozen section; both should be read alongside this correction.)
4. **Spend estimate and turn cap were not disclosed as non-enforced in code
   — CLARIFIED.** A new comment block above the (unedited)
   `real_model_journey_instructions` function states explicitly: nothing in
   this file enforces a turn cap or a spend ceiling; "exactly ONE tool call"
   is a prompt instruction only (no `--max-turns`-equivalent CLI lever
   exists on this native path, confirmed by the unedited
   `drogon-harness/src/launch.rs::plan_launch` read in Checkpoint 6); the
   "low tens-of-cents at most" figure quoted in this doc's Checkpoint 6 §
   "Exact bounded invocation proposal" is an ESTIMATE extrapolated from the
   probe leg's completions, not a value asserted, measured, or capped
   anywhere in the test. A model that ignores the one-tool-call instruction
   is bounded only by `REAL_MODEL_JOURNEY_TIMEOUT` (wall-clock), never by
   turn count or cost — this was already true of the code before this
   checkpoint; only the explicit disclosure is new.

### New/changed test coverage

- `is_proven_exited(verdict: &Value) -> bool`: new shared helper, used by
  both `stop_and_release` and `best_effort_stop_and_release_bounded`.
- `only_explicit_exited_verdict_proves_cleanup_all_others_fail_closed`
  (new, no subprocess): exhaustively covers all five required cases —
  `live`, `unverifiable`, missing (`Value::Null`), unknown
  (`"some-unrecognized-value"`), `exited` — asserting `is_proven_exited`
  returns `false` for the first four and `true` only for `exited`.
- `best_effort_stop_and_release_fails_closed_for_every_non_exited_verdict`
  (new): spawns a real subprocess fixture stub
  (`STUB_STOP_RELEASE_CLI_SCRIPT`) standing in for `drogon-cli` itself, so
  the actual spawn/parse/bounded-observation plumbing in
  `best_effort_stop_and_release_bounded` runs for real (not a mocked-out
  closure). The stub reports a fully controlled `processVerdict` for
  `worker-show`/`worker-release` while always reporting
  `disposition: "released"`, isolating the verdict as the only varying
  factor. Covers `live`/`unverifiable`/missing/unknown as `Err` (fail
  closed) and `exited` as the sole `Ok("released")` case. A short
  `observation_timeout` (200ms, not the real 15s `STOP_OBSERVATION_TIMEOUT`)
  is passed via the new parameterized function so the four non-exited cases
  don't each wait out the full real-world bound in the default test run;
  the rule exercised is identical to the 15s-bounded production path.
- `stop_and_release` itself (the live-daemon happy path) is not
  independently re-tested with fake verdicts here — it shares the exact
  same `is_proven_exited` helper covered exhaustively above, and its own
  live-daemon behavior remains exercised end-to-end by the real-model leg
  itself (skipped by default; proven only when ROOT runs the still-HELD
  opted-in invocation).
- Fixed one new `unused_assignments` compiler warning introduced by an
  earlier draft of the `best_effort_stop_and_release_bounded` loop (an
  initial `last_verdict` binding always overwritten before being read) by
  restructuring the loop to `break` its result directly, matching the
  existing `last_show` pattern already used by `stop_and_release`.

### Commands run (all default/skip-path, zero spend)

- `cargo test -p drogon-cli --test native_dogfood --locked`: **8 passed / 0
  failed** (fixture leg; probe leg skipped with note; coordinated-journey
  leg skipped with note; negative gate test covering both legs x4 variants;
  both unwind-adapter regression tests; the two new fail-closed tests
  above), 1.16-2.02s wall across repeated runs. `DROGON_DOGFOOD_REAL_MODEL`
  confirmed absent from the environment before running.
- `cargo fmt -p drogon-cli -- --check`: clean, both before and after edits
  (no reflow needed).
- `cargo clippy -p drogon-cli --all-targets --locked -- -D warnings`: clean.
- `cargo test -p drogon-cli --locked`: all 9 targets green — lib 53, main 0,
  argument_parity 22, integration 49, native_dogfood **8** (was 6), doc 0,
  orchestration_auth 6, orchestration_commands 52, parser 7. **0 failed.**
- `git status --short`: only `crates/drogon-cli/tests/native_dogfood.rs` and
  this doc were written by this checkpoint. `crates/drogond/src/endpoint.rs`
  and `docs/migration/verticals/V1/windows-transport-evidence.md` are the
  concurrent sibling leaf's disjoint files, confirmed untouched by this
  checkpoint.

### Rollback; data/credentials/privacy check

Nothing durable was created; no credentials were touched, provisioned, or
read. No commit, push, or install was made. Real-model spend attributable
to this checkpoint: **$0.00** — the two prior real completions disclosed in
Checkpoints 2/3 remain the only real spend this dogfood family has incurred
to date.

### What remains

ROOT's real invocation of
`real_model_coordinated_journey_creates_and_reports_an_owned_artifact`
(the exact bounded command in Checkpoint 6's "Exact bounded invocation
proposal" section) remains explicitly ON HOLD and was not run by this
checkpoint. All four requested corrections are otherwise closed: the
fail-closed exact-`exited` rule now applies to both the live-daemon guard
and its Drop-path adapter, is unit-tested for all five required verdict
cases, and the docs/code comments no longer promise an unconditional
never-leak guarantee based on the force-signal alone.

Ready for independent review: yes.

Ready for independent review: yes.
