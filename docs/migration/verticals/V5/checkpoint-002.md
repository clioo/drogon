# V5 checkpoint 002 — acceptance runbook + packaging lane seed receipt

Vertical / scope / base SHA / head SHA / branch / worktree:
V5 platform/release. Scope: repeatable per-vertical/combined acceptance
runbook (doc-first) + leader-observed full test:packaging lane seed
receipt. Base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604. Head: this commit.
Branch codex/vertical-05-platform-release. Worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-05-platform-release.

Capabilities and original contract/test IDs:
WP-ENG-INSTALL / WP-SUP-SCRIPTS (runner repeatability), WP-ENG-RUNTIME
package-admission exception, INT-PACKAGED joint gate (V5+V1+V2; V5 side
only, no combined run here). Builds on checkpoint-001 (2d9990e).

Changed paths; shared-file patch requested:
New: docs/migration/verticals/V5/acceptance-runbook.md (leaf C, GLM
reused terminal) + leader correction (packaging lane receipt).
Modified: none besides this checkpoint file. No shared-file edits;
checkpoint-001 requests stand (V1 Windows contract; ROOT CI windows TS
step proposal).

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Doc-first: no product code changed, no RED/GREEN pair. Executed evidence
(leader-observed, this worktree as cwd, Node24 v24.19.0): full 8-file
packaging lane — tests 70 / pass 70 / fail 0 / cancelled 0 / skipped 0 /
todo 0, exit 0, tree clean after. Runbook expected outputs for harness
lanes are source-derived reference expectations, labeled as such; fresh
counts required per run.

Integrated/rendered/platform evidence; exact package identity if applicable:
None new. Sealed package 83e9eca untouched. No harness executed (spawns
daemons/Electron; inspection only per task). No packaging/install run.

Unverified, missing, source defects, deliberate approved deltas:
Harness lanes (accept:core-cli, accept:desktop dev/packaged) have no seed
receipt yet — first authorized execution block records them. Renderer
contracts/typechecks and full pnpm test (Rust) not run in this block.
Windows behavior still unverified, not waived. Deliberate delta: leader
superseded runbook's "no full-lane receipt" line with observed 70/70.

Dependencies requested; next bounded checkpoint:
None. Next: V1-contract follow-up (pipe error-mapping fixture test,
POSIX-first) once V1 answers; authorized harness receipts when ROOT
schedules execution; E5 options await Carlos decisions via ROOT.

Owned processes: session/incarnation/host, settlement/release receipts:
Child Run run_3de36bede2a3. Leaf C task_64f8dddbb52c/ctx_6c7f6b0323e9
depth 2 completed, terminal term_b8dad58b retained (external_terminal, no
process action per retention rule; idle, reusable). Zero active leaves.

Rollback; data/credentials/privacy check:
Rollback: revert this commit (docs only). No data, credentials, models,
sessions, installs, provisioning, or publishing touched.

Ready for independent review: yes (not self-accepted).
