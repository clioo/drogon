# Original durable-file-write baseline

**13/13 passed**, no failures, skipped cases, todos or timeout.
Pinned source: c97906287bb7a390b25e2025b600d9fb3c25d9c3.
Node24.19.0 and original installed Vitest4.1.11, macOS arm64.
Manifest: tests/parity/baseline-capsules/durable-file-write.json.
Digest: f476bde1ab60ad0fdb88681d6bcb4814f917efe4f790f3eccd1d947282d06486.

Six pinned source files plus MIT license staged unchanged, verified against
source disk and Git. Coordinator read the complete runtime closure.
Execution used an empty environment plus PATH (Node24/system), LANG and CI,
explicit Node/Vitest paths and30s outer timeout. Minimal config differences
are retained in manifest and stdout, not claimed equivalent to full suite.

Retained stage: /Users/carlos/Documents/Drogon-rewrite/.preflight/parity-baseline/coordinator-durable-write-Yf1DLf.
No product profile, secret, model, network or user window was used.
Original tests create fresh temporary directories and remove only those
test-owned fixtures; generated stage/results remain retained. No personal
directory was removed. Imported Windows command functions were not invoked.

## What the result proves

Six unchanged test bodies run once per async/sync mode (12) plus one
sequential last-writer case. Reads verify published/replaced contents, temp
absence,4MiB string length, exact Unicode/escape content and missing-parent
write failure with absent final file. The atomicity-titled test reads after
completion; it does not simulate concurrent readers or a crash. Last-writer
test is sequential, not competing writes. Windows/Linux were not executed.

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
| stage-receipt.json | 43cf67cf7721b0fb13dec9366a0fdf1e389e8e8c81595769652050d14b1a541d | 3636e465bba73d9b099f1066c27fb929605ebca0b1f4e2ca783f22d955df7186 |
| vitest-results.json | 7f47dd36754fa5b338c0eb0d46d69b1dced69bd6ad4cc33056b38ec24315532e | a8fcb42c91305d4c860c1c8ce43fe80afeef3cba37d29c571317aa9de709f284 |

Combined new original baseline:13 +1 distinct cases, increasing100 to114
across10 capsules. Shared source modules are not additional tests.
