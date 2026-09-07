# Native coordination CLI implementation

Status: worker implementation of the 18 native orchestration verbs in
`drogon-cli`, on top of the accepted protocol wire contracts (`4971b1a`) and
the dispatch-credential isolation fix (`01565b9`), both merged into this
checkout at `32e61b9`. Schema is the root-corrected wire freeze proposal
(`docs/migration/native-coordination-wire-freeze-proposal.md`); the protocol
crate and the source baselines were **not** touched.

## Behavioral RED recorded before implementation

`.preflight/native-cli-implementation/red-behavioral-summary.txt` (and
`red-detail.txt`) record the desired-invocation subprocess suite run against
the **unmodified compiled binary**: 18 of 22 desired invocations failed with
`error: unrecognized subcommand 'orchestration'` (clap usage error, exit 2,
stdout empty) — a real binary behavior gap, not a compile-binding failure.
The four coincidental passes were usage-error-only tests whose exit-2
expectations matched the missing-command state too; their positive
counterparts (mock capture assertions) were among the failures. The temporary
RED probe was then replaced by the working suite.

## Files (exact task ownership)

- `crates/drogon-cli/src/orchestration_cli.rs` — clap grammar for all 18
  verbs, split out of `cli.rs`; common flag groups: `HostOpt`,
  `CoordinatorScopeArgs`, and one flat `ActorScopeArgs` for dual-actor verbs
  (clap forbids two flattened groups reusing `--run`).
- `crates/drogon-cli/src/orchestration_commands.rs` — execution: preflight,
  host resolution, typed param construction, protocol shape validation,
  result decoding plus invariant checks, bounded text summaries, exit codes.
- `crates/drogon-cli/src/cli.rs` — `Command::Orchestration` variant, global
  `--retry-request` alias with contradiction refusal.
- `crates/drogon-cli/src/commands.rs` — one dispatch branch; request-id
  minting now honors `--retry-request` when `--request-id` is absent.
- `crates/drogon-cli/src/credential.rs` — `dispatch_credential_present()`
  (presence decides the actor kind; validity still fails closed in
  `resolve`, unchanged).
- `crates/drogon-cli/src/lib.rs` — two module lines.
- `crates/drogon-cli/tests/orchestration_commands.rs` — 22 subprocess tests.

## Semantics implemented (per root direction)

- **Exact 18 methods**: run create/list/show/use, task create/list/show,
  worker start/show/read/stop/abandon/release, send, check/reply/ask,
  request-show — each maps to its `orchestration.<method>` RPC with params
  built from the typed protocol structs, `validate_shape(host)`-checked
  before the request, so flat/nested wire keys (`spec.dependsOn`,
  `launch.permissionMode`, `mode`/`acknowledge`, `intent`/`questionMessageId`,
  `scope.actorKind`) are contract-exact by construction.
- **Preflight**: every call runs the read-only `status` negotiation first
  (distinct preflight request id; all failures re-keyed onto the operation
  id). Missing `orchestration.native.v1` → `method_not_found`-shaped failure,
  exit 1, zero method effect (test: only `status` captured).
- **Host**: explicit `--host` > scoped `DROGON_HOST_ID` hint > the
  preflight's host identity; disagreement with the runtime is
  `unsupported_host` before any method request; explicit-vs-hint mismatch is
  a usage error (exit 2).
- **Actor kind**: `DROGON_DISPATCH_CAPABILITY` presence selects the dispatch
  scope (hints `DROGON_RUN_ID/TASK_ID/DISPATCH_ID` fill gaps; mismatch with
  explicit flags refused; hints never grant authority). Absence selects the
  coordinator scope, which requires the explicit `--run/--coordinator-id/
  --consumer-generation` triple — no default-to-latest, no binding store
  (the durable friendly run-use binding stays recorded as pending UX parity
  in this document). Present-but-empty/invalid credentials fail closed via
  the existing resolver before any connection (test: mock captures nothing).
- **Check**: `--peek`/`--all`/`--ack` mutual exclusivity; `--ack` models
  unread-with-acknowledge (ACK then consume/wait in one call); `--wait`
  unread-only with required positive `--timeout-ms` ≤ 900000; `--kinds`
  travel as wake filters while the consuming output keeps the whole FIFO;
  the transport timeout is wait + 5s bounded margin (test: server answers
  after 3.5s against a 1s budget and the CLI still parses the pending
  result, then exits 1 for the unanswered ask).
- **Ask**: `--question`/`--resume` exclusive; resume refuses
  `--option`/`--to`; a pending/cancelled ask exits 1 with the durable
  question id printed for `--resume` recovery (source-parity exit
  semantics).
- **Send**: `final-report` requires `--outcome`; `--result` metadata JSON is
  final-report-only; heartbeat/final-report target only run-home (usage
  refusal client-side); a negative lifecycle verdict (`rejected`/`failed`)
  keeps the envelope on stdout but exits 1.
- **Worker**: start requires a registered `--workspace` id plus exactly one
  execution mode (`--harness[+model/provider/permission-mode]` fresh, or
  `--reuse-session/--reuse-incarnation` explicit reuse — no arbitrary
  command, and the capability value never appears in params); stop/release
  render `processAction`/`processVerdict`/dispositions verbatim
  (`unverifiable` stays `unverifiable`, no invented exits); abandon claims
  no process action. `--retry-of` names the explicitly replaced attempt.
- **request-show**: `--request` is the target receipt id, separate from the
  `--request-id` envelope id; `--scope bootstrap|coordinator|dispatch` is
  explicit; no internal ledger keys or raw tokens are ever displayed.
- **Retired aliases**: no `reset`/scheduler subcommands exist; unknown
  subcommands fail with clap usage errors (exit 2) — explicitly not success.
- **Output**: JSON mode prints exactly one validated envelope (additive
  fields survive verbatim); text mode prints a bounded summary; usage/parse
  errors exit 2 with stdout empty; operation failures exit 1.

## Second-pass corrections (root review, 2026-09-07)

Root independently reproduced six compiled-subprocess RED failures and applied
preliminary fixes in these files (stable SHA256 public run-create actor,
abandon `--reason` forwarding, worker-read content printing, retained-release
wording, failed worker-start exit 1 with start-scope checking, and
release-dispatch matching). All six `review_*` tests and root's edits are
preserved verbatim. The following remaining corrections were then applied,
each recorded as a real compiled-subprocess RED first (17 `red_*` tests, all
failing before the fixes; evidence in
`.preflight/native-cli-implementation/red-corrections.txt`):

1. **Actor flags fail closed.** A worker credential plus
   `--coordinator-id/--consumer-generation` is refused (usage, exit 2, no
   wire effect); the coordinator actor refuses `--task/--dispatch`;
   coordinator-only run/task/worker verbs refuse any worker credential with
   no administrator fallback; worker `request-show` accepts only
   `--scope dispatch`; present-but-empty or non-UTF-8 scoped hints
   (`DROGON_RUN_ID/TASK_ID/DISPATCH_ID/HOST_ID`) fail closed instead of
   silently disappearing. Reuse execution rejects every fresh launch
   preference (`--harness/--model/--effort/--provider/--permission-mode`);
   `--effort` was added to the grammar, maps to
   `LaunchPreferences.effort`, is fresh-only and requires `--model`.
   All purely local contradictions are validated in `Cli::validate` before
   any connection. Param-shape violations are now usage errors (exit 2),
   not operation failures.
2. **Response identity validation.** Every typed result must echo the
   request: run show/use the requested run; run-create the coordinator,
   objective and generation 1; task-create the run; task-show the run and
   task; worker-start the exact run/task/generation/workspace and the
   reused session identity when requested; worker show/read/stop/abandon/
   release the exact dispatch; reply the question; ask-resume the resumed
   question id; request-show the requested receipt. Returned cursors are
   validated through `OpaqueCursor::validate` and generations through the
   protocol's `validate_consumer_generation` — no duplicated protocol
   logic. Identity violations are protocol failures (exit 1).
3. **Honest human output and exits.** task-show prints the actual full
   spec; worker-read prints returned entry content (string or object);
   stop states assignment state + process action + verdict without
   claiming "stopped" from an unverified action; warnings and residual
   resource identities (kind/id/action/disposition) are surfaced on
   start/show/stop/abandon/release; worker-start non-ready outcomes exit 1
   (root's fix, kept) with the failure code/stage/message printed;
   worker-stop with `processAction: unverifiable` exits 1, and
   worker-release with `disposition: unverifiable` exits 1 while
   intentional retained/no-owned-resource releases succeed. The positive
   worker-start fixture now models a genuinely ready/live attempt with the
   failed and unverifiable cases as separate negatives; the old
   `worker_stop_displays_unverifiable` expectation of exit 0 was corrected
   to exit 1 for exactly that reason.
4. **Check ACK ownership and inspections.** A consuming check must echo an
   `acknowledged` receipt naming exactly the requested `--ack` delivery
   (mismatch → exit 1); `--peek`/`--all` results carrying delivery or
   acknowledgment ownership are refused — inspection never claims
   consumption. The ACK test fixture now acknowledges the requested
   delivery (assertion not weakened). Human check output reports
   `nextCursor` and interrupted/cancelled waits (exit 1 with a text-mode
   stderr note; JSON mode conveys `cancelled`/`timedOut` envelope fields).
   Root protocol `95f89ea` adds `CheckParams` cursor/limit fields; this
   checkout does not carry that protocol change, the CLI sends neither
   field today, and nothing was cherry-picked — reconciliation stays with
   root.
5. **Original suite fixtures** were updated only where the contracts above
   require (worker-start positive fixture, check ACK fixture, coordinator-
   verb credential refusal, unverifiable stop exit); no assertion was
   weakened to hide a defect, and additive unknown response fields continue
   to pass through to the raw JSON stdout.

## Third-pass follow-up (root cherry-pick `f08c801`, 2026-09-07)

Two remaining gaps closed, each with a real compiled-subprocess RED first
(`red_check_cursor_limit_rejected_on_consuming_reads`,
`red_check_cursor_limit_map_for_inspection_only`,
`red_explicit_inherit_permission_mode_is_rejected_on_reuse`; evidence in
`.preflight/native-cli-implementation/red-batch2.txt`):

1. **Inspection pagination.** `check --cursor/--limit` map into the typed
   `CheckParams` cursor/limit fields (protocol `f08c801`) and are accepted
   only for `--peek`/`--all`. Any combination with a consuming read
   (default unread or `--ack`) or `--wait` is refused as a usage error
   before any connection, because a consuming check returns the whole
   unsplittable FIFO batch. Local bounds use the protocol routines
   (`OpaqueCursor::validate` for the request cursor, page-limit bounds) and
   the response continuation cursor is validated with the same routine
   (invalid continuation → protocol failure, exit 1).
2. **Explicit inherit on reuse.** `worker-start --permission-mode` is now an
   `Option` with no clap default, so an explicitly supplied `inherit` is
   distinguishable from absence; reuse rejects every explicitly supplied
   fresh-only preference including `inherit`, while fresh launches still
   default to inherit. `validate_actor_flags` and the execution arm both
   enforce it (the arm check is defense in depth behind the pre-connection
   refusal).

## Fourth-pass integration correction (2026-09-07)

`worker-start` no longer treats every non-`Ready` assignment state as
failure: a fast authenticated successful final report can settle the attempt
before launch finalization, so production may legitimately return
`assignmentState: completed` with `readiness: workerObserved` and an
independent process verdict (live/unverifiable/exited). The CLI now exits 0
for exactly `Ready` or `Completed`; `Failed`/`Stopped`/`Abandoned`/
`Admitting` remain non-success, and outcome/readiness are never inferred
from the process verdict. The earlier response-identity validation
(run/task/generation/workspace/reused-session) does not examine the
assignment state, so a coherent completed result passes it untouched —
proven end-to-end by the new subprocess regression (coherent completed
results with live and unverifiable verdicts both exit 0 and render the
server's own state), recorded as a real RED first in
`.preflight/native-cli-implementation/red-batch3-completed.txt`
(exit 1 before the fix).

## Independent integration review (2026-09-07)

Root reproduced two additional failures with the compiled subprocess suite:
`run-use` accepted a different coordinator or incorrect generation, and
`task-list` accepted malformed continuation cursors. Both now fail with exit 1.
The binding check requires the requested coordinator and the same generation,
or exactly the next generation for explicit takeover. Cursor checking reuses
the protocol validator. These two `root_review_*` regressions passed after
the production fixes; the initial run failed both without compile errors.

## Verification

- Behavioral RED captured pre-implementation (see above).
- Root independently ran `cargo test -p drogon-cli`: **166 passed, 0 failed**
  (53 lib unit, 49 integration, 6 pre-existing `orchestration_auth`
  preserved, 51 orchestration subprocess tests, and 7 parser).
- `cargo clippy --locked --offline -p drogon-cli --all-targets -- -D warnings`:
  clean. `cargo fmt -p drogon-cli` applied.
- Tests spawn the real compiled binary against an isolated mock transport
  (protocol peer only — this proves CLI behavior, not native engine parity);
  children run with cleared environments, bounded pipe draining, deadline
  kill, and exact owned cleanup. Engine integration remains root's step.

## Pending UX parity (recorded, not invented)

- Durable friendly run-use binding on the client (the source CLI remembers
  the active run). Intentionally not implemented: no silent latest-run
  selection, no invented binding files. Follow-up verbs take explicit
  bindings today.
- Worktree/repo placement composition (source `--worktree/--repo/
  --base-branch/--setup`) awaits the workspace APIs before native start, per
  the wire proposal's deferred parity obligation.
