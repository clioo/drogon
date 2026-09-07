Vertical / scope / base SHA / head SHA / branch / worktree:
V1 runtime/CLI, fourth checkpoint: Windows overlapped-lifetime safety
corrections (ROOT BLOCKING review of 530b0e7). Same branch/worktree/Run.
Leaf: Sonnet 5 high follow-up on transferred terminal.

Capabilities and original contract/test IDs:
WP-ENG-DAEMON (transport). Compiler-UNVERIFIED designation retained: no
Windows toolchain exists on this host (no rustup at all; cargo check
--target x86_64-pc-windows-msvc fails E0463, no core). V5's Windows runner
remains first verifier.

Changed paths; shared-file patch requested:
Edited: crates/drogond/src/endpoint.rs (all three fixes),
crates/drogond/src/service_quiescence.rs (registry doc correction),
docs/migration/verticals/V1/windows-transport-evidence.md (Safety
section), docs/migration/verticals/V1/checkpoint-004.md (this file).
NOT in this commit (held): dogfood final fixes. No shared files; the
Win32_System_Threading line is ROOT's bddb3ec cherry-pick, already on the
branch.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Blocking defects and fixes: (1) run_overlapped WAIT_FAILED arm returned
with ERROR_IO_PENDING still owning stack OVERLAPPED/buffer/event — now
CancelIoEx + GetOverlappedResult(TRUE) reap on EVERY post-issue exit,
reporting the captured wait error; (2) timeout path now returns racing
GetOverlappedResult success (transferred bytes/connect) as success, only
ERROR_OPERATION_ABORTED reports timed_out; (3) new SharedTransportState<H>
(Arc<Mutex>, usize-keyed) shared across try_clone duplicates: shutdown
fences clones' next I/O (BrokenPipe), cancels live handles,
DisconnectNamedPipe fires exactly once by final owner; stale registry
claims corrected.
Tests: 5 host-agnostic SharedTransportState unit tests + 4 Windows-only
host-gated tests (2 deterministic, 2 bounded-retry for kernel timing).
Leader re-ran on macOS: cargo test -p drogond (7 ok targets, zero
failures), cargo clippy -p drogond --all-targets --locked -- -D warnings
clean, cargo fmt --all -- --check exit 0.

Integrated/rendered/platform evidence; exact package identity if applicable:
NONE on Windows — designation retained. Windows verification strategy
unchanged from checkpoint-003 (V5 runner at a green commit).

Unverified, missing, source defects, deliberate approved deltas:
- All cfg(windows) paths, including these fixes: reviewed, uncompiled.
- server.rs accept-loop end-to-end + idle-timeout overlapped parity: open.
- .cmd prompts via PTY stdin: explicitly scoped, not implemented.

Dependencies requested; next bounded checkpoint:
ROOT: review safety checkpoint, V5 Windows execution, PR #14 merge order,
dogfood combined verification. V1 next: remaining command/harness
families when directed.

Owned processes: session/incarnation/host, settlement/release receipts:
Safety dispatch ctx_c6ddab7516bd completed; terminal released on
acceptance. No surviving processes.

Rollback; data/credentials/privacy check:
No durable state, credentials, or network use. Rollback: revert commit.

Ready for independent review: yes (not self-accepted).
