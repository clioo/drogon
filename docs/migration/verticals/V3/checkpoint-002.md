# V3 checkpoint-002: Git baseline + host-routing + ROOT-ordered corrections

Vertical / scope / base SHA / head SHA / branch / worktree:
V3 workspaces/remote. Scope: (a) Git capability baseline module + doc,
(b) remote/host-routing UI types + contract note, (c) ROOT-review corrections
to checkpoint-001 file-IO (bounded read, mode-preserving write, honest
containment docs, bounded list, timestamp-marker fix) and UI (identity-keyed
explorer reset, fenced saves, per-path drafts). Branch
codex/vertical-03-workspaces-remote, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-03-workspaces-remote.
Base 596ddbd9e8b6fdc5d5fa26616479e910b34ba604; head filled at commit time.

Capabilities and original contract/test IDs:
WP-ENG-GIT (capability/cache/parser/probe-plan slice; no execution yet),
WP-UI-WORK/WP-UI-EDITOR (corrections), WP-ENG-REMOTE/WP-CAP-MOBILE
(host-routing contract note + verdict/reducer types). Normative source refs
(read-only): git-compatibility.md, ssh-execution-boundary.md,
parity-remote-enoent-contract.md, parity-cli-workspace-contracts.md,
parity-test-porting.md T1-T4. ROOT rulings applied: files.v1 seam accepted
with required hostId + dual-host verification + echo triple, 65536
decoded-byte read/write caps, list 1000 + byte bound, central admission owns
caps; containment must not be called safe; mtime never now_rfc3339;
ROOT owns workspace_file_rpc.rs + tests/native_files_rpc.rs and the
cap-std 4.0.3 central dep add.

Changed paths; shared-file patch requested:
MOD crates/drogon-core/src/workspace_files.rs + tests/workspace_files_explorer.rs
(corrections; list_dir signature now returns DirListing{entries,truncated}).
NEW crates/drogon-core/src/git.rs + tests/git_baseline.rs.
NEW docs/migration/verticals/V3/git-capability-baseline.md.
MOD apps/desktop/.../features/workspaces/* + features/editor/* (corrections).
NEW apps/desktop/.../features/remote/*.ts (8 files) + host-routing-contracts.md.
NEW this checkpoint doc. No tracked file outside V3 paths modified; no
Cargo.toml/lock, protocol, lib.rs, preload, or App edits. Shared requests to
ROOT (sent): central files.v1 wiring per accepted seam; cap-std =4.0.3 dep
add (absent from Cargo.lock at correction time — port queued); shared timestamp
formatter factoring at wiring time.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Git tests-first RED: missing-module compile failure, then GREEN.
`cargo test -p drogon-core --test git_baseline` → 29/29 (exit 0, re-ran).
`cargo test -p drogon-core --test workspace_files_explorer` → 29/29
(17 updated to DirListing shape + 12 new regression tests; exit 0, re-ran).
`cargo clippy -p drogon-core --all-targets --locked -- -D warnings` → clean
(exit 0, re-ran). `cargo test -p drogon-core --locked` (checkpoint-001) →
30 binaries all ok. `corepack pnpm vitest run src/renderer/src/features` →
5 files 57/57 (explorer 19, editor 22, remote 16; exit 0, re-ran).
Full apps/desktop suite 171/171 per leaf (leader re-ran features scope only).
`corepack pnpm typecheck` → exit 0 (re-ran). pnpm via corepack (not on PATH).

Integrated/rendered/platform evidence; exact package identity if applicable:
Not yet integrated (ROOT wires RPC centrally). UI still export-only;
corrections verified at exported-pipeline + reducer + SSR-snapshot level.
macOS local runs above. No package.

Unverified, missing, source defects, deliberate approved deltas:
- cap-std Dir-relative port: queued on ROOT central dep add (verified absent
  from Cargo.lock); conservative documented path stands meanwhile.
- Real Git 2.25.5/2.38.1/2.49.1 matrix binaries absent on this host: fallback
  branches validated against synthetic input only (stated in baseline doc).
- Real-SSH behaviors (provider-unavailable wire shape, version-skew
  reconnect, mixed-version ENOENT): specified as owed tests, not executed.
- Rendered-lifecycle (click/type under act) tests: harness gap — repo has no
  DOM harness (no jsdom/happy-dom/testing-library); owed to V2 mount owner.
- Porcelain v2 C-quoted paths pass through quoted (parser limitation, noted).
- No source defects found; no test weakening (no existing test touched).

Dependencies requested; next bounded checkpoint:
cap-std 4.0.3 central add (ROOT). Checkpoint-003: Git probe-execution
design + files RPC consumer tests against ROOT wiring once staged; then
browser/ports/relay-mobile slices. PR base main per ROOT instruction.

Owned processes: session/incarnation/host, settlement/release receipts:
Child run run_da3c31d0e3d6. Git leaf ctx_d65ce7e9dcc3 (accepted, released/
closed, transcript archived). Remote leaf ctx_cdec45c9a0df (accepted,
released→retained/external, no action). File-correction ctx_77995ac32b4d
(accepted) → marker follow-up ctx_3edc3642e3ad (accepted, released/closed).
UI-correction ctx_cb66198885d7 (accepted, released→retained/external).
GLM terminal term_1a080866 retained idle in own worktree for reuse, never
force-closed. Zero active leaves. All dispatches verified depth 2.

Rollback; data/credentials/privacy check:
Rollback = revert checkpoint-002 commit(s) (additive + owned-path mods only).
No credentials, telemetry, real remotes/cloud, or user data touched.

Ready for independent review: yes (not self-accepted).
