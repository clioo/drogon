# V3 checkpoint-004: PR10 reconciliation + PATH-isolation fix

Vertical / scope / base SHA / head SHA / branch / worktree:
V3 workspaces/remote. Scope: (a) merge origin/main PR10 3a52b466 into
branch, resolving 4 conflicts by restoring main's bot/files wiring;
(b) held-defect fix: process-global PATH mutation removed from the git
timeout test via an explicit-git-binary seam. Branch
codex/vertical-03-workspaces-remote (PR #12, OPEN, base main — coordinator
correction msg_3565e113a80f: V3 owns PR12, not PR13; verified via
`gh pr list --head`: number 12, "V3 checkpoints 001+002"). Base
3a52b466; head filled at commit time.

Capabilities and original contract/test IDs:
WP-ENG-GIT (read-only wrapper determinism, worktree safety),
WP-CAP-MEET-adjacent files/remote baseline preservation. Normative refs
(read-only): git-compatibility.md, ssh-execution-boundary.md,
parity-remote-enoent-contract.md, V3 git-capability-baseline.md,
git-worktree-safety.md.

Changed paths; shared-file patch requested:
Merge 7c17436 (no-reset, no force): 4 conflict files resolved to main's
side (branch deletions were pure staleness, zero branch intent lost):
apps/desktop/src/main/index.ts, apps/desktop/src/preload/index.ts,
apps/desktop/src/shared/bridge-validation.ts,
apps/desktop/src/shared/session-contract.ts. Without this merge the
branch would have REGRESSED main by deleting botSnapshot/BotBridge wiring.
Leaf A (implementer): crates/drogon-core/src/git_process.rs (+57/-12:
`run_read_only_git_with_bin` / `build_git_command_with_bin` /
`spawn_git_and_capture` git_bin param; `run_read_only_git` signature and
semantics unchanged),
crates/drogon-core/tests/git_process.rs (timeout test points
`run_read_only_git_with_bin` directly at the slow wrapper script; zero
`set_var`/`remove_var`; read-only PATH lookup factored into
`resolve_real_git_binary`). This checkpoint doc. No shared-file edits
(no lib.rs/protocol/Cargo/manifest changes; git modules stay
`#[path]`-included, unwired — RPC wiring remains a ROOT decision, reported
not taken).

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Pre-leaf baseline post-merge: git_baseline 60 + git_process 19 +
git_process_bounds 22 + git_worktree 54 = 155/155 (exit 0). Coordinator
re-ran post-fix: same four binaries 60/19/22/54, plus
workspace_files_explorer 12, native_files_rpc 8, native_bot_snapshot 39 —
214 passed / 0 failed (exit 0). `cargo clippy -p drogon-core --all-targets
--locked -- -D warnings` clean (exit 0). `cargo fmt -p drogon-core -- --check`
clean (exit 0). Leaf B independently ran the full
`cargo test -p drogon-core --locked` suite: 794 passed / 0 failed /
1 pre-existing ignored; clippy zero warnings. Behavioral assertion
preserved exactly: 100ms budget vs 5s-sleep wrapper maps to
`unverifiable` through `run_read_only_git_with_bin`. No test weakening
(assertion and budgets unchanged; only the isolation mechanism changed).

Integrated/rendered/platform evidence; exact package identity if applicable:
Not yet integrated (modules unwired from lib.rs by design; see shared
requests). UI/desktop files now byte-identical to origin/main for all
features/browser+editor+remote+workspaces paths (0-line diff) — already
accepted via PR10. macOS local runs above. No package.

Unverified, missing, source defects, deliberate approved deltas:
- Checkpoint-003's 59/59 + 41/41 counts are stale (now 60 + 54); left
  frozen as history, current counts recorded here.
- Leaf B coverage gaps (owed, not in this checkpoint): no pre-2.36 Git
  binary matrix; explicitly-unimplemented pre-2.31 prunable probe; zero
  spawn-layer coverage of remote HostScope (Wsl/Ssh/Relay — native only);
  no wrapper yet for fetch/merge-tree/decorate capabilities.
- No source defects found in leaf scope. One transient compile error
  during Leaf B's first run was caused by Leaf A's in-flight edit (shared
  checkout, disjoint files but shared crate), resolved on rerun — noted,
  no action.
- GLM leaf attempt: Orca refused `worker-start --agent opencode --model`
  ("does not support launch-time model selection", mutation
  67bf2c6c-0bcc-4883-a161-b5112286e0e5); global opencode default is
  kimi-for-coding/k2p6, so launching model-less would have been a silent
  substitution. Leaf B relaunched as second Sonnet 5 high instead.

Dependencies requested; next bounded checkpoint:
None on V3 side. Shared requests to ROOT (sent, not taken): lib.rs
registration of git.rs/git_process.rs/git_worktree.rs + files.v1-style
exposure decision for `run_read_only_git_with_bin` (test-only seam today);
fetch/merge-tree/decorate wrapper scope; remote-HostScope spawn coverage.

Owned processes: session/incarnation/host, settlement/release receipts:
Own run run_4602833348a8 (parent run_99a853e54347, parent dispatch
ctx_75878ba848ef). Leaf A task_8c5113188475/ctx_beb4766d4d8d
(claude/sonnet/high, requested==effective, worker_done succeeded,
filesModified exactly the 2 owned files) → worker-release. Leaf B
task_f6980427b4dc/ctx_3db4bdf4db0b (claude/sonnet/high,
requested==effective, worker_done succeeded, no files) → worker-release.
Zero active leaves at write time. Leaves never delegated (depth enforced).

Rollback; data/credentials/privacy check:
Rollback = revert the fix commit (2 owned files + this doc; merge 7c17436
independent and kept). No credentials/telemetry/real remotes/cloud/user
data touched; tempdir fixtures only.

Ready for independent review: yes (not self-accepted).
