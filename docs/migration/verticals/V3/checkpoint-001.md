# V3 checkpoint-001: folder/Git explorer + read/save editor (domain + UI)

Vertical / scope / base SHA / head SHA / branch / worktree:
V3 workspaces/remote, first checkpoint: file-explorer/editor domain
primitives against real core behavior + export-only renderer components for
V2 mounting. Base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604, head
ff327a56c86d2fdf859f8b0fa6caeaeaea85e305, branch
codex/vertical-03-workspaces-remote, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-03-workspaces-remote.

Capabilities and original contract/test IDs:
WP-UI-WORK, WP-UI-EDITOR (first slice); protocol-v1.md workspace section
(Workspace folder/git classification reused, no git mutation at register);
source boundary docs (read-only): git-compatibility.md (baseline/fallback
policy, not yet implemented — noted below), ssh-execution-boundary.md
(no-local-fallback rule, preserved by design: module takes an explicit
root and never substitutes another host).

Changed paths; shared-file patch requested:
NEW crates/drogon-core/src/workspace_files.rs (list_dir/read_file/
write_file scoped to caller-supplied root).
NEW crates/drogon-core/tests/workspace_files_explorer.rs (17 tests).
NEW apps/desktop/src/renderer/src/features/workspaces/WorkspaceExplorer.tsx
+ .test.ts + index.ts.
NEW apps/desktop/src/renderer/src/features/editor/EditorPane.tsx + .test.ts
+ index.ts.
No tracked file modified. Shared-file patch REQUESTED from ROOT (not applied):
(1) crates/drogon-core/src/lib.rs: add `mod workspace_files;` plus future
`files.list|files.read|files.write` dispatch arms reusing these functions;
(2) crates/drogon-protocol: additive method names only, no existing change;
(3) preload/CLI wiring later with V1/V2. Minimal diff sketch available on ask.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Source baseline: workspace.register/list behavior unchanged
(workspace-path-safety.rs still passes inside package run); new-module RED
was a missing-module compile failure for the test-first skeleton, then GREEN.
`cargo test -p drogon-core --test workspace_files_explorer` → 17 passed,
0 failed (exit 0, leader re-ran).
`cargo clippy -p drogon-core --all-targets --locked -- -D warnings` → clean
(exit 0; one follow-up fixed 8 lints: targeted allow(dead_code) on the
#[path]-included error module + one clone_on_copy).
`cargo test -p drogon-core --locked` → 30 binaries, all ok, 0 failed.
`corepack pnpm vitest run src/renderer/src/features` (apps/desktop) → 2 files,
27 passed (exit 0, leader re-ran). `corepack pnpm typecheck` → exit 0.
Note: pnpm is not on PATH; use `corepack pnpm` (packageManager pnpm@11.19.0).

Integrated/rendered/platform evidence; exact package identity if applicable:
Not yet integrated (no RPC/preload/CLI wiring by design); UI is export-only
barrels for V2 mounting, renderer components take injected data sources only
(no Node/Electron imports). Platform: macOS local runs above; Linux-only
symlink tests are #[cfg(unix)]-gated as in the existing suite. No package.

Unverified, missing, source defects, deliberate approved deltas:
- RPC methods files.list/read/write, preload bridge, CLI verbs: missing by
  design, pending ROOT wiring patch.
- Git status/diff/stage/commit/worktree + host routing (SSH/WSL/relay/mobile/
  browser/ports): not started; checkpoint-002 scope.
- Git 2.25 fallback/capability caching per host: not implemented yet.
- Check-then-act TOCTOU between symlink check and use: known limitation,
  same class as existing code; will be addressed at RPC-wiring review.
- UI tests use injected fakes + renderToString on pure logic; no CDP yet
  (needs V2 mount + combined app).
- No source defects found; no test weakening (no existing test touched).

Dependencies requested; next bounded checkpoint:
No dependency install needed. Checkpoint-002 (~next 45-60 min): bounded Git
baseline (source git-compatibility capability table → behavior probes design +
status/diff baseline tests against real git binary) and host-routing contract
note; needs no new shared files.

Owned processes: session/incarnation/host, settlement/release receipts:
Child run run_da3c31d0e3d6. Leaf1 Sonnet ctx_c1c68456ae19 (worker_done
accepted, inspected) → follow-up ctx_78ae214523bd (worker_done accepted) →
worker-release → released/closed, transcript archived. Leaf2 GLM
ctx_3c5eaa1d3696 (worker_done accepted, inspected) → worker-release →
retained/external_terminal, no process action: opencode terminal
term_1a080866-644f-44b6-ba71-18f302ab5fb4 kept idle in own worktree for
planned checkpoint-002 GLM reuse, never force-closed. No other descendants.
All dispatches verified depth 2.

Rollback; data/credentials/privacy check:
Rollback = revert single commit ff327a56 (additive-only, no tracked edits).
No credentials, telemetry, real remotes, or user data touched; fixtures are
tempdirs. No PII in tests.

Ready for independent review: yes (not self-accepted).
