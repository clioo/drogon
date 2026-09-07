Vertical / scope / base SHA / head SHA / branch / worktree:
V1 runtime/CLI, ninth checkpoint: PR14 merge reconciliation of
PR10-integrated checkpoint-001/002 content with branch checkpoints
003-008. Branch codex/vertical-01-runtime-cli, worktree
codex-vertical-01-runtime-cli. Merge commit d683cfb3632316c84eb61cc
53cecd90088fbbcb3, parents 1080749a91f7fa36aed739e7e833d55de6ae724f
(branch checkpoint-008) and 3a52b4661e1177b0c2d031c04a137ca3356ec92e
(origin/main, "Integrate five-vertical checkpoints with combined
acceptance (#10)"). Leaf 1 (task_225caae78a05): read-only regression
test pass, reported zero regressions. Leaf 2 (this file, claude/sonnet lane per worker-start receipt):
verification + reconciliation doc, no fixes required. Coordinator
review corrections applied before commit (conflict list, manifest
attribution, Windows-compilation status).

Capabilities and original contract/test IDs:
WP-ENG-DAEMON (transport/lock/endpoint), WP-ENG-CLI (parity/harness
launch), WP-ENG-DOGFOOD (native coordinated-journey). Reconciliation
only; no new capability contracts opened.

Changed paths; shared-file patch requested:
None — Leaf 1 found zero regressions in owned paths, so no edits were
made. This file added:
docs/migration/verticals/V1/checkpoint-009-merge-reconciliation.md.
No shared files touched. crates/drogond/Cargo.toml's one-line
getrandom dependency-union change was resolved by the V1 coordinator
as part of the merge commit prior to this dispatch; not edited by
Leaf 2 (manifest lines are root-owned per assignment).

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Six conflicted files identified by diffing merge parents 1080749 vs
3a52b46 in owned paths, matching the merge commit message:
1. crates/drogond/src/lock.rs — LockFileEx comment union (11 vs 13
   line variance across parents; both sides' comments kept).
2. crates/drogond/src/endpoint.rs — endpoint/windows-transport
   comment unions; stale pre-integration claims corrected (windows-sys
   + sha2 now deps on both sides).
3. crates/drogond/tests/windows_transport.rs — stale pre-integration
   claims corrected alongside endpoint.rs.
4. crates/drogon-cli/tests/native_dogfood.rs — both-legs negative gate
   kept (branch's 1736-line, 3rd-journey-leg + HOLD-correction version
   is a strict superset of main's single-leg 992-line version).
5. crates/drogond/Cargo.toml — dependency union: main's one-line
   `getrandom = "=0.4.3"` addition kept (both sides already agree on
   sha2 + windows-sys entries).
6. docs/migration/verticals/V1/dogfood-evidence.md — appends kept
   (branch's checkpoint-006/007/008 sections are a strict superset of
   main's shorter pre-integration version; merged file is 949 lines).
(crates/drogon-harness/src/launch.rs auto-merged without conflict;
branch content preserved as outstanding inventory, see below.)

Fresh test evidence (Leaf 2 re-run after Leaf 1's report, same
checkout, cwd = worktree root, DROGON_DOGFOOD_REAL_MODEL unset, no
paid endpoint invoked):
cargo fmt --check -p drogon-cli -p drogond -p drogon-harness: exit 0,
no diff.
cargo test -p drogon-cli -p drogond -p drogon-harness: 276 passed, 0
failed, 0 ignored across all binaries —
drogon-cli: lib 53, argument_parity 22, integration 49,
native_dogfood 8, orchestration_auth 6, orchestration_commands 52,
parser 7 (197 total);
drogon-harness: lib 7, discovery_contract 3, known_tui_agents 6,
launch_contract 7 (23 total);
drogond: lib 25, coordination_access 6, server 12,
service_quiescence 10, windows_transport 3 (56 total).
No weakened assertions, no deleted tests — none of the six conflicts
required a code fix since both sides' intent was already correctly
unioned in the merge commit.

Integrated/rendered/platform evidence; exact package identity if
applicable:
NONE on Windows — cfg(windows) paths are not compiled on this Unix
host (cfg-stripped; no Windows toolchain) and remain unverified;
V5 Windows runner remains first verifier per checkpoint-003/005.

Unverified, missing, source defects, deliberate approved deltas:
- Real-model coordinated-journey paid run: explicitly ON HOLD, deferred
  to root; requires explicit paid-run clearance before
  DROGON_DOGFOOD_REAL_MODEL is ever set. Not invoked by Leaf 1 or
  Leaf 2 (zero spend preserved).
- All cfg(windows) paths: reviewed, uncompiled on this host; awaits V5
  Windows runner.
- Outstanding-vs-already-integrated inventory (confirmed present in
  working tree at head d683cfb):
  ALREADY in origin/main via PR10 (3a52b46): V1 checkpoint-001/002-era
  code+docs (cli.rs parity, native dogfood base, endpoint/lock/server/
  service_quiescence base, cancel-reopen evidence).
  OUTSTANDING on this branch, verified preserved through the merge:
  checkpoint-003/004/005 docs (80/59/50 lines respectively),
  windows-transport-evidence.md (1559 lines),
  native_dogfood.rs +844-line expansion (3rd journey leg + HOLD
  corrections, 1736 lines total), endpoint overlapped/DACL
  checkpoints 005-008 (endpoint.rs 1895 lines), harness launch.rs
  (333 lines) + launch_contract.rs attempt-cancel-reopen tests
  (198 lines), argument_parity.rs extensions (22 tests).

Dependencies requested; next bounded checkpoint:
ROOT: paid-run clearance for the real-model coordinated-journey leg
when authorized; V5 Windows runner execution; PR #14 merge order and
combined-acceptance sign-off. V1 next: remaining command/harness
families when directed.

Owned processes: session/incarnation/host, settlement/release
receipts:
Leaf 1 (task_225caae78a05) settled prior to this dispatch, zero
regressions reported. This dispatch (task_0d39e0c297ca) made no code
edits; only this checkpoint doc added. No surviving processes.

Rollback; data/credentials/privacy check:
No durable state, credentials, or network use. No paid/model endpoint
invoked. Rollback: revert this doc-only commit.

Ready for independent review: yes (not self-accepted).
