# Original durable-file-write-syscall-proof baseline

**1/1 passed**, no failures, skipped cases, todos or timeout.
Pinned source: c97906287bb7a390b25e2025b600d9fb3c25d9c3.
Node24.19.0 and original installed Vitest4.1.11, macOS arm64.
Manifest: tests/parity/baseline-capsules/durable-file-write-syscall-proof.json.
Digest: 72007a3f56ab436eb8df60495ef105619ec8b49c4ef94434e91ad05aeb9076c8.

Six pinned source files plus MIT license staged unchanged, verified against
source disk and Git. Coordinator read the complete runtime closure.
Execution used an empty environment plus PATH (Node24/system), LANG and CI,
explicit Node/Vitest paths and30s outer timeout. Minimal config differences
are retained in manifest and stdout, not claimed equivalent to full suite.

Retained stage: /Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/coordinator-durable-syscall-XVXfBS.
No product profile, secret, model, network or user window was used.
Original tests create fresh temporary directories and remove only those
test-owned fixtures; generated stage/results remain retained. No personal
directory was removed. Imported Windows command functions were not invoked.

## What the result proves

One unchanged test records synchronous fsync/rename calls at the node:fs
module boundary while delegating to real filesystem calls. It asserts
file sync before rename and directory sync after when its probe supports it.
This is not kernel tracing or a power-loss experiment; directory assertion
is conditional, not evidence of support on every filesystem. Async syscall
ordering, Windows retries and Linux were not exercised.

These are real filesystem tests, not pure functions: stdout's inherited
generic pilot disclaimer uses that inaccurate phrase. The retained raw report
is not edited; this explicit scope and manifest are authoritative.
No Store load/migration, scheduling/generation race, backup recovery, native
secure storage, rendered UI or candidate parity is proved by this capsule.

## Receipt integrity

Parsed raw/archive JSON values match; archive adds a final newline.
stdout.json is the formatted observed runner report.
No byte-identical archive claim.

| File | Raw SHA-256 | Archive SHA-256 |
| --- | --- | --- |
| stage-receipt.json | 3362e767f7e15ecf467a0287b8a18ed54f3697acded0bc76caed97dd00ddb2fc | 9cd2891cf2b3bad55344e8e03b4ce0c2910391f30107eeb1b68befdc5f6c2ce0 |
| vitest-results.json | 59e2fa8909308f1730593690127ff29931ffca6438f40f9a1eb49bb3a60a403a | 6199306040155797874cf66b9eb3aa9e1bfa97e60204718b0c8e496522e779e4 |

Combined new original baseline:13 +1 distinct cases, increasing100 to114
across10 capsules. Shared source modules are not additional tests.
