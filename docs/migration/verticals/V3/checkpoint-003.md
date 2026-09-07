# V3 checkpoint-003: git fidelity, worktree safety, browser/remote UI, cap-std port

Vertical / scope / base SHA / head SHA / branch / worktree:
V3 workspaces/remote. Scope: (a) git.rs fidelity fixes (char-boundary
parse_ab, single-space strip, C-quote unescape, NUL status form, real-git
fixtures, inert probe plan + ProbeGuard), (b) git_worktree.rs parser +
creation validator, (c) features/browser + features/remote UI types,
(d) cap-std handle-relative port of workspace_files.rs (covered in detail
by the handoff commits; this checkpoint records the non-handoff leftovers).
Branch codex/vertical-03-workspaces-remote,
base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604; head filled at commit time.

Capabilities and original contract/test IDs:
WP-ENG-GIT (parser fidelity, worktree safety), WP-UI-BROWSER,
WP-ENG-BROWSER/WP-ENG-REMOTE/WP-CAP-MOBILE (authority/verdict/routing
types + notes). Normative refs (read-only): git-compatibility.md,
ssh-execution-boundary.md, parity-window-browser-authority.md,
parity-remote-enoent-contract.md, parity-test-porting.md T1-T4.

Changed paths; shared-file patch requested:
NEW/MOD (this commit): crates/drogon-core/src/git.rs,
tests/git_baseline.rs, docs/.../V3/git-capability-baseline.md,
crates/drogon-core/src/git_worktree.rs, tests/git_worktree.rs,
docs/.../V3/git-worktree-safety.md (+ leader one-paragraph stale-note
update), apps/desktop/.../features/browser/**,
docs/.../V3/browser-authority-note.md, apps/desktop/.../features/remote/**,
docs/.../V3/host-routing-contracts.md, this checkpoint doc.
Covered by separate handoff commits: workspace_files.* (2cea38f, 94fb2a1),
UI factory/editor deltas (cbe54ad, a6cab17, 6727a5c). No shared-file edits
anywhere (no Cargo/protocol/lib/preload/App changes except ROOT-authorized
cherry-picks 8828dd4 cap-std, 1a040c4 file contract, 8322f44 libc).
Shared requests to ROOT (all sent): files.v1 wiring + exposure decision,
V2 seam relay, shared timestamp formatter factoring.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
New-module REDs were missing-module compile failures; behavior changes
came with failing-first regression tests (panic repro, truncation,
A-B-A replay, stale-foreign-content). Leader re-ran everything:
`cargo test -p drogon-core --test git_baseline` → 59/59 (exit 0).
`cargo test -p drogon-core --test git_worktree` → 41/41 (exit 0).
`cargo test -p drogon-core --locked` → 32 binaries all ok, 0 failed.
`cargo clippy -p drogon-core --all-targets --locked -- -D warnings` →
clean (exit 0). `cargo build -p drogon-core --locked` → clean.
`corepack pnpm vitest run src/renderer/src/features/browser` → 22/22.
`corepack pnpm vitest run src/renderer/src/features/remote` → 16/16.
Full `corepack pnpm vitest run` (apps/desktop) → 256/256, 25 files.
`corepack pnpm typecheck` → exit 0. Real-Git evidence: `git worktree
list -z` fatal-without---porcelain confirmed on 2.50.1, probe plan fixed
accordingly; porcelain fixtures generated from the live binary.

Integrated/rendered/platform evidence; exact package identity if applicable:
Not yet integrated (ROOT central wiring staged separately; 8/8 Engine RPC
gates GREEN per ROOT on staged blobs). UI export-only for V2 mounting.
Rendered click/act acceptance NOT done — CDP evidence leaf running
separately; its result lands in checkpoint-004. macOS local runs above.
No package.

Unverified, missing, source defects, deliberate approved deltas:
- Pre-2.25/2.36/2.31 Git matrix binaries absent: legacy fallbacks are
  synthetic-only (stated in baseline docs).
- Real-SSH/relay/mobile execution: specified as owed tests, not executed.
- Absolute-symlink-inside-root following: explicit documented UNMET
  behavior (cap-std refuses; ROOT accepted refusal, no scope increase).
- Windows open path: documented blocking fallback, not executed on Windows.
- C-quoted edge forms beyond backslash/quote/controls/octal: not claimed.
- No source defects found; no test weakening (no existing test touched).

Dependencies requested; next bounded checkpoint:
None outstanding on V3 side (cap-std 4.0.3 + libc in lock via authorized
cherry-picks). Checkpoint-004: CDP evidence outcome + any V2-mount
fallout + remaining browser/ports/relay-mobile slices.

Owned processes: session/incarnation/host, settlement/release receipts:
Child run run_da3c31d0e3d6. All checkpoint-003 leaves settled
(accepted→released/closed or retained-idle GLM terminal for reuse);
active at write time: CDP evidence leaf only. Every dispatch verified
depth 2. GLM terminal term_1a080866 retained idle in own worktree when
not dispatched, never force-closed.

Rollback; data/credentials/privacy check:
Rollback = revert this commit (additive + V3-owned-path mods only;
handoff commits independent). No credentials/telemetry/real remotes/
cloud/user data touched; tempdir fixtures only.

Ready for independent review: yes (not self-accepted).
