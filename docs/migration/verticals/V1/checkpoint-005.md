Vertical / scope / base SHA / head SHA / branch / worktree:
V1 runtime/CLI, fifth checkpoint: Windows overlapped race corrections
(ROOT BLOCKING review of 4fcf2ee). Same branch/worktree/Run. Leaf: Sonnet
5 high (re-engaged after a transient provider 500 via terminal nudge; no
work lost).

Capabilities and original contract/test IDs:
WP-ENG-DAEMON (transport). Compiler-UNVERIFIED designation retained (no
Windows toolchain on host; E0463).

Changed paths; shared-file patch requested:
Edited: crates/drogond/src/endpoint.rs (all three races),
crates/drogond/src/service_quiescence.rs (registry doc correction),
docs/migration/verticals/V1/windows-transport-evidence.md (Race
section), docs/migration/verticals/V1/checkpoint-005.md (this file).
None else. No shared files.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
(1) run_overlapped_guarded holds the shared Mutex across closed-check +
ReadFile/WriteFile/ConnectNamedPipe issue, releasing before wait/reap —
shutdown_both can no longer slip a mark+cancel into a gap (leader
read the hunk). (2) shutdown_both holds the lock through its CancelIoEx
loop; Drop holds it through DisconnectNamedPipe+CloseHandle — no
close/recycle during in-flight cancel. (3) NamedPipeConnection +
SharedTransportState derive Debug (unwrap_err compile fix).
Tests: 2 host-gated bounded race tests + 1 host-agnostic contention
test. Leader re-ran: cargo test -p drogond 54/0, harness 23/0, clippy
-D warnings clean, fmt --all exit 0.

Integrated/rendered/platform evidence; exact package identity if applicable:
NONE on Windows — designation retained; V5 runner remains first
verifier (Windows compile strategy in checkpoint-003 still stands).

Unverified, missing, source defects, deliberate approved deltas:
- All cfg(windows) paths: reviewed, uncompiled.
- server.rs accept-loop end-to-end + idle-timeout parity: open.

Dependencies requested; next bounded checkpoint:
ROOT: safety re-review, V5 Windows execution, PR #14 merge order,
dogfood paid pass. V1 next: remaining command/harness families when
directed.

Owned processes: session/incarnation/host, settlement/release receipts:
Race dispatch ctx_a8f5a612213d completed; terminal released on
acceptance. No surviving processes.

Rollback; data/credentials/privacy check:
No durable state, credentials, or network use. Rollback: revert commit.

Ready for independent review: yes (not self-accepted).
