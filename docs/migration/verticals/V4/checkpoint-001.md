# V4 checkpoint-001: execution evaluation + contracts/panel foundation

Vertical / scope / base SHA / head SHA / branch / worktree:
V4 Capabilities. Scope: (A) automation schedule/trigger-dispatch evaluation
(domain logic, host fencing, failure/reload); (B) Mentu/Meetings/provider
source-baseline contract ports + exported-but-unmounted BotsPanel for V2.
Base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604, branch
codex/vertical-04-capabilities, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-04-capabilities.
Head SHA recorded at commit time below (uncommitted at doc writing).

Capabilities and original contract/test IDs:
WP-CAP-BOTS (native-state, bots-page, reactive-dispatch, responsibility-owner
follow-ups), WP-CAP-AUTO (schedule/trigger dispatch), WP-CAP-MENTU,
WP-CAP-MEET, WP-CAP-INT/WP-ENG-PLUGINS (provider/account/skills catalogs),
WP-UI-AUX/WP-UI-AUTO (BotsPanel export). Source pin
c97906287bb7a390b25e2025b600d9fb3c25d9c3 (read-only reference, git-show
reads only, never as cwd). Distinguishes source-existing behavior from
historically-pending gaps (reactive/proactive, recipe-81/90, shared-spaces,
recording buttons, Commitment-Protocol overreach, speech-exit).

Changed paths; shared-file patch requested:
Leaf A (task_94d3b0c91852, claude-sonnet-5 high, ACCEPTED+released):
- crates/drogon-core/src/automations/execution.rs (new)
- crates/drogon-core/src/automations/mod.rs (one-line module registration)
- crates/drogon-core/tests/automation_execution.rs (new, 17 tests)
Leaf B (task_de6680399532, opencode zai-coding-plan/glm-5.3-flash, ACCEPTED):
- apps/desktop/src/renderer/src/features/bots/** (6 files: panel, contracts,
  projection, contract test, index export, EVIDENCE.md)
- tests/parity/ports/WP-CAP-MENTU/** (manifest + 4 frozen suites + STATUS +
  pending-register) and tests/parity/ports/WP-CAP-MEET/** (same shape)
- This checkpoint doc (leader).
No shared files touched (no lib.rs/db.rs/Cargo/RPC/preload/App-mount edits).
Shared patch REQUESTED from ROOT (not applied): (1) expose Engine current
host-id accessor or pass host id into future automation-runner call site for
evaluate_and_attempt_dispatch_from_storage; (2) future scheduler/runner +
RPC/CLI surface for manual/reactive invocation; (3) V2 mount of exported
BotsPanel at the single App mount point.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
A: source baseline native-bot-state-contract + bot-state-admission (durable
records admitted, no execution layer). RED: 17 tests vs incomplete first
pass -> 10 pass/7 fail (host-fence/disabled/precedence). GREEN (leader
re-ran from worktree): cargo test -p drogon-core --locked --offline --test
automation_execution = 17/17; clippy -D warnings exit 0; fmt --check clean;
neighbors bot_storage/automation_records/engine_startup/atomicity/bot_input
= 82 pass/0 fail.
B: 66 Mentu + 45 Meetings source files sha256-pinned in manifests; 8
byte-identical frozen suites recorded as blocked bindings (import failure =
preparation, never RED/PASS). RED: panel stubs -> 8 fail/4 pass (12).
GREEN (leader re-ran, Node24 repo-pinned): features/bots = 12/12;
pending-registers 4 pass + 11 todo / 4 pass + 7 todo; full desktop suite
15 files 126/126; tsc --noEmit exit 0; prettier clean per EVIDENCE.md.

Integrated/rendered/platform evidence; exact package identity if applicable:
None yet (no RPC/CLI wiring, no mount, no package). Panel is
exported-but-unmounted; frozen suites await candidate module trees.

Unverified, missing, source defects, deliberate approved deltas:
No Engine/RPC/CLI caller for execution.rs; no scheduler loop (by design);
SSH host-authority fence stays conservative (Ssh always foreign) pending
real registry; frozen suites unrunnable until candidate modules exist;
pending-register items stay it.todo; click binding pinned via data-attrs
(no happy-dom in worktree).

Dependencies requested; next bounded checkpoint:
ROOT: wiring spec above + V2 mount + pinned workspace deps already present
(node_modules/vitest used as-is, no installs). Next: V4-A2 Bot-side
responsibility enabled-gating composed at call site; V4-B2 candidate Mentu
runtime modules binding one frozen suite; history end-to-end (record_run ->
history_for_bot -> panel projection) against real Engine.

Owned processes: session/incarnation/host, settlement/release receipts:
Run run_5040a80fa6dd. ctx_af9ad9dad1f2 worker_done accepted, inspected,
released (transcript archived). ctx_f035020e4207 worker_done accepted,
inspected, release returned retained/external_terminal (opencode terminal
term_f31e5209 created by leader via terminal-create, left live per
no-force-close rule; no further input sent). Both dispatches depth 2.

Rollback; data/credentials/privacy check:
Revert this checkpoint's commit to return to 596ddbd9. No credentials,
network, mic, recordings, real accounts, or source writes involved;
reference reads were git-show only.

Ready for independent review: yes (not self-accepted).
