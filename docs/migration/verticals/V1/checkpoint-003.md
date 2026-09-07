Vertical / scope / base SHA / head SHA / branch / worktree:
V1 runtime/CLI, third checkpoint: Windows native transport completion
(compiler-UNVERIFIED designation retained throughout). Base 596ddbd9e8b6f
(+ 0489018, 1c46085 sha2 cherry-pick, 4c1f019, e7280f1, fda7987,
72ef919 windows-sys cherry-pick). Branch codex/vertical-01-runtime-cli,
same worktree. Child Run run_797122265fda. Leaf: Sonnet 5 high (2
generations: rework + completion follow-up on transferred terminal).

Capabilities and original contract/test IDs:
WP-ENG-DAEMON, WP-ENG-HARNESS, WP-ENG-RUNTIME (transport). Frozen pipe-name
contract (paths.rs::windows_pipe_name) unchanged. No Windows parity
claimed: every cfg(windows) line in this commit is compiler-unverified on
any host so far.

Changed paths; shared-file patch requested:
Edited under ROOT scoped grant: crates/drogond/src/endpoint.rs (sha2
swap for real, windows-sys overlapped-I/O listener/connection, UNC
verbatim-prefix fix), lib.rs (cfg(windows) module export), server.rs +
service_quiescence.rs (Transport-trait genericization reusing Unix
accept-loop/drain), lock.rs (LockFileEx Windows lock),
crates/drogon-harness/src/launch.rs (.cmd adapter + prompt-scoped refusal),
crates/drogon-harness/tests/launch_contract.rs (stale rejection updated).
New: crates/drogond/tests/windows_transport.rs,
docs/migration/verticals/V1/windows-transport-evidence.md (+ Rework +
Completion sections), docs/migration/verticals/V1/checkpoint-003.md.
NOT in this commit (held): dogfood final fixes (native_dogfood.rs,
dogfood-evidence.md — ROOT combined verification pending).
Shared need for ROOT: add Win32_System_Threading to the windows-sys
feature line (exact replacement line in evidence doc); V1 does not touch
Cargo concurrently.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Baseline: daemon serve/token/endpoint unix-gated (UnsupportedPlatform);
CLI connect-only. This delta: deterministic pipe-name algorithm proven
byte-identical to drogon-cli (6 tests); .cmd adapter source-ported with
prompt-scoped refusal + host-gated fixture tests; full wiring implemented
against windows-sys 0.61.2 (6/7 features present).
Leader re-ran on macOS arm64: cargo test -p drogond (7 ok targets),
cargo test -p drogon-harness (23 passed), cargo clippy -p drogond
-p drogon-harness --all-targets --locked -- -D warnings clean,
cargo fmt --all -- --check exit 0, workspace build OK. Zero failures.

Integrated/rendered/platform evidence; exact package identity if applicable:
NONE on Windows yet — that is the explicit designation of this
checkpoint. Windows compile strategy (for ROOT/V5): (1) V5 isolated
Windows runner checks out this branch at the checkpoint commit and runs
cargo check -p drogond --locked --target x86_64-pc-windows-msvc (or native
Windows cargo check) — expected FIRST to fail only on the missing
Threading feature until ROOT's Cargo line lands, then pass; (2) V5 runs
the host-gated windows_transport + .cmd fixture tests natively; (3) no
merge-to-main of Windows behavior and no Windows-supported claim until
(1)-(2) are green and ROOT reviews; (4) long-term: Windows CI leg (ROOT
owned). Unix behavior bit-for-bit preserved per full regression above.

Unverified, missing, source defects, deliberate approved deltas:
- ALL cfg(windows) code paths: written, reviewed, compiler-unverified.
- server.rs accept-loop/end-to-end Windows serve: wired per Transport
  trait but never executed; idle-timeout parity needs overlapped I/O
  (flagged open risk in evidence doc).
- .cmd prompts via PTY stdin: explicitly scoped, not implemented
  (call site in drogon-core harness.rs, out of scope).
- Pipe-name consolidation into drogon-protocol: optional long-term,
  duplicate verified byte-identical today.

Dependencies requested; next bounded checkpoint:
ROOT: Win32_System_Threading Cargo line; lib.rs wiring review; V5 Windows
runner execution; PR #14 merge order. V1 next: remaining
command/harness families (ask/reply/check, stop/abandon) once directed;
no new speculative starts.

Owned processes: session/incarnation/host, settlement/release receipts:
Completion dispatch ctx_53063a16231d completed; Sonnet terminal released.
Ephemeral test dirs removed. No surviving processes.

Rollback; data/credentials/privacy check:
No durable state outside the worktree; no credentials/network touched by
this delta. Rollback: revert this commit (cherry-picks 1c46085/72ef919
stand independently).

Ready for independent review: yes (not self-accepted).
