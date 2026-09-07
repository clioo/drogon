# V4 checkpoint-002: responsibility policy, runner phase-split, suite bind, panel honesty

Vertical / scope / base SHA / head SHA / branch / worktree:
V4 Capabilities on codex/vertical-04-capabilities, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-04-capabilities,
base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604 (checkpoint-001 a0fa3199
already pushed, PR #13 OPEN/MERGEABLE/CLEAN, 3 checks green, awaiting ROOT
merge). Head SHA at commit time. Builds on checkpoint-001 (execution.rs
17/17, BotsPanel export, MENTU/MEET frozen ports).

Capabilities and original contract/test IDs:
WP-CAP-BOTS (responsibility-owner gating, history durability), WP-CAP-AUTO
(schedule/trigger dispatch through confirmed harness.start seam),
WP-CAP-MENTU catalogs (first BOUND frozen suite), WP-UI-AUX/WP-UI-AUTO
(panel liveness honesty + PanelDescriptor factory for V2 mount). Source pin
c97906287bb7a390b25e2025b600d9fb3c25d9c3, git-show reads only.

Changed paths; shared-file patch requested:
A2 (Sonnet, ACCEPTED+released): crates/drogon-core/src/bots/policy.rs
(new), bots/mod.rs (+1 line), tests/bots_policy.rs (15 tests).
A3 (Sonnet, NOT accepted, superseded by A4): runner.rs v1 with combined
attempt_responsibility_run — replaced, never committed separately.
A4 (Sonnet, ACCEPTED+released): runner.rs rewritten (544 lines):
prepare_run_plan / dispatch_run_plan / record_run_outcome phase split,
sha2 request_id, snapshot txn, typed InconsistentTriggerKind; tests
automation_runner.rs (21 tests).
B2R (GLM, ACCEPTED+retained): WP-CAP-MENTU/catalogs 5 byte-identical
candidates + in-path vitest.config.ts (zod alias to exact installed 4.5.4)
+ STATUS.md — first BOUND suite (2/2).
B3 (GLM, ACCEPTED+retained): features/bots liveness fix (Session linked +
injected observed live/unverifiable/exited + stale test), Create Bot
removed, 16/16, desktop 130/130.
B4 (GLM, ACCEPTED+retained): bots-panel-descriptor.ts factory (structural,
no registerRoute/mount) + 7/7 pins, desktop 137/137.
Paused (NOT in commit scope unless listed): WP-CAP-INT/DEVICE partial
frozen copies stay untracked preparation per ROOT (no new catalog work).
Shared patch REQUESTED from ROOT (exact proposal in A4 report, repeated
here): (M1) bot.responsibility.scheduledTick {hostId,folder,botId,
responsibilityId,currentHostId,dueAt,harnessParams{harnessId,model?,
effort?,provider?,permissionMode?}}, event_identity=dueAt; (M2)
bot.responsibility.manualInvoke + {operatorId,requestedAt},
event_identity={operatorId}@{requestedAt}; responses
refused/unsupported/dispatched with serialized RunRefusal/RunUnsupported/
RunnerOutcome; errors bot_not_found/responsibility_not_found/
storage_error/inconsistent_trigger_kind. lib.rs: add pub connection()
(Arc clone) + pub host_id(); route M1/M2 to prepare/dispatch/record via
EngineDispatchSeam with lock-only-across-prepare sequencing; decide
default_harness->HarnessId mapping; optional exit-code schema follow-up.
V2 mount: factory exported, mount owned by ROOT/V2.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
A2: leader re-ran 15/15; behavioral RED leader-proven (disabled gate
neutralized -> exactly 2 disabled tests fail; byte-exact restore ->
15/15); clippy/fmt clean; neighbors 82 green.
A4: leader re-ran automation_runner 21/21; full -p drogon-core 32 suites
ok / 0 fail; clippy -D warnings clean; fmt clean. Code-verified: no
fn takes conn+seam; sha2 length-prefixed 5-tuple, FNV64 gone; single
unchecked_transaction snapshot; no unreachable; Engine.db is
Arc<Mutex<Connection>> with dispatch relocking (deadlock premise
confirmed in lib.rs). Worker RED claims (collision revert, gate disable)
plausible and consistent with suite shape; leader independently proved
the RED pattern on A2's gate.
B2R: leader re-ran catalogs suite 2/2; frozen test hash untouched;
5 candidates sha256-verified byte-identical by leader.
B3/B4: leader re-ran desktop 130/130 then 137/137 (16 files); tsc clean;
grep-verified no liveness inference, no Create control, no
registerRoute/mount in factory.

Integrated/rendered/platform evidence; exact package identity if applicable:
None (no RPC/CLI wiring, no mount, no package). PR #13 green is prior
checkpoint scope only.

Unverified, missing, source defects, deliberate approved deltas:
No live-Engine dispatch exercised (fake seam in unit tests; real-seam
tests cover error paths only); no scheduler loop/daemon; harness/model
resolution caller-supplied; exit_code not durable (tri-state only);
INT/DEVICE ports paused partial; frozen MENTU/MEET suites beyond catalogs
still blocked bindings.

Dependencies requested; next bounded checkpoint:
ROOT: M1/M2 bridge + lib.rs accessors + V2 mount (see proposal above).
V4 next: history end-to-end through runner record path against real
Engine error-path seam; bind one more frozen suite only if ROOT lifts
the catalog pause; no generation-3, no new catalog-only work.

Owned processes: session/incarnation/host, settlement/release receipts:
Run run_5040a80fa6dd. ctx_066e6812eb46 (A2) released/closed;
ctx_ccedcb2888a7 (A4) released/closed; ctx_0de24ff8ccfc (B2R),
ctx_00d85854de13 (B3), ctx_b3629e3dc39d (B4) retained-external (shared
GLM terminal term_f31e5209, live-idle, no force-close). ctx_d369b91d50a1
(B2) abandoned after cooperative halt; task blocked with redirect note.
All dispatches depth 2.

Rollback; data/credentials/privacy check:
Revert this checkpoint commit to return to a0fa3199. No credentials,
network, mic, recordings, real accounts, or source writes; reference
reads git-show only.

Ready for independent review: yes (not self-accepted).
