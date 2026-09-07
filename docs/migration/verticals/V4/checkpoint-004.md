# V4 checkpoint-004: durable history + scope fence (history checkpoint)

Vertical / scope / base SHA / head SHA / branch / worktree:
V4 Capabilities on codex/vertical-04-capabilities, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-04-capabilities.
Follows checkpoint-003 (63edd95). HISTORY scope only: A5 durable record
path + A7 P2-1 fence + leader lock-comment correction. Excludes active A6
bot.run WIP (bot_run_rpc.rs, native_bot_run.rs — untouched, uncommitted)
and paused INT/DEVICE partials (untracked).

Capabilities and original contract/test IDs:
WP-CAP-BOTS (responsibility-run durability, history scoping), WP-CAP-AUTO
(runner record path). No source-blob ports in this checkpoint; prior
checkpoint evidence stands.

Changed paths; shared-file patch requested:
- crates/drogon-core/src/automations/records.rs: +3 approved optional
  serde-default fields (session_incarnation/exit_code/observed_at;
  camelCase on the wire via container rename_all, zero migration)
- crates/drogon-core/src/automations/runner.rs: record_run_outcome rewrite
  (linked ar:{request_id} upsert, read-modify-write preserving
  created/started/run_number/identity, status lifecycle, verbatim errors,
  stale-observed_at rejection, Exited-never-regresses) + leader 2-line
  lock-comment correction (caller MUST release; no type-level guarantee
  claimed)
- crates/drogon-core/src/bots/storage.rs: P2-1 read-path fence (stamped
  scope on new run payloads, scoped filter, legacy-row documented rule,
  audit rows preserved on disk) — no migration, no other behavior change
- tests/automation_runner.rs (26 tests), tests/bot_history_scope.rs (new,
  3 tests), tests/automation_records.rs + tests/bot_storage.rs (3
  None-only literal completions, zero assertion changes)
- This doc. No shared files touched; no patch requested (bridge/registration
  owned by ROOT; bot.run module arrives separately).

Baseline evidence; behavioral RED (honestly labeled); GREEN + counts:
A5: 26/26 automation_runner; full crate 33 suites 0 fail; clippy/fmt clean.
EVIDENCE LABEL CORRECTION (ROOT review): prior disable-and-restore checks
(A4/A5) are MUTATION SENSITIVITY, not behavioral RED — labeled so here.
Genuine RED provenance in this checkpoint: A7 P2-1 regression run against
the PRE-FIX implementation via file-copy swap (no git mutation):
delete-A/recreate-B test fails (A-era runs leak under B), storage-shape
pin fails if renamed; fix restored -> 3/3 GREEN. Leader independently
re-ran: bot_history_scope 3/3, full crate 33/33 suites ok, clippy clean,
fmt clean. A5 literal fixes verified None-only by diff; new fields verified
camelCase-on-wire via container attr.

Integrated/rendered/platform evidence; exact package identity if applicable:
None (domain logic + storage; bridge/mount ROOT-owned).

Unverified, missing, source defects, deliberate approved deltas:
No live-Engine dispatch exercised (fake seam; real-Engine tests cover
error paths); exit_code/incarnation/observed_at new (no legacy data);
legacy unstamped run rows stay visible under bot-id match (documented
rule); occurrence counters untouched by retries (source meaning unproven);
P2-2 pagination + auth NITs excluded (ROOT-owned).

Dependencies requested; next bounded checkpoint:
ROOT: M1/M2 + bot.run bridge, V2 mount. V4: checkpoint-005 = A6 bot.run
module review once delivered.

Owned processes: session/incarnation/host, settlement/release receipts:
Run run_5040a80fa6dd. A5 ctx_eaf76d192a53 + A7 ctx_0050925a6b1c: accepted,
released/closed. A6 ctx_bcba8c14b6b6 active, WIP preserved. All depth 2.

Rollback; data/credentials/privacy check:
Revert this commit to return to 63edd95. No credentials, network, mic,
recordings, real accounts, or source writes.

Ready for independent review: yes (not self-accepted).
