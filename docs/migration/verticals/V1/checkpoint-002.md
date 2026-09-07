Vertical / scope / base SHA / head SHA / branch / worktree:
V1 runtime/CLI, second checkpoint: dogfood review corrections (ROOT's 4
findings, separate change) + historic-cancel/concurrent-rollback/reopen
behavioral tests (5/5 GREEN, no REDs). Base 596ddbd9e8b6fdc5d5fa26616
(plus checkpoint-001 at 0489018 and ROOT sha2 promotion cherry-picked as
1c46085). Branch codex/vertical-01-runtime-cli, same worktree. Child Run
run_797122265fda. Leaves: GLM (both tasks, transferred terminal), Sonnet
Windows work reported separately (not in this commit; rework active).

Capabilities and original contract/test IDs:
orchestration.native.v1; WP-ENG-RUNTIME, WP-ENG-CLI, WP-ENG-DAEMON.
ROOT review corrections on native_dogfood.rs; cancel/reopen per handoff
V1 item 1 (historic cancel, concurrent rollback, reopen).

Changed paths; shared-file patch requested:
Edited: crates/drogon-cli/tests/native_dogfood.rs (4 corrections),
docs/migration/verticals/V1/dogfood-evidence.md (Checkpoint 3 appendix).
New: crates/drogon-core/tests/native_attempt_cancel_reopen.rs,
docs/migration/verticals/V1/cancel-reopen-evidence.md,
docs/migration/verticals/V1/checkpoint-002.md (this file).
NOT in this commit (active WIP or ROOT-owned): endpoint.rs, launch.rs,
windows_transport.rs, windows-transport-evidence.md, Cargo.toml cherry-pick
(already committed as 1c46085). No shared files touched here.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Corrections: (1) opt-in requires exactly `=1`; negative test runs the real
binary as subprocesses for unset/0/empty/non-1, asserting exit 0 + skip
note + fast return, zero spend. (2) PTY bytes must parse as exactly one
claude envelope (only trailing whitespace + ESC[?25h tolerated):
is_error==false, result EXACTLY marker, daemon exitCode 0. (3)
SessionGuard tracks session/incarnation, explicit close observing verdict
exited BEFORE daemon shutdown, best-effort Drop guard. (4) build_drogond
drains cargo stdio via concurrent reader threads.
Cancel/reopen: settled-attempt cancel/abandon refused (attempt_settled,
byte-identical rows after); concurrent workerStop serializes, one winner +
idempotent loser; faulted replacement admission rolls back to exact
pre-retry row, task blocked, no spawn; reopen yields new dispatch id with
history preserved (two rows, retry_of link, state_json untouched).
Leader re-ran: `cargo test -p drogon-cli --test native_dogfood --locked`
exit 0, 3/3 in ~2s default (skip path, no spend); `cargo test -p
drogon-core --test native_attempt_cancel_reopen --locked` exit 0, 5/5;
`cargo test -p drogon-cli --locked` full green; fmt clean. (Clippy on
touched crates verified by leaves; leader re-verifies at next gate.)

Integrated/rendered/platform evidence; exact package identity if applicable:
Source-tree only, macOS arm64. Real-model evidence run (Checkpoint 3):
one opted-in call, envelope is_error:false, result exact marker,
cost ~$0.02, latency ~5.3s, session close-observed exited; one honest
deviation recorded (two invocations, first evidence truncated by leaf's own
tail capture, re-ran once with full capture rather than reporting
incomplete evidence).

Unverified, missing, source defects, deliberate approved deltas:
- Full autonomous workerStart-with-real-model-callback dogfood: still open.
- Windows work (endpoint.rs, launch.rs adapter, windows_transport.rs,
  windows-transport-evidence.md): rework leaf active, NOT in this commit.
  Slice-2 .cmd adapter verified GREEN; lib.rs wiring + windows-sys
  provisioning await ROOT.
- ask/reply/check, stop/abandon signal paths, reuse-session
  (unimplemented), extra harness ids: open.

Dependencies requested; next bounded checkpoint:
None blocking. Next: land Windows rework (verify + commit), then
remaining command/harness families. Needs ROOT: lib.rs Windows wiring
decision, windows-sys provisioning, PR #14 merge order, seam relay
confirmations.

Owned processes: session/incarnation/host, settlement/release receipts:
GLM corrections dispatch ctx_a9df1e911f36 completed; terminal
retained/external (no process action, idle at prompt, reusable). Dogfood
test sessions closed before daemon shutdown per correction (3); ephemeral
dirs removed. No surviving processes.

Rollback; data/credentials/privacy check:
No durable state outside the worktree; tempdirs removed. No credentials
written/provisioned (host Keychain reuse, one ~$0.02 evidence call).
Rollback: revert this commit (and 1c46085 independently if needed).

Ready for independent review: yes (not self-accepted).
